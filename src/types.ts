import { DebugProtocol } from "@vscode/debugprotocol";

export interface DebuggerCommand {
    /**
     * The debugger command to execute.
     */
    text: string;

    /**
     * If true, failures from the command should be ignored. Default value is false.
     */
    ignoreFailures: boolean;

    /**
     * Optional description for the command.
     */
    description: string;
}

export interface EnvItem {
    name: string;
    value: string;
}

export type SourceFileMapInfo = {
    [key: string]: string;
} | {
    [key: string]: {
        /**
         * The path to the source tree the editor will use.
         */
        editorPath: string;

        /**
         * False if this entry is only used for stack frame location mapping. 
         * True if this entry should also be used when specifying breakpoint locations.
         */
        useForBreakpoints: boolean;
    };
}

export interface LoggingSetup {
    /**
     * Optional flag to determine whether exception messages should be logged to the Debug Console. Defaults to true.
     */
    exceptions?: boolean;

    /**
     * Optional flag to determine whether module load events should be logged to the Debug Console. Defaults to true.
     */
    moduleLoad?: boolean;

    /**
     * Optional flag to determine whether program output should be logged to the Debug Console. Defaults to true.
     */
    programOutput?: boolean;

    /**
     * Optional flag to determine whether diagnostic debug engine messages should be logged to the Debug Console. Defaults to false.
     */
    engineLogging?: boolean | 'verbose' | 'warning' | 'error' | 'none';

    /**
     * Optional flag to determine whether diagnostic adapter command tracing should be logged to the Debug Console. Defaults to false.
     */
    trace?: boolean;

    /**
     * Optional flag to determine whether diagnostic adapter command and response tracing should be logged to the Debug Console. Defaults to false.
     */
    traceResponse?: boolean;

    /**
     * Optional flag to determine whether diagnostic natvis messages should be logged to the Debug Console. Defaults to None.
     */
    natvisDiagnostics?: boolean | 'verbose' | 'warning' | 'error' | 'none';
}

interface PipeTransport {
    /**
     * The fully qualified path to the working directory for the pipe program.
     */
    pipeCwd?: string;

    /**
     * enter the fully qualified path for the pipe program name, for example '/usr/bin/ssh'.
     */
    pipeProgram: string;

    /**
     * Command line arguments passed to the pipe program to configure the connection.
     */
    pipeArgs?: string[];

    /**
     * The full path to the debugger on the target machine, for example /usr/bin/gdb.
     */
    debuggerPath: string;

    /**
     * Environment variables passed to the pipe program.
     */
    pipeEnv?: { [key: string]: string; };

    /**
     * If the pipeProgram's individual arguments contain characters (such as spaces or tabs), 
     * should it be quoted? If 'false', the debugger command will no longer be automatically quoted. Default is 'true'.
     */
    quoteArgs?: boolean;
}

interface SymbolLoadInfo {
    /**
     * If true, symbols for all libs will be loaded, otherwise no solib symbols will be loaded. Default value is true.
     */
    loadAll: boolean;

    /**
     * List of filenames (wildcards allowed) separated by semicolons ';'. Modifies behavior of LoadAll. 
     * If LoadAll is true then don't load symbols for libs that match any name in the list. 
     * Otherwise only load symbols for libs that match. Example: "foo.so;bar.so".
     */
    exceptionList: string;
}

interface HardwareBreakpoints {
    /**
     * If true, always use hardware breakpoints. Defaults to false.
     */
    required: boolean;

    /**
     * Optional limit on the number of available hardware breakpoints to use. 
     * Only enforced when "require" is true and "limit" is greater than 0. Defaults to 0.
     */
    limit: number;
}

interface LocalForwardInfo {
    /**
     * Local address
     */
    bindAddress: string;

    /**
     * Local port
     */
    port: number | string;

    /**
     * Host Name
     */
    host: string;

    /**
     * Host Port
     */
    hostPort: number | string;

