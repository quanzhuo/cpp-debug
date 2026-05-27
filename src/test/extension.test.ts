/// <reference types="node" />
/// <reference types="mocha" />

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { afterEach, before, after } from 'mocha';
import { CppDebugConfigurationProvider } from '../configurationProvider';

function createWorkspaceFolder(folderPath: string): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file(folderPath),
		name: path.basename(folderPath),
		index: 0,
	};
}

function getEnvironmentValue(environment: Array<{ name: string; value: string }>, name: string): string | undefined {
	return environment.find(entry => entry.name === name)?.value;
}

suite('Cpp Debug Extension Integration', () => {
	const extensionRoot = path.resolve(__dirname, '../..');
	const provider = new CppDebugConfigurationProvider(extensionRoot);
	const tempDirs: string[] = [];
	const originalEnv = new Map<string, string | undefined>();
	const temporaryCommands: vscode.Disposable[] = [];

	before(async () => {
		const extension = vscode.extensions.all.find(candidate => candidate.packageJSON?.name === 'cppdebug');
		assert.ok(extension, 'The cppdebug extension should be present in the extension host');
		await extension!.activate();
	});

	afterEach(async () => {
		while (temporaryCommands.length > 0) {
			temporaryCommands.pop()?.dispose();
		}
		for (const [name, value] of originalEnv) {
			if (value == null) {
				delete process.env[name];
			} else {
				process.env[name] = value;
			}
		}
		originalEnv.clear();
	});

	after(() => {
		for (const dir of tempDirs) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('activates and registers extension commands', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('cppdebug.pickNativeProcess'));
		assert.ok(commands.includes('cppdebug.pickRemoteNativeProcess'));
		assert.ok(commands.includes('cppdebug.buildAndDebugFile'));
		assert.ok(commands.includes('cppdebug.buildAndRunFile'));
		assert.ok(commands.includes('cppdebug.addDebugConfiguration'));
	});

	test('injects pretty-printer setup for cppdbg gdb launch configs', () => {
		const config: vscode.DebugConfiguration = {
			name: 'Launch',
			type: 'cppdbg',
			request: 'launch',
			program: '/tmp/a.out',
			setupCommands: [],
		};

		const resolved = provider.resolveDebugConfiguration(undefined, config) as vscode.DebugConfiguration;
		const setupCommands = resolved.setupCommands as Array<{ text: string }>;

		assert.ok(setupCommands.length >= 2, 'Expected autoload and pretty-printing setup commands');
		assert.ok(setupCommands[0].text.includes('dist/gdb-pretty-printers/autoload.py'));
		assert.ok(setupCommands.some(command => command.text === '-enable-pretty-printing'));
	});

	test('does not rewrite non-gdb configurations', () => {
		const config: vscode.DebugConfiguration = {
			name: 'LLDB Launch',
			type: 'cppdbg',
			request: 'launch',
			program: '/tmp/a.out',
			MIMode: 'lldb',
		};

		const resolved = provider.resolveDebugConfiguration(undefined, config) as vscode.DebugConfiguration;
		assert.strictEqual(resolved.setupCommands, undefined);
	});

	test('merges envFile values and expands sourceFileMap environment variables', async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cppdebug-test-'));
		tempDirs.push(tempDir);
		fs.writeFileSync(path.join(tempDir, 'vars.env'), 'FOO=from-env-file\nBAR=two\n', 'utf8');

		const envVarName = 'CPPDEBUG_TEST_SOURCE_ROOT';
		originalEnv.set(envVarName, process.env[envVarName]);
		process.env[envVarName] = '/remote/src';

		const config: vscode.DebugConfiguration = {
			name: 'Launch',
			type: 'cppdbg',
			request: 'launch',
			program: '/tmp/a.out',
			envFile: '${workspaceFolder}/vars.env',
			environment: [
				{ name: 'FOO', value: 'old-value' },
				{ name: 'EXISTING', value: '1' },
			],
			sourceFileMap: {
				'${env:CPPDEBUG_TEST_SOURCE_ROOT}': '${env:HOME}/mapped',
				'/literal': {
					editorPath: '${env:CPPDEBUG_TEST_SOURCE_ROOT}/editor',
					useForBreakpoints: true,
				},
			},
		};

		const resolved = await provider.resolveDebugConfigurationWithSubstitutedVariables(createWorkspaceFolder(tempDir), config);
		assert.ok(resolved, 'The configuration should resolve successfully');
		assert.strictEqual(resolved!.envFile, undefined);

		const environment = resolved!.environment as Array<{ name: string; value: string }>;
		assert.strictEqual(getEnvironmentValue(environment, 'FOO'), 'from-env-file');
		assert.strictEqual(getEnvironmentValue(environment, 'BAR'), 'two');
		assert.strictEqual(getEnvironmentValue(environment, 'EXISTING'), '1');

		const sourceFileMap = resolved!.sourceFileMap as Record<string, string | { editorPath?: string; useForBreakpoints?: boolean }>;
		assert.strictEqual(sourceFileMap['/remote/src'], `${process.env.HOME ?? ''}/mapped`);
		assert.deepStrictEqual(sourceFileMap['/literal'], {
			editorPath: '/remote/src/editor',
			useForBreakpoints: true,
		});
	});

	test('runs command deploy steps before launch', async () => {
		let invoked = false;
		const commandId = 'cppdebug.test.deploy-step';
		temporaryCommands.push(vscode.commands.registerCommand(commandId, (...args: unknown[]) => {
			invoked = true;
			assert.deepStrictEqual(args, ['alpha', 42]);
			return 0;
		}));

		const config: vscode.DebugConfiguration = {
			name: 'Launch',
			type: 'cppdbg',
			request: 'launch',
			program: '/tmp/a.out',
			deploySteps: [
				{
					type: 'command',
					command: commandId,
					args: ['alpha', 42],
				},
			],
		};

		const resolved = await provider.resolveDebugConfigurationWithSubstitutedVariables(undefined, config);
		assert.ok(invoked, 'The deploy command should run before launch');
		assert.ok(resolved, 'A successful deploy step should keep the debug configuration');
	});

	test('provides at least one cppdbg launch configuration', async () => {
		const configs = await provider.provideDebugConfigurations();
		assert.ok(configs.length > 0, 'Expected at least one provided launch configuration');
		for (const config of configs) {
			assert.strictEqual(config.type, 'cppdbg');
			assert.strictEqual(config.request, 'launch');
			assert.ok(typeof config.name === 'string' && config.name.length > 0);
		}
	});
});
