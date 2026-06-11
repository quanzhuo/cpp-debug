import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AttachItem } from './attachQuickPick';
import { NativeAttachItemsProviderFactory } from './nativeAttach';
import { checkFileExists, ParsedEnvironmentFile, spawnChildProcess, whichAsync } from './utils';

/**
 * DebugConfigurationProvider for C/C++ debugging with GDB Pretty Printers
 */
export class CppDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    private extensionPath: string;

    constructor(extensionPath: string) {
        this.extensionPath = extensionPath;
    }

    /**
     * Massage a debug configuration just before a debug session is being launched,
     * e.g. add all missing attributes to the debug configuration.
     */
    resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        return this.resolveDebugConfigurationImpl(folder, config);
    }

    private resolveDebugConfigurationImpl(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration
    ): vscode.DebugConfiguration {

        // Only process cppdbg configurations
        if (config.type !== 'cppdbg') {
            return config;
        }

        // Only process GDB (not LLDB)
        const miMode = config.MIMode || 'gdb';
        if (miMode.toLowerCase() !== 'gdb') {
            return config;
        }

        // Initialize setupCommands if missing
        if (!config.setupCommands) {
            config.setupCommands = [];
        }

        const cppSettings = vscode.workspace.getConfiguration('cppdebug');

        // 1. Handle Enable Pretty Printing
        const enablePrettyPrinting = cppSettings.get<boolean>('enablePrettyPrinting', true);
        if (enablePrettyPrinting) {
            const hasPrettyPrinting = config.setupCommands.some((cmd: any) =>
                cmd.text && (cmd.text === '-enable-pretty-printing' || cmd.text.includes('-enable-pretty-printing'))
            );

            if (!hasPrettyPrinting) {
                config.setupCommands.push({
                    description: vscode.l10n.t('Enable pretty-printing for gdb'),
                    text: '-enable-pretty-printing',
                    ignoreFailures: true
                });
            }
        }

        // 2. Handle Auto Load Pretty Printers Script
        const autoLoadEnabled = cppSettings.get<boolean>('autoLoadPrettyPrinters', true);
        if (autoLoadEnabled) {
            // Construct the path to autoload.py
            const autoloadScriptPath = path.join(this.extensionPath, 'dist', 'gdb-pretty-printers', 'autoload.py');

            // Check if the autoload script is already in setupCommands
            const alreadyHasAutoload = config.setupCommands.some((cmd: any) =>
                cmd.text && cmd.text.includes('autoload.py')
            );

            if (!alreadyHasAutoload) {
                // Add the autoload command at the beginning of setupCommands
                // Use forward slashes for cross-platform compatibility (GDB accepts both)
                const normalizedPath = autoloadScriptPath.replace(/\\/g, '/');

                config.setupCommands.unshift({
                    description: vscode.l10n.t('Load GDB Pretty Printers'),
                    text: `source ${normalizedPath}`,
                    ignoreFailures: true  // Don't fail if the script has issues
                });
            }
        }

        return config;
    }

    async resolveDebugConfigurationWithSubstitutedVariables(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        _token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration | undefined> {
        if (!config || !config.type) {
            return undefined;
        }

        // Merge environment variables from envFile into config.environment
        this.resolveEnvFile(config, folder);

        // Expand launch-time variables declared in the debug configuration.
        this.expandLaunchVariables(config, folder);

        // Expand ${env:VAR} references in sourceFileMap keys and values
        this.resolveSourceFileMapVariables(config);

        // Execute deploy steps before the debug session starts
        if (Array.isArray(config.deploySteps) && config.deploySteps.length > 0) {
            const succeeded = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: vscode.l10n.t('Running deploy steps...')
            }, () => this.runDeploySteps(config, _token));
            if (!succeeded || _token?.isCancellationRequested) {
                return undefined;
            }
        }

        // Auto-resolve processId for local attach configurations
        if (config.request === 'attach' && !config.processId && !config.pipeTransport && !config.useExtendedRemote) {
            let processId: string | undefined;
            if (config.program) {
                processId = await this.findProcessByProgramName(config.program as string, _token);
            }
            if (!processId) {
                // Fall back to interactive process picker
                const provider = NativeAttachItemsProviderFactory.Get();
                const processes: AttachItem[] = await provider.getAttachItems(_token);
                const selection = await vscode.window.showQuickPick(processes, {
                    matchOnDetail: true,
                    matchOnDescription: true,
                    placeHolder: vscode.l10n.t('Select the process to attach to')
                });
                processId = selection?.id;
            }
            if (processId) {
                config.processId = processId;
            } else {
                void vscode.window.showErrorMessage(vscode.l10n.t('No process was selected.'));
                return undefined;
            }
        }

        return config;
    }

    async provideDebugConfigurations(folder?: vscode.WorkspaceFolder, _token?: vscode.CancellationToken): Promise<vscode.DebugConfiguration[]> {
        const configs: vscode.DebugConfiguration[] = [];
        const platform = os.platform();
        const programExt = platform === 'win32' ? '.exe' : '';

        type CompilerEntry = { compiler: string; miMode: 'gdb' | 'lldb' };
        const probeList: CompilerEntry[] = platform === 'darwin'
            ? [
                { compiler: 'clang', miMode: 'lldb' },
                { compiler: 'clang++', miMode: 'lldb' },
                { compiler: 'gcc', miMode: 'gdb' },
                { compiler: 'g++', miMode: 'gdb' },
            ]
            : [
                { compiler: platform === 'win32' ? 'gcc.exe' : 'gcc', miMode: 'gdb' },
                { compiler: platform === 'win32' ? 'g++.exe' : 'g++', miMode: 'gdb' },
                { compiler: platform === 'win32' ? 'clang.exe' : 'clang', miMode: 'gdb' },
                { compiler: platform === 'win32' ? 'clang++.exe' : 'clang++', miMode: 'gdb' },
            ];

        const debuggerCache = new Map<string, string | undefined>();
        const getDebugger = async (miMode: 'gdb' | 'lldb'): Promise<string | undefined> => {
            if (!debuggerCache.has(miMode)) {
                const name = platform === 'win32' ? `${miMode}.exe` : miMode;
                debuggerCache.set(miMode, await whichAsync(name));
            }
            return debuggerCache.get(miMode);
        };

        for (const entry of probeList) {
            const compilerPath = await whichAsync(entry.compiler);
            if (!compilerPath) { continue; }

            const debuggerPath = await getDebugger(entry.miMode);
            if (!debuggerPath) { continue; }

            const compilerName = path.basename(entry.compiler, programExt);
            configs.push({
                name: `C/C++: ${compilerName} build and debug active file`,
                type: 'cppdbg',
                request: 'launch',
                program: `\${fileDirname}/\${fileBasenameNoExtension}${programExt}`,
                args: [],
                stopAtEntry: false,
                cwd: '${fileDirname}',
                environment: [],
                externalConsole: false,
                MIMode: entry.miMode,
                miDebuggerPath: debuggerPath,
                setupCommands: [
                    { description: vscode.l10n.t('Enable pretty-printing for gdb'), text: '-enable-pretty-printing', ignoreFailures: true }
                ]
            });
        }

        // Fallback template when no compiler/debugger pair was detected
        if (configs.length === 0) {
            const miMode = platform === 'darwin' ? 'lldb' : 'gdb';
            configs.push({
                name: 'C/C++: Launch',
                type: 'cppdbg',
                request: 'launch',
                program: `\${fileDirname}/\${fileBasenameNoExtension}${programExt}`,
                args: [],
                stopAtEntry: false,
                cwd: '${fileDirname}',
                environment: [],
                externalConsole: false,
                MIMode: miMode,
                setupCommands: [
                    { description: vscode.l10n.t('Enable pretty-printing for gdb'), text: '-enable-pretty-printing', ignoreFailures: true }
                ]
            });
        }

        return configs;
    }

    public getLaunchConfigs(folder?: vscode.WorkspaceFolder, type?: string): vscode.DebugConfiguration[] {
        const workspaceConfig = vscode.workspace.getConfiguration('launch', folder);
        const configs = workspaceConfig.inspect<vscode.DebugConfiguration[]>('configurations');
        let result: vscode.DebugConfiguration[] = [];
        if (configs?.workspaceFolderValue) {
            result = result.concat(configs.workspaceFolderValue);
        }
        if (configs?.workspaceValue) {
            result = result.concat(configs.workspaceValue);
        }
        if (configs?.globalValue) {
            result = result.concat(configs.globalValue);
        }
        return result.filter(c => c.name && c.request === 'launch' && (type ? c.type === type : true));
    }

    public async buildAndDebug(textEditor: vscode.TextEditor, debugModeOn: boolean = true): Promise<void> {
        const folder = vscode.workspace.getWorkspaceFolder(textEditor.document.uri);
        const existingConfigs = this.getLaunchConfigs(folder, 'cppdbg');
        const generatedConfigs = await this.provideDebugConfigurations(folder);
        // Show existing configs first; append generated ones that aren't already present
        const configs = [
            ...existingConfigs,
            ...generatedConfigs.filter(g => !existingConfigs.some(e => e.name === g.name))
        ];

        let selectedConfig: vscode.DebugConfiguration;
        if (configs.length === 1) {
            selectedConfig = configs[0];
        } else {
            const items = configs.map(c => ({
                label: c.name as string,
                description: c.preLaunchTask ? `preLaunchTask: ${c.preLaunchTask}` : undefined,
                config: c
            }));
            const selection = await vscode.window.showQuickPick(items, {
                placeHolder: vscode.l10n.t('Select a debug configuration')
            });
            if (!selection) {
                return;
            }
            selectedConfig = selection.config;
        }

        await vscode.debug.startDebugging(folder, selectedConfig, { noDebug: !debugModeOn });
    }

    public async buildAndRun(textEditor: vscode.TextEditor): Promise<void> {
        return this.buildAndDebug(textEditor, false);
    }

    public async addDebugConfiguration(textEditor: vscode.TextEditor): Promise<void> {
        const folder = vscode.workspace.getWorkspaceFolder(textEditor.document.uri);
        if (!folder) {
            void vscode.window.showWarningMessage(vscode.l10n.t('Add debug configuration is not available for single file.'));
            return;
        }
        await vscode.commands.executeCommand('workbench.action.debug.configure');
    }

    private resolveEnvFile(config: vscode.DebugConfiguration, folder?: vscode.WorkspaceFolder): void {
        if (!config.envFile) { return; }

        let envFilePath: string = config.envFile as string;
        // ${workspaceFolder} / ${workspaceRoot} are substituted by VSCode before this hook,
        // but handle any remaining ${env:VAR} patterns just in case.
        envFilePath = envFilePath.replace(/\${env:(\w+)}/g, (_, name: string) => process.env[name] ?? '');
        if (folder?.uri?.fsPath) {
            envFilePath = envFilePath.replace(/(\${workspaceFolder}|\${workspaceRoot})/g, folder.uri.fsPath);
        }

        try {
            const parsedFile = ParsedEnvironmentFile.CreateFromFile(envFilePath, config.environment);
            if (parsedFile.Warning) {
                void vscode.window.showWarningMessage(parsedFile.Warning);
            }
            config.environment = parsedFile.Env;
            delete config.envFile;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(vscode.l10n.t('Failed to use envFile. Reason: {0}', msg));
        }
    }

    private resolveSourceFileMapVariables(config: vscode.DebugConfiguration): void {
        if (!config.sourceFileMap) { return; }

        const expandEnvVars = (str: string): string =>
            str.replace(/\${env:(\w+)}/g, (_, name: string) => process.env[name] ?? '');

        const newMap: Record<string, string | object> = {};
        for (const [src, target] of Object.entries(config.sourceFileMap as Record<string, string | object>)) {
            const newSrc = expandEnvVars(src);
            if (typeof target === 'string') {
                newMap[newSrc] = expandEnvVars(target);
            } else if (target && typeof target === 'object') {
                const tObj = target as { editorPath?: string; useForBreakpoints?: boolean };
                const newTarget = { ...tObj };
                if (newTarget.editorPath) {
                    newTarget.editorPath = expandEnvVars(newTarget.editorPath);
                }
                newMap[newSrc] = newTarget;
            } else {
                newMap[newSrc] = target as string;
            }
        }
        config.sourceFileMap = newMap;
    }

    private expandLaunchVariables(config: vscode.DebugConfiguration, folder?: vscode.WorkspaceFolder): void {
        const folderPath = folder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const variables: Record<string, string> = {};

        if (config.variables && typeof config.variables === 'object') {
            for (const [name, value] of Object.entries(config.variables as Record<string, unknown>)) {
                if (typeof value === 'string') {
                    variables[name] = value;
                }
            }
        }

        variables.workspaceFolder = folderPath || '${workspaceFolder}';
        variables.workspaceFolderBasename = folderPath ? path.basename(folderPath) : '${workspaceFolderBasename}';

        this.expandStringsInObject(config, variables);
    }

    private expandStringsInObject(value: unknown, variables: Record<string, string>, depth: number = 0): unknown {
        if (depth > 10 || value === null || value === undefined) {
            return value;
        }

        if (typeof value === 'string') {
            return this.expandString(value, variables);
        }

        if (Array.isArray(value)) {
            return value.map(entry => this.expandStringsInObject(entry, variables, depth + 1));
        }

        if (typeof value === 'object') {
            for (const key of Object.keys(value as Record<string, unknown>)) {
                (value as Record<string, unknown>)[key] = this.expandStringsInObject(
                    (value as Record<string, unknown>)[key],
                    variables,
                    depth + 1
                );
            }
        }

        return value;
    }

    private expandString(input: string, variables: Record<string, string>): string {
        const maxRecursion = 10;
        let result = input;

        for (let i = 0; i < maxRecursion; i++) {
            const expanded = result.replace(/\$\{([^}]+)\}/g, (match: string, name: string) => {
                if (name === 'workspaceFolder') {
                    return variables.workspaceFolder;
                }

                if (name === 'workspaceFolderBasename') {
                    return variables.workspaceFolderBasename;
                }

                const replacement = variables[name];
                return replacement !== undefined ? replacement : match;
            });

            if (expanded === result) {
                break;
            }

            result = expanded;
        }

        return result;
    }
    private async runDeploySteps(config: vscode.DebugConfiguration, token?: vscode.CancellationToken): Promise<boolean> {
        for (const step of config.deploySteps) {
            // Honor debug/noDebug filtering
            if ((config.noDebug && step.debug === true) || (!config.noDebug && step.debug === false)) {
                continue;
            }
            if (token?.isCancellationRequested) { return false; }
            const ok = await this.runSingleDeployStep(step, config, token);
            if (!ok) { return false; }
        }
        return true;
    }

    private async runSingleDeployStep(step: any, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): Promise<boolean> {
        const stepType: string = step.type;
        switch (stepType) {
            case 'command': {
                const args: unknown[] = Array.isArray(step.args) ? step.args : [];
                const returnCode: unknown = await vscode.commands.executeCommand(step.command, ...args);
                return !returnCode;
            }
            case 'scp':
            case 'rsync': {
                if (!step.files || !step.targetDir || !step.host) {
                    void vscode.window.showErrorMessage(vscode.l10n.t('"host", "files", and "targetDir" are required in {0} steps.', stepType));
                    return false;
                }
                const host = typeof step.host === 'string' ? { hostName: step.host } : step.host;
                const filesStr: string = Array.isArray(step.files)
                    ? (step.files as string[]).map((f: string) => `"${f}"`).join(' ')
                    : `"${step.files}"`;
                const portArg = host.port ? (stepType === 'scp' ? `-P ${host.port}` : `--port=${host.port}`) : '';
                const jumpArg = host.jumpHosts?.length
                    ? `-J ${(host.jumpHosts as any[]).map((h: any) => deployHostAddress(h)).join(',')}`
                    : '';
                const recursiveArg = step.recursive !== false ? '-r' : '';
                const hostAddr = deployHostAddress(host);
                const tool = stepType === 'scp' ? (config.scpPath || 'scp') : (config.rsyncPath || 'rsync');
                const rsyncFlags = stepType === 'rsync' ? '-lKpvz' : '';
                const cmd = [tool, rsyncFlags, recursiveArg, portArg, jumpArg, filesStr, `${hostAddr}:${step.targetDir}`]
                    .filter(Boolean).join(' ');
                const result = await spawnChildProcess(cmd, [], step.continueOn, true, token);
                if (!result.succeeded) {
                    void vscode.window.showErrorMessage(result.output);
                    return false;
                }
                return true;
            }
            case 'ssh': {
                if (!step.host || !step.command) {
                    void vscode.window.showErrorMessage(vscode.l10n.t('"host" and "command" are required for ssh steps.'));
                    return false;
                }
                const host = typeof step.host === 'string' ? { hostName: step.host } : step.host;
                const portArg = host.port ? `-p ${host.port}` : '';
                const jumpArg = host.jumpHosts?.length
                    ? `-J ${(host.jumpHosts as any[]).map((h: any) => deployHostAddress(h)).join(',')}`
                    : '';
                const sshTool = config.sshPath || 'ssh';
                const hostAddr = deployHostAddress(host);
                const cmd = [sshTool, portArg, jumpArg, hostAddr, `"${step.command}"`].filter(Boolean).join(' ');
                const result = await spawnChildProcess(cmd, [], step.continueOn, true, token);
                if (!result.succeeded) {
                    void vscode.window.showErrorMessage(result.output);
                    return false;
                }
                return true;
            }
            case 'shell': {
                if (!step.command) {
                    void vscode.window.showErrorMessage(vscode.l10n.t('"command" is required for shell steps.'));
                    return false;
                }
                const result = await spawnChildProcess(step.command as string, [], step.continueOn, true, token);
                if (!result.succeeded) {
                    void vscode.window.showErrorMessage(result.output);
                    return false;
                }
                return true;
            }
            default: {
                void vscode.window.showErrorMessage(vscode.l10n.t('Deploy step type \'{0}\' is not supported.', stepType));
                return false;
            }
        }
    }
    private async findProcessByProgramName(programPath: string, token?: vscode.CancellationToken): Promise<string | undefined> {
        if (!await checkExecutableExists(programPath)) {
            return undefined;
        }

        const isWin = os.platform() === 'win32';
        let targetName = path.basename(programPath);
        if (isWin) {
            targetName = targetName.toLowerCase();
            if (!targetName.endsWith('.exe')) { targetName += '.exe'; }
        }

        const provider = NativeAttachItemsProviderFactory.Get();
        const processes: AttachItem[] = await provider.getAttachItems(token);

        const matches = processes.filter(p => {
            const name = isWin ? p.label.toLowerCase() : p.label;
            return name === targetName;
        });

        if (matches.length === 0) { return undefined; }
        if (matches.length === 1) { return matches[0].id; }

        // Multiple matches — let user choose
        const selection = await vscode.window.showQuickPick(matches, {
            matchOnDetail: true,
            matchOnDescription: true,
            placeHolder: vscode.l10n.t('Multiple processes named \'{0}\' found. Select one to attach.', targetName)
        });
        return selection?.id;
    }
}

function deployHostAddress(host: { hostName: string; user?: string }): string {
    return host.user ? `${host.user}@${host.hostName}` : host.hostName;
}

async function checkExecutableExists(filePath: string): Promise<boolean> {
    if (await checkFileExists(filePath)) { return true; }
    if (os.platform() === 'win32') {
        const lower = filePath.toLowerCase();
        if (lower.endsWith('.exe') || lower.endsWith('.cmd') || lower.endsWith('.bat')) { return false; }
        return await checkFileExists(filePath + '.exe')
            || await checkFileExists(filePath + '.cmd')
            || await checkFileExists(filePath + '.bat');
    }
    return false;
}