    /**
     * Local socket
     */
    localSocket: string;

    /**
     * Remote socket
     */
    remoteSocket: string;
}

interface HostInfo {
    /**
     * User logging into the host.
     */
    user?: string;

    /**
     * Host name.
     */
    hostName: string;

    /**
     * SSH port on the host. Default is 22.
     */
    port?: number | string;

    /**
     * Connect to the target host by first making a connection to the jump hosts.
     */
    jumpHosts?: JumpHostObject[];

    /**
     * Forward connections to the given TCP port or Unix socket on the local (client) host to the given host and port, or Unix socket, on the remote side
     */
    localForwards?: LocalForwardInfo[];
}

interface JumpHostObject {
    user: string;
    hostName: string;
    port: number | string;
}

type DeployStep = {
    type: 'scp' | 'rsync';
    
    /**
     * Files to be copied. Supports path pattern.
     */
    files: string | string[];
    host: string | HostInfo;
    
    /**
     * Target directory.
     */
    targetDir: string;

    /**
     * If true, copies folders recursively.
     */
    recursive?: boolean;

    /**
     * If true, skip when starting without debugging. If false, skip when starting debugging. If undefined, never skip.
     */
    debug?: boolean;
} | {
    type: "ssh";
    host: string | HostInfo;
    
    /**
     * Command to be executed via SSH. The command after '-c' in SSH command.
     */
    command: string;
    
    /**
     * Optional full path to SSH. Assumes SSH is on PATH if not specified
     */
    sshPath?: string;
    
    /**
     * An optional finish pattern in output. When this pattern is seen in the output, continue the deploy procedures regardless of whether this step returns.
     */
    continueOn?: string;
    debug?: boolean;
} | {
    type: "shell";

    /**
     * Shell command to be executed.
     */
    command: string;
    continueOn?: string;
    debug?: boolean;
} | {
    type: "command";
    command: string;
    args: string[];
}

