import * as vscode from 'vscode';
import * as path from 'path';

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
        const configs = this.getLaunchConfigs(folder, 'cppdbg');

        if (configs.length === 0) {
            const answer = await vscode.window.showInformationMessage(
                'No cppdbg launch configurations found. Please add one to launch.json.',
                'Open launch.json'
            );
            if (answer === 'Open launch.json') {
                await this.addDebugConfiguration(textEditor);
            }
            return;
        }

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
}
