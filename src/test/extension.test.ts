/// <reference types="node" />
/// <reference types="mocha" />

import * as assert from 'assert';
import * as fs from 'fs';
import { after, afterEach, before } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import { CppDebugConfigurationProvider } from '../configurationProvider';

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
		assert.ok(commands.includes('cppdebug.attachToProcess'));
		assert.ok(commands.includes('cppdebug.attachToProcessWithConfiguration'));
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
});