export interface CppDbgLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /**
     * Full path to program executable.
     */
    program: string;

    /**
     * Command line arguments passed to the program.
     */
    args?: string[];

    /**
     * The type of the engine. Must be "cppdbg".
     */
    type?: 'cppdbg';

    /**
     * The architecture of the debuggee. This will automatically be detected unless this parameter is set. 
     * Allowed values are x86, arm, arm64, mips, x64, amd64, x86_64.
     */
    targetArchitecture?: string;

    /**
     * The working directory of the target.
     */
    cwd?: string;

    /**
     * One or more GDB/LLDB commands to execute in order to setup the underlying debugger. 
     * Example: "setupCommands": [ 
     *  { 
     *      "text": "-enable-pretty-printing", 
     *      "description": "Enable GDB pretty printing", 
     *      "ignoreFailures": true 
     *  }
     * ].
     */
    setupCommands?: DebuggerCommand[];

    /**
     * One or more commands that execute after remote connection to a debug server.
     */
    postRemoteConnectCommands?: DebuggerCommand[];

    /**
     * If provided, this replaces the default commands used to launch a target with some other commands.
     * For example, this can be "-target-attach" in order to attach to a target process. 
     * An empty command list replaces the launch commands with nothing, which can be useful if the debugger is being provided launch options as command line options. 
     * Example: "customLaunchSetupCommands": [ { "text": "target-run", "description": "run target", "ignoreFailures": false }].
     */
    customLaunchSetupCommands?: DebuggerCommand[];

    /**
     * The command to execute after the debugger is fully setup in order to cause the target process to run. 
     * Allowed values are "exec-run", "exec-continue", "None". The default value is "exec-run".
     */
    launchCompleteCommand?: 'exec-run' | 'exec-continue' | 'None';

    /**
     * .natvis file to be used when debugging this process. This option is not compatible with GDB pretty printing. 
     * Please also see "showDisplayString" if using this setting.
     */
    visualizerFile?: string | string[];

    /**
     * The full path to an embedded device's SVD file.
     */
    svdPath?: string;

    /**
     * When a visualizerFile is specified, showDisplayString will enable the display string.
     * Turning this option on can cause slower performance during debugging.
     */
    showDisplayString?: boolean;

    /**
     * Environment variables to add to the environment for the program. 
     * Example: [ { "name": "config", "value": "Debug" } ], not [ { "config": "Debug" } ].
     */
    environment?: EnvItem[];

    /**
     * Absolute path to a file containing environment variable definitions.
     * This file has key value pairs separated by an equals sign per line. E.g. KEY=VALUE.
     */
    envFile?: string;

    /**
     * Semicolon separated list of directories to use to search for .so files. Example: "c:\\dir1;c:\\dir2".
     */
    additionalSOLibSearchPath?: string;

    /**
     * Indicates the console debugger that the MIDebugEngine will connect to. Allowed values are "gdb" and "lldb".
     */
    MIMode?: 'gdb' | 'lldb';

    /**
     * The path to the MI debugger (such as gdb). When unspecified, it will search path first for the debugger.
     */
    miDebuggerPath?: string;

    /**
     * Additional arguments for the MI debugger (such as gdb).
     */
    miDebuggerArgs?: string;

    /**
     * Network address of the MI Debugger Server to connect to (example: localhost:1234).
     */
    miDebuggerServerAddress?: string;

    /**
     * Connect to the MI Debugger Server with target extended-remote mode.
     */
    useExtendedRemote?: boolean;

    /**
     * Optional parameter. If true, the debugger should stop at the entrypoint of the target. If processId is passed, has no effect.
     */
    stopAtEntry?: boolean;

    /**
     * Optional full path to the debug server to launch. Defaults to null. It is used in conjunction with either 
     * "miDebugServerAddress" or your own server with a "customSetupCommand" that runs "-target-select remote <server:port>".
     */
    debugServerPath?: string;

    /**
     * Optional debug server args. Defaults to null.
     */
    debugServerArgs?: string;

    /**
     * Optional server-started pattern to look for in the debug server output. Defaults to null.
     */
    serverStarted?: string;

    /**
     * Search stdout stream for server-started pattern and log stdout to debug output. Defaults to true.
     */
    filterStdout?: boolean;

    /**
     * Search stderr stream for server-started pattern and log stderr to debug output. Defaults to false.
     */
    filterStderr?: boolean;

    /**
     * Optional time, in milliseconds, for the debugger to wait for the debugServer to start up. Default is 10000.
     */
    serverLaunchTimeout?: number;

    /**
     * Optional full path to a core dump file for the specified program. Defaults to null.
     */
    coreDumpPath?: string;

    /**
     * If true, a console is launched for the debuggee. If false, on Linux and Windows, it will appear in the Integrated Console.
     */
    externalConsole?: boolean;

    /**
     * If true, disables debuggee console redirection that is required for Integrated Terminal support.
     */
    avoidWindowsConsoleRedirection?: boolean;

    /**
     * Optional source file mappings passed to the debug engine. Example: '{ "/original/source/path":"/current/source/path" }'.
     */
    sourceFileMap?: SourceFileMapInfo;

    /**
     * Optional flags to determine what types of messages should be logged to the Debug Console.
     */
    logging?: LoggingSetup;

    /**
     * When present, this tells the debugger to connect to a remote computer using another executable as a pipe that will
     * relay standard input/output between VS Code and the MI-enabled debugger backend executable (such as gdb).
     */
    pipeTransport?: PipeTransport;

    /**
     * Explicit control of symbol loading.
     */
    symbolLoadInfo?: SymbolLoadInfo;

    /**
     * If true, the debugger should stop after connecting to the target. 
     * If false, the debugger will continue after connecting. Defaults to false.
     */
    stopAtConnect?: boolean;

    /**
     * Explicit control of hardware breakpoint behavior for remote targets.
     */
    hardwareBreakpoints?: HardwareBreakpoints;

    /**
     * Controls how breakpoints set externally (usually via raw GDB commands) are handled when hit.
     * Allowed values are "throw", which acts as if an exception was thrown by the application,
     * and "stop", which only pauses the debug session. The default value is "throw".
     */
    unknownBreakpointHandling?: 'throw' | 'stop';

    /**
     * Variables for recursive substitution in this launch configuration. Each variable may refer to others.
     */
    variables?: { [key: string]: string; };

    /**
     * Steps needed to deploy the application. Order matters.
     */
    deploySteps?: DeployStep[];
}

