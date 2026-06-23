# C/C++ Debug

A Visual Studio Code extension for debugging C/C++ applications with GDB or LLDB.

## Overview

This extension uses **MIEngine** as its debug adapter. As a result, it is compatible with the launch configurations used by Microsoft's C/C++ extension: existing `launch.json` settings (for example, `type: "cppdbg"`) can be reused directly with this extension.

## Requirements

You should have `gdb` installed.

## Feedback

Please provide feedback by filing an issue on [Github](https://github.com/quanzhuo/cpp-debug/issues)

## Configure C/C++ debugging

A `launch.json` file is used to configure the debugger. To get started with debugging you need to fill in the `program` field with the path to the executable you plan to debug.

example configurations

```json
{
    "name": "C++ Launch",
    "type": "cppdbg",
    "request": "launch",
    "program": "enter program name, for example: ${workspaceFolder}/a.out",
    "args": [],
    "stopAtEntry": false,
    "cwd": "${workspaceFolder}",
    "environment": [],
    "externalConsole": false,
    "MIMode": "gdb",
    "setupCommands": [
        {
            "description": "Enable pretty-printing for gdb",
            "text": "-enable-pretty-printing",
            "ignoreFailures": true
        }
    ],
    "miDebuggerPath": "/usr/bin/gdb"
}
```

## Extension Settings

This extension contributes the following settings under the `cppdebug` namespace:

| Setting | Default | Description |
|---|---|---|
| `cppdebug.enablePrettyPrinting` | `true` | Automatically enable GDB pretty printing for the debugging session. When enabled, the `-enable-pretty-printing` command is injected into the debugger's `setupCommands`. |
| `cppdebug.autoLoadPrettyPrinters` | `true` | Automatically load the extension's bundled [GDB pretty printing scripts](https://github.com/quanzhuo/gdb-pretty-printers). Currently includes pretty printers for **Qt** types (e.g., `QString`, `QList`, `QMap`, etc.). The `autoload.py` script is sourced into GDB during debug session initialization. |

## Detailed Configuration

The table below lists every top-level configuration property exposed in `package.json` for the `launch` and `attach` request types.

| Property | Type | Launch | Attach | Default | Notes |
|---|---|:---:|:---:|---|---|
| program | string | Yes | Yes | `${workspaceFolder}/a.out` | Path to the program to debug. Required in both request types. |
| args | string[] | Yes | No | `[]` | Command-line arguments passed to the launched program. |
| type | string | Yes | Yes | `cppdbg` | Debugger type identifier. |
| targetArchitecture | string | Yes | Yes | `x64` | Target architecture. Deprecated and usually auto-detected. |
| cwd | string | Yes | No | `.` | Working directory for the launched program. |
| setupCommands | object[] | Yes | Yes | `[]` | Commands executed to initialize GDB or LLDB. |
| postRemoteConnectCommands | object[] | Yes | No | `[]` | Commands executed after a remote connection is established. |
| customLaunchSetupCommands | object[] | Yes | No | `[]` | Replaces the default launch setup commands. |
| launchCompleteCommand | enum | Yes | No | `exec-run` | Command executed after debugger setup completes. |
| visualizerFile | string / string[] | Yes | Yes | `""` / `[]` | Natvis file or files used for visualization. |
| svdPath | string | Yes | No | `""` | The full path to an embedded device's SVD file. |
| showDisplayString | boolean | Yes | Yes | `true` | Enables display strings when a visualizer file is used. |
| environment | object[] | Yes | No | `[]` | Environment variables passed to the launched program. |
| envFile | string | Yes | No | `${workspaceFolder}/.env` | File used to load environment variables. |
| additionalSOLibSearchPath | string | Yes | Yes | `""` | Additional shared library search paths. |
| MIMode | string | Yes | Yes | `gdb` | MI debugger mode. |
| miDebuggerPath | string | Yes | Yes | `/usr/bin/gdb` | Path to the debugger executable. |
| miDebuggerArgs | string | Yes | Yes | `""` | Extra arguments passed to the debugger. |
| miDebuggerServerAddress | string | Yes | Yes | `serveraddress:port` | Remote debugger server address. |
| useExtendedRemote | boolean | Yes | Yes | `false` | Uses extended remote mode when connecting. |
| stopAtEntry | boolean | Yes | No | `false` | Stops at the program entry point. |
| debugServerPath | string | Yes | No | `""` | Path to the debug server executable. |
| debugServerArgs | string | Yes | No | `""` | Arguments passed to the debug server. |
| serverStarted | string | Yes | No | `""` | Pattern used to detect when the debug server has started. |
| filterStdout | boolean | Yes | Yes | `true` | Searches stdout for the server-started pattern. |
| filterStderr | boolean | Yes | Yes | `false` | Searches stderr for the server-started pattern. |
| serverLaunchTimeout | integer | Yes | No | `10000` | Timeout in milliseconds for the debug server to start. |
| coreDumpPath | string | Yes | No | `""` | Path to a core dump file. |
| externalConsole | boolean | Yes | No | `false` | Uses an external console for the launched program. |
| avoidWindowsConsoleRedirection | boolean | Yes | No | `false` | Disables console redirection on Windows. |
| sourceFileMap | object | Yes | Yes | `{ "<source-path>": "<target-path>" }` | Maps debugger source paths to local source paths. |
| logging | object | Yes | Yes | `{}` | Controls debugger logging behavior. |
| pipeTransport | object | Yes | Yes | `{}` | Configures pipe-based transport for remote scenarios. |
| symbolLoadInfo | object | Yes | Yes | `{ "loadAll": true, "exceptionList": "" }` | Controls symbol loading behavior. |
| stopAtConnect | boolean | Yes | No | `false` | Stops after connecting to the target. |
| hardwareBreakpoints | object | Yes | No | `{}` | Controls hardware breakpoint usage. |
| unknownBreakpointHandling | string | Yes | No | `throw` | Behavior for unknown breakpoints. |
| debuginfod | object | Yes | Yes | `{}` | Configures debuginfod behavior. |
| variables | object | Yes | Yes | `{ "<variable-name>": "<variable-value>" }` | Custom variable substitutions. |
| deploySteps | array | Yes | Yes | `[]` | Deployment steps executed before debugging. |
| processId | string / integer | No | Yes | `${command:pickProcess}` / `0` | Process ID used for attaching. |
