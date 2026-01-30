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

        // Check if auto-load is enabled
        const autoLoadEnabled = vscode.workspace.getConfiguration('cppdebug')
            .get<boolean>('autoLoadPrettyPrinters', true);
        
        if (!autoLoadEnabled) {
            return config;
        }

        // Only add pretty printer for GDB (not LLDB)
        const miMode = config.MIMode || 'gdb';
        if (miMode.toLowerCase() !== 'gdb') {
            return config;
        }

        // Construct the path to autoload.py
        const autoloadScriptPath = path.join(this.extensionPath, 'gdb-pretty-printers', 'autoload.py');

        // Check if setupCommands already exists
        if (!config.setupCommands) {
            config.setupCommands = [];
        }

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

        return config;
    }
}