export interface CppDbgAttachRequestArguments extends DebugProtocol.AttachRequestArguments {
    /**
     * Full path to program executable.
     */
    program: string;

    /**
     * The type of the engine. Must be "cppdbg".
     */
    type: "cppdbg";

    /**
     * The architecture of the debuggee. This will automatically be detected unless this parameter is set. 
     * Allowed values are x86, arm, arm64, mips, x64, amd64, x86_64.
     */
    targetArchitecture?: string;

    /**
     * .natvis file to be used when debugging this process. This option is not compatible with GDB pretty printing. 
     * Please also see "showDisplayString" if using this setting.
     */
    visualizerFile?: string | string[];

    /**
     * When a visualizerFile is specified, showDisplayString will enable the display string.
     * Turning this option on can cause slower performance during debugging.
     */
    showDisplayString?: boolean;

    /**
     * Semicolon separated list of directories to use to search for .so files. Example: "c:\\dir1;c:\\dir2".
     */
    additionalSOLibSearchPath?: string;

    /**
     * Indicates the console debugger that the MIDebugEngine will connect to. Allowed values are "gdb" and "lldb".
     */
    MIMode?: 'gdb' | 'lldb';

    /**
     * The path to the MI debugger (such as gdb). When unspecified, it will search path first for the debugger.
     */
    miDebuggerPath?: string;

    /**
     * Additional arguments for the MI debugger (such as gdb).
     */
    miDebuggerArgs?: string;

    /**
     * Network address of the MI Debugger Server to connect to (example: localhost:1234).
     */
    miDebuggerServerAddress?: string;

    /**
     * Connect to the MI Debugger Server with target extended-remote mode.
     */
    useExtendedRemote?: boolean;

    processId?: number | string;

    /**
     * Search stdout stream for server-started pattern and log stdout to debug output. Defaults to true.
     */
    filterStdout?: boolean;

    /**
     * Search stderr stream for server-started pattern and log stderr to debug output. Defaults to false.
     */
    filterStderr?: boolean;

    /**
     * Optional source file mappings passed to the debug engine. Example: '{ "/original/source/path":"/current/source/path" }'.
     */
    sourceFileMap?: SourceFileMapInfo;

    /**
     * Optional flags to determine what types of messages should be logged to the Debug Console.
     */
    logging?: LoggingSetup;

    /**
     * When present, this tells the debugger to connect to a remote computer using another executable as a pipe that will
     * relay standard input/output between VS Code and the MI-enabled debugger backend executable (such as gdb).
     */
    pipeTransport?: PipeTransport;

    /**
     * One or more GDB/LLDB commands to execute in order to setup the underlying debugger. 
     * Example: "setupCommands": [ 
     *  { 
     *      "text": "-enable-pretty-printing", 
     *      "description": "Enable GDB pretty printing", 
     *      "ignoreFailures": true 
     *  }
     * ].
     */
    setupCommands?: DebuggerCommand[];

    /**
     * Explicit control of symbol loading.
     */
    symbolLoadInfo?: SymbolLoadInfo;

    /**
     * Variables for recursive substitution in this launch configuration. Each variable may refer to others.
     */
    variables?: { [key: string]: string; };

    /**
     * Steps needed to deploy the application. Order matters.
     */
    deploySteps?: DeployStep[];
}
