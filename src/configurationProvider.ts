import { glob } from 'glob';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AttachItem } from './attachQuickPick';
import { expandAllStrings, ExpansionOptions, ExpansionVars } from './expand';
import { NativeAttachItemsProviderFactory } from './nativeAttach';
import { checkFileExists, ParsedEnvironmentFile, pathAccessible, spawnChildProcess, whichAsync } from './utils';

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

        const folderPath = folder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const vars: ExpansionVars = {
            workspaceFolder: folderPath || '${workspaceFolder}',
            workspaceFolderBasename: folderPath ? path.basename(folderPath) : '${workspaceFolderBasename}',
        };
        if (config.variables && typeof config.variables === 'object') {
            for (const [name, value] of Object.entries(config.variables as Record<string, unknown>)) {
                if (typeof value === 'string') {
                    vars[name] = value;
                }
            }
        }

        const expansionOptions: ExpansionOptions = {
            vars,
            recursive: true,
        };
        await expandAllStrings(config, expansionOptions);

        // Expand ${env:VAR} references in sourceFileMap keys and values
        this.resolveSourceFileMapVariables(config);

        // Execute deploy steps before the debug session starts
        if (Array.isArray(config.deploySteps) && config.deploySteps.length > 0) {
            if (!isDeployStepsSupported(vscode.version)) {
                void vscode.window.showErrorMessage(vscode.l10n.t("'deploySteps' require VS Code 1.69+."));
                return undefined;
            }

            const validationError = validateDeploySteps(config.deploySteps);
            if (validationError) {
                void vscode.window.showErrorMessage(validationError);
                return undefined;
            }

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
                const host = normalizeDeployHost(step.host);
                const filesResolution = await resolveDeployFiles(step.files);
                if (filesResolution.missing.length > 0) {
                    void vscode.window.showErrorMessage(vscode.l10n.t('Deploy step files not found: {0}', filesResolution.missing.join(', ')));
                    return false;
                }
                const files = filesResolution.files;
                if (files.length === 0) {
                    void vscode.window.showErrorMessage(vscode.l10n.t('No files matched deploy step "files" patterns.'));
                    return false;
                }
                const jumpHosts = normalizeJumpHosts(host.jumpHosts);
                const recursive = step.recursive !== false;
                const target = `${deployHostAddressNoPort(host)}:${step.targetDir}`;

                const tool = stepType === 'scp' ? (config.scpPath || 'scp') : (config.rsyncPath || 'rsync');
                const args: string[] = stepType === 'scp'
                    ? buildScpArgs(files, host, target, recursive, jumpHosts)
                    : buildRsyncArgs(files, host, target, recursive, jumpHosts);

                const result = await spawnChildProcess(tool, args, step.continueOn, true, token);
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
                const sshTool = config.sshPath || 'ssh';
                const host = normalizeDeployHost(step.host);
                const jumpHosts = normalizeJumpHosts(host.jumpHosts);
                const localForwards = normalizeLocalForwards(host.localForwards);
                const args = buildSshArgs(host, step.command as string, jumpHosts, localForwards);

                const result = await spawnChildProcess(sshTool, args, step.continueOn, true, token);
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

export function isDeployStepsSupported(vscodeVersion: string): boolean {
    const [majorRaw, minorRaw] = vscodeVersion.split('.');
    const major = Number.parseInt(majorRaw ?? '', 10);
    const minor = Number.parseInt(minorRaw ?? '', 10);

    if (Number.isNaN(major) || Number.isNaN(minor)) {
        return true;
    }

    return major > 1 || (major === 1 && minor >= 69);
}

export function validateDeploySteps(steps: unknown[]): string | undefined {
    for (const step of steps) {
        if (!step || typeof step !== 'object') {
            return vscode.l10n.t('Deploy step must be an object.');
        }

        const typedStep = step as { type?: unknown; args?: unknown; files?: unknown; targetDir?: unknown; host?: unknown; command?: unknown };
        const stepType = typedStep.type;
        if (typeof stepType !== 'string') {
            return vscode.l10n.t('Deploy step type is required.');
        }

        if (stepType === 'command') {
            if (!typedStep.command || typeof typedStep.command !== 'string') {
                return vscode.l10n.t('"command" is required in command deploy step.');
            }
            if (typedStep.args !== undefined && !Array.isArray(typedStep.args)) {
                return vscode.l10n.t('"args" in command deploy step must be an array.');
            }
            continue;
        }

        if (stepType === 'scp' || stepType === 'rsync') {
            if (!typedStep.files || !typedStep.targetDir || !typedStep.host) {
                return vscode.l10n.t('"host", "files", and "targetDir" are required in {0} steps.', stepType);
            }
            if (!isValidDeployFiles(typedStep.files)) {
                return vscode.l10n.t('"files" must be a string or an array of strings in {0} steps.', stepType);
            }
            const hostError = validateDeployHost(typedStep.host);
            if (hostError) {
                return hostError;
            }
            continue;
        }

        if (stepType === 'ssh') {
            if (!typedStep.host || !typedStep.command) {
                return vscode.l10n.t('"host" and "command" are required for ssh steps.');
            }
            if (typeof typedStep.command !== 'string') {
                return vscode.l10n.t('"command" is required for ssh steps.');
            }
            const hostError = validateDeployHost(typedStep.host);
            if (hostError) {
                return hostError;
            }
            if (typeof typedStep.host === 'object' && typedStep.host) {
                const hostObject = typedStep.host as { localForwards?: unknown };
                const localForwardsError = validateLocalForwards(hostObject.localForwards);
                if (localForwardsError) {
                    return localForwardsError;
                }
            }
            continue;
        }

        if (stepType === 'shell') {
            if (!typedStep.command || typeof typedStep.command !== 'string') {
                return vscode.l10n.t('"command" is required for shell steps.');
            }
            continue;
        }

        return vscode.l10n.t('Deploy step type \'{0}\' is not supported.', stepType);
    }

    return undefined;
}

function deployHostAddress(host: { hostName: string; user?: string; port?: string | number }): string {
    const hostNoPort = deployHostAddressNoPort(host);
    return host.port ? `${hostNoPort}:${host.port}` : hostNoPort;
}

function deployHostAddressNoPort(host: { hostName: string; user?: string }): string {
    return host.user ? `${host.user}@${host.hostName}` : host.hostName;
}

function isValidDeployFiles(files: unknown): boolean {
    return typeof files === 'string' || (Array.isArray(files) && files.every(file => typeof file === 'string'));
}

function normalizeDeployFiles(files: unknown): string[] {
    if (typeof files === 'string') {
        return [files];
    }
    if (Array.isArray(files)) {
        return files.filter((file): file is string => typeof file === 'string');
    }
    return [];
}

export async function resolveDeployFiles(files: unknown): Promise<{ files: string[]; missing: string[] }> {
    const patterns = normalizeDeployFiles(files);
    const resolvedFiles: string[] = [];
    const missingFiles: string[] = [];
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    for (const pattern of patterns) {
        const normalizedPattern = workspaceFolder && !path.isAbsolute(pattern)
            ? path.resolve(workspaceFolder, pattern)
            : pattern;

        if (!isGlobPattern(normalizedPattern)) {
            if (await pathAccessible(normalizedPattern)) {
                resolvedFiles.push(normalizedPattern);
            } else {
                missingFiles.push(normalizedPattern);
            }
            continue;
        }

        const matches = await glob(normalizedPattern, {
            nodir: true,
            windowsPathsNoEscape: true,
        });

        for (const match of matches) {
            resolvedFiles.push(match);
        }
    }

    return {
        files: Array.from(new Set(resolvedFiles)),
        missing: Array.from(new Set(missingFiles)),
    };
}

export function isGlobPattern(pattern: string): boolean {
    return /[*?{}\[\]]/.test(pattern);
}

type DeployHost = {
    hostName: string;
    user?: string;
    port?: string | number;
    jumpHosts?: unknown;
    localForwards?: unknown;
};

type LocalForward = {
    bindAddress?: string;
    port?: string | number;
    host?: string;
    hostPort?: string | number;
    localSocket?: string;
    remoteSocket?: string;
};

function normalizeDeployHost(host: unknown): DeployHost {
    if (typeof host === 'string') {
        return { hostName: host };
    }
    return (host ?? {}) as DeployHost;
}

function validateDeployHost(host: unknown): string | undefined {
    if (typeof host === 'string') {
        return host.trim().length > 0 ? undefined : vscode.l10n.t('"host" must not be empty.');
    }
    if (!host || typeof host !== 'object') {
        return vscode.l10n.t('"host" must be a string or an object.');
    }

    const hostName = (host as { hostName?: unknown }).hostName;
    if (typeof hostName !== 'string' || hostName.trim().length === 0) {
        return vscode.l10n.t('"hostName" is required in host object.');
    }

    const jumpHosts = (host as { jumpHosts?: unknown }).jumpHosts;
    if (jumpHosts !== undefined) {
        if (!Array.isArray(jumpHosts)) {
            return vscode.l10n.t('"jumpHosts" must be an array in host object.');
        }
        for (const jumpHost of jumpHosts) {
            const jumpHostError = validateDeployHost(jumpHost);
            if (jumpHostError) {
                return jumpHostError;
            }
        }
    }

    return undefined;
}

function normalizeJumpHosts(jumpHosts: unknown): DeployHost[] {
    if (!Array.isArray(jumpHosts)) {
        return [];
    }
    return jumpHosts
        .filter((host): host is Record<string, unknown> => !!host && typeof host === 'object')
        .map(host => normalizeDeployHost(host));
}

function normalizeLocalForwards(localForwards: unknown): LocalForward[] {
    if (!Array.isArray(localForwards)) {
        return [];
    }
    return localForwards
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
        .map(entry => entry as LocalForward);
}

function buildScpArgs(files: string[], host: DeployHost, target: string, recursive: boolean, jumpHosts: DeployHost[]): string[] {
    const args: string[] = [];
    if (recursive) {
        args.push('-r');
    }
    if (jumpHosts.length > 0) {
        args.push('-J', jumpHosts.map(deployHostAddress).join(','));
    }
    if (host.port) {
        args.push('-P', `${host.port}`);
    }
    args.push(...files.map(quoteArgIfNeeded), quoteArgIfNeeded(target));
    return args;
}

function buildRsyncArgs(files: string[], host: DeployHost, target: string, recursive: boolean, jumpHosts: DeployHost[]): string[] {
    const args: string[] = ['-lKpvz'];
    if (recursive) {
        args.push('-r');
    }
    if (jumpHosts.length > 0) {
        args.push('-e', `ssh -J ${jumpHosts.map(deployHostAddress).join(',')}`);
    }
    if (host.port) {
        args.push(`--port=${host.port}`);
    }
    args.push(...files.map(quoteArgIfNeeded), quoteArgIfNeeded(target));
    return args;
}

function buildSshArgs(host: DeployHost, command: string, jumpHosts: DeployHost[], localForwards: LocalForward[]): string[] {
    const args: string[] = [];
    if (jumpHosts.length > 0) {
        args.push('-J', jumpHosts.map(deployHostAddress).join(','));
    }
    if (host.port) {
        args.push('-p', `${host.port}`);
    }
    for (const localForward of localForwards) {
        args.push(...localForwardToArgs(localForward));
    }
    args.push(deployHostAddressNoPort(host), quoteArgIfNeeded(command));
    return args;
}

function validateLocalForwards(localForwards: unknown): string | undefined {
    try {
        for (const localForward of normalizeLocalForwards(localForwards)) {
            localForwardToArgs(localForward);
        }
        return undefined;
    } catch (error) {
        if (error instanceof Error) {
            return error.message;
        }
        return vscode.l10n.t('Invalid localForwards configuration.');
    }
}

function localForwardToArgs(localForward: LocalForward): string[] {
    if (localForward.localSocket && (localForward.bindAddress || localForward.port)) {
        throw new Error(vscode.l10n.t('"localSocket" cannot be specified at the same time with "bindAddress" or "port" in localForwards'));
    }
    if (!localForward.localSocket && !localForward.port) {
        throw new Error(vscode.l10n.t('"port" or "localSocket" required in localForwards'));
    }
    if (localForward.remoteSocket && (localForward.host || localForward.hostPort)) {
        throw new Error(vscode.l10n.t('"remoteSocket" cannot be specified at the same time with "host" or "hostPort" in localForwards'));
    }
    if (!localForward.remoteSocket && (!localForward.host || !localForward.hostPort)) {
        throw new Error(vscode.l10n.t('"host" and "hostPort", or "remoteSocket" required in localForwards'));
    }

    let arg = '';
    if (localForward.localSocket) {
        arg += `${localForward.localSocket}:`;
    }
    if (localForward.bindAddress) {
        arg += `${localForward.bindAddress}:`;
    }
    if (localForward.port) {
        arg += `${localForward.port}:`;
    }
    if (localForward.remoteSocket) {
        arg += `${localForward.remoteSocket}`;
    }
    if (localForward.host && localForward.hostPort) {
        arg += `${localForward.host}:${localForward.hostPort}`;
    }

    return ['-L', arg];
}

function quoteArgIfNeeded(value: string): string {
    const escaped = value.replace(/(["\\$`])/g, '\\$1');
    return /[\s"'`$]/.test(value) ? `"${escaped}"` : escaped;
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
