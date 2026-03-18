import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { whichAsync } from './utils';
import { ParsedEnvironmentFile } from './utils';

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
                    description: 'Enable pretty-printing for gdb',
                    text: '-enable-pretty-printing',
                    ignoreFailures: true
                });
            }
        }

        // 2. Handle Auto Load Pretty Printers Script
        const autoLoadEnabled = cppSettings.get<boolean>('autoLoadPrettyPrinters', true);
        if (autoLoadEnabled) {
            // Construct the path to autoload.py
            const autoloadScriptPath = path.join(this.extensionPath, 'gdb-pretty-printers', 'autoload.py');

            // Check if the autoload script is already in setupCommands
            const alreadyHasAutoload = config.setupCommands.some((cmd: any) => 
                cmd.text && cmd.text.includes('autoload.py')
            );

            if (!alreadyHasAutoload) {
                // Add the autoload command at the beginning of setupCommands
                // Use forward slashes for cross-platform compatibility (GDB accepts both)
                const normalizedPath = autoloadScriptPath.replace(/\\/g, '/');
                
                config.setupCommands.unshift({
                    description: 'Load GDB Pretty Printers',
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

        // Expand ${env:VAR} references in sourceFileMap keys and values
        this.resolveSourceFileMapVariables(config);

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
                    { description: 'Enable pretty-printing for gdb', text: '-enable-pretty-printing', ignoreFailures: true }
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
                    { description: 'Enable pretty-printing for gdb', text: '-enable-pretty-printing', ignoreFailures: true }
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
                placeHolder: 'Select a debug configuration'
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
            void vscode.window.showWarningMessage('Add debug configuration is not available for single file.');
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
            throw new Error(`Failed to use envFile. Reason: ${msg}`);
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
}
