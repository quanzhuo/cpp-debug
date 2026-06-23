import * as cp from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AttachItem, showAttachItemQuickPick } from './attachQuickPick';
import { NativeAttachItemsProviderFactory } from './nativeAttach';
import { findPowerShell } from './utils';

/**
 * DebugConfigurationProvider for C/C++ debugging with GDB Pretty Printers
 */
export class CppDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    private extensionPath: string;
    private context?: vscode.ExtensionContext;

    constructor(extensionPath: string, context?: vscode.ExtensionContext) {
        this.extensionPath = extensionPath;
        this.context = context;
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

    public getAttachConfigs(folder?: vscode.WorkspaceFolder, type?: string): vscode.DebugConfiguration[] {
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
        return result.filter(c => c.name && c.request === 'attach' && (type ? c.type === type : true));
    }

    private async pickAttachItem(processes: AttachItem[]): Promise<AttachItem | undefined> {
        if (processes.length === 0) {
            void vscode.window.showWarningMessage(vscode.l10n.t('No attachable processes were found.'));
            return undefined;
        }

        if (this.context) {
            return showAttachItemQuickPick(() => Promise.resolve(processes), this.context);
        }

        return vscode.window.showQuickPick(processes, {
            matchOnDetail: true,
            matchOnDescription: true,
            placeHolder: vscode.l10n.t('Select the process to attach to')
        });
    }

    private async getProgramFromAttachItem(item: AttachItem): Promise<string> {
        const commandLine = item.detail?.trim();
        if (commandLine) {
            const quoted = commandLine.match(/^"([^"]+)"|^'([^']+)'/);
            if (quoted) {
                return this.resolveAttachProgramPath(quoted[1] ?? quoted[2], item.id);
            }

            const token = commandLine.match(/^\S+/);
            if (token) {
                return this.resolveAttachProgramPath(token[0], item.id);
            }
        }

        // Fall back to process name when full command line is unavailable (e.g. some Windows processes).
        return this.resolveAttachProgramPath(item.label, item.id);
    }

    private async resolveAttachProgramPath(program: string, pid?: string): Promise<string> {
        if (!program || path.isAbsolute(program)) {
            return program;
        }

        if (!pid || !/^\d+$/.test(pid)) {
            return program;
        }

        const platform = os.platform();

        if (platform === 'linux') {
            const linuxExecutablePath = await this.getLinuxProcessLinkTarget(pid, 'exe');
            if (linuxExecutablePath) {
                return linuxExecutablePath;
            }

            if (!program.startsWith('./') && !program.startsWith('../')) {
                return program;
            }

            const cwd = await this.getLinuxProcessLinkTarget(pid, 'cwd');
            if (!cwd) {
                return program;
            }

            return path.resolve(cwd, program);
        }

        if (platform === 'darwin') {
            return await this.getDarwinExecutablePath(pid) ?? program;
        }

        if (platform === 'win32') {
            return await this.getWindowsExecutablePath(pid) ?? program;
        }

        return program;
    }

    private async getLinuxProcessLinkTarget(pid: string, linkName: 'exe' | 'cwd'): Promise<string | undefined> {
        try {
            return await fs.readlink(`/proc/${pid}/${linkName}`);
        } catch {
            return undefined;
        }
    }

    private async getDarwinExecutablePath(pid: string): Promise<string | undefined> {
        const output = await this.execFileCapture('/usr/sbin/lsof', ['-a', '-p', pid, '-d', 'txt', '-Fn'])
            ?? await this.execFileCapture('lsof', ['-a', '-p', pid, '-d', 'txt', '-Fn']);
        if (!output) {
            return undefined;
        }

        for (const rawLine of output.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (line.startsWith('n/')) {
                return line.substring(1);
            }
        }

        return undefined;
    }

    private async getWindowsExecutablePath(pid: string): Promise<string | undefined> {
        const pwsh = findPowerShell();
        if (!pwsh) {
            return undefined;
        }

        const script = `$p = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" -ErrorAction SilentlyContinue; if ($p -and $p.ExecutablePath) { [Console]::Write($p.ExecutablePath) }`;
        const output = await this.execFileCapture(pwsh, ['-NoProfile', '-Command', script]);
        return output?.trim() || undefined;
    }

    private execFileCapture(program: string, args: string[]): Promise<string | undefined> {
        return new Promise(resolve => {
            cp.execFile(program, args, { windowsHide: true }, (error, stdout) => {
                if (error) {
                    resolve(undefined);
                    return;
                }

                const trimmed = (stdout ?? '').trim();
                resolve(trimmed.length > 0 ? trimmed : undefined);
            });
        });
    }

    public async attachToProcess(folder?: vscode.WorkspaceFolder): Promise<void> {
        const provider = NativeAttachItemsProviderFactory.Get();
        const processSelection = await this.pickAttachItem(await provider.getAttachItems());
        const processId = processSelection?.id;
        if (!processId) {
            return;
        }

        const attachConfig: vscode.DebugConfiguration = {
            name: vscode.l10n.t('C/C++: Attach to Process'),
            type: 'cppdbg',
            request: 'attach',
            program: await this.getProgramFromAttachItem(processSelection),
            processId,
        };

        await vscode.debug.startDebugging(folder, attachConfig);
    }

    public async attachToProcessWithConfiguration(folder?: vscode.WorkspaceFolder): Promise<void> {
        const attachConfigs = this.getAttachConfigs(folder, 'cppdbg')
            .filter(config => !config.pipeTransport && !config.useExtendedRemote);

        if (attachConfigs.length === 0) {
            void vscode.window.showWarningMessage(vscode.l10n.t('No local C/C++ attach configurations were found. Falling back to quick attach.'));
            await this.attachToProcess(folder);
            return;
        }

        let selectedConfig: vscode.DebugConfiguration;
        if (attachConfigs.length === 1) {
            selectedConfig = attachConfigs[0];
        } else {
            const configSelection = await vscode.window.showQuickPick(attachConfigs.map(config => ({
                label: config.name as string,
                description: config.program ? `${config.program}` : undefined,
                config,
            })), {
                placeHolder: vscode.l10n.t('Select an attach configuration')
            });
            if (!configSelection) {
                return;
            }
            selectedConfig = configSelection.config;
        }

        const provider = NativeAttachItemsProviderFactory.Get();
        const processSelection = await this.pickAttachItem(await provider.getAttachItems());
        const processId = processSelection?.id;
        if (!processId) {
            return;
        }

        const program = typeof selectedConfig.program === 'string' && selectedConfig.program.length > 0
            ? selectedConfig.program
            : await this.getProgramFromAttachItem(processSelection);

        await vscode.debug.startDebugging(folder, { ...selectedConfig, processId, program });
    }
}
