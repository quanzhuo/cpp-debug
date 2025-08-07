# Cpp Debug README

[中文说明](#cpp-debug-说明)

This extension integrates [MIEngine](https://github.com/microsoft/MIEngine), support debugging of C/C++ programs using gdb.

* Although MIEngine support lldb, this extension mainly support gdb, so we test little on lldb
* Since this extension use the same debug adaptor(MIEngine) as ms-vscode.cpptools, the same type attribute "cppdbg" is set as ms-vscode.cpptools. The launch.json file using for ms-vscode.cpptools might use for this extension directly
* This extension support linux-x64 and linux-arm64 only

## Requirements

You need to install gdb on your computer.

## Feedback

Please provide feedback by filing an issue on [Gitee](https://gitee.com/quanzhuo/cpp-debug/issues)

## Configure C/C++ debugging

A `launch.json` file is used to configure the debugger. To get started with debugging you need to fill in the `program` field with the path to the executable you plan to debug.

example configurations

```json
{
    "name": "C++ Launch",
    "type": "cppdbg",
    "request": "launch",
    "program": "此处请设置为被调试的程序路径，例如：${workspaceFolder}/a.out",
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

## Detailed Configuration

### program (required)

Specifies the full path to the executable the debugger will launch or attach to. The debugger requires this location in order to load debug symbols.

### symbolSearchPath

Tells the Visual Studio Windows Debugger what paths to search for symbol (.pdb) files. Separate multiple paths with a semicolon. For example: `"C:\\Symbols;C:\\SymbolDir2"`.

### requireExactSource

An optional flag that tells the Visual Studio Windows Debugger to require current source code to match the pdb.

### additionalSOLibSearchPath

Tells GDB or LLDB what paths to search for .so files. Separate multiple paths with a semicolon. For example: `"/Users/user/dir1;/Users/user/dir2"`.

### externalConsole

Used only when launching the debuggee. For `attach`, this parameter does not change the debuggee's behavior.

* **Windows**: When set to true, it will spawn an external console. When set to false, it will use integratedTerminal.
* **Linux**: When set to true, it will spawn an external console. When set to false, it will use integratedTerminal.
* **macOS**: When set to true, it will spawn an external console through `lldb-mi`. When set to false, the output can be seen in debugConsole. Due to limitations within `lldb-mi`, integratedTerminal support is not available.

### avoidWindowsConsoleRedirection

In order to support Integrated Terminal with gdb on Windows, the extension adds console redirection commands to the debuggee's arguments to have console input and output show up in the integrated terminal. Setting this option to `true` will disable it.

### logging

Optional flags to determine what types of messages should be logged to the Debug Console.

* **exceptions**: Optional flag to determine whether exception messages should be logged to the Debug Console. Defaults to true.
* **moduleLoad**: Optional flag to determine whether module load events should be logged to the Debug Console. Defaults to true.
* **programOutput**: Optional flag to determine whether program output should be logged to the Debug Console. Defaults to true.
* **engineLogging**: Optional flag to determine whether diagnostic engine logs should be logged to the Debug Console. Defaults to false.
* **trace**: Optional flag to determine whether diagnostic adapter command tracing should be logged to the Debug Console. Defaults to false.
* **traceResponse**: Optional flag to determine whether diagnostic adapter command and response tracing should be logged to the Debug Console. Defaults to false.

### visualizerFile

`.natvis` file to be used when debugging. See [Create custom views of native objects](https://learn.microsoft.com/visualstudio/debugger/create-custom-views-of-native-objects) for information on how to create Natvis files.

### showDisplayString

When a `visualizerFile` is specified, `showDisplayString` will enable the display string. Turning on this option can cause slower performance during debugging.

**Example:**

```json
{
   "name": "C++ Launch (Windows)",
   "type": "cppvsdbg",
   "request": "launch",
   "program": "C:\\app1\\Debug\\app1.exe",
   "symbolSearchPath": "C:\\Symbols;C:\\SymbolDir2",
   "externalConsole": true,
   "logging": {
       "moduleLoad": false,
       "trace": true
    },
   "visualizerFile": "${workspaceFolder}/my.natvis",
   "showDisplayString": true
}
```

### args

JSON array of command-line arguments to pass to the program when it is launched. Example `["arg1", "arg2"]`. If you are escaping characters, you will need to double escape them. For example, `["{\\\"arg1\\\": true}"]` will send `{"arg1": true}` to your application.

### cwd

Sets the working directory of the application launched by the debugger.

### environment

Environment variables to add to the environment for the program. Example: `[ { "name": "config", "value": "Debug" } ]`, not `[ { "config": "Debug" } ]`.

**Example:**

```json
{
   "name": "C++ Launch",
   "type": "cppdbg",
   "request": "launch",
   "program": "${workspaceFolder}/a.out",
   "args": ["arg1", "arg2"],
   "environment": [{"name": "config", "value": "Debug"}],
   "cwd": "${workspaceFolder}"
}
```

### MIMode

Indicates the debugger that will connect to. Must be set to `gdb` or `lldb`. This is pre-configured on a per-operating system basis and can be changed as needed.

### miDebuggerPath

The path to the debugger (such as gdb). When only the executable is specified, it will search the operating system's PATH variable for a debugger (GDB on Linux and Windows, LLDB on OS X).

### miDebuggerArgs

Additional arguments to pass to the debugger (such as gdb). For example: specify the code path `"miDebuggerArgs": "--directory=${workspaceRoot}/xxx"`.

### stopAtEntry

If set to true, the debugger should stop at the entry-point of the target (ignored on attach). Default value is `false`.

### stopAtConnect

If set to true, the debugger should stop after connecting to the target. If set to false, the debugger will continue after connecting. Default value is `false`.

### setupCommands

JSON array of commands to execute in order to set up the GDB or LLDB. Example: `"setupCommands": [ { "text": "target-run", "description": "run target", "ignoreFailures": false }]`.

### customLaunchSetupCommands

If provided, this replaces the default commands used to launch a target with some other commands. For example, this can be "-target-attach" in order to attach to a target process. An empty command list replaces the launch commands with nothing, which can be useful if the debugger is being provided launch options as command-line options. Example: `"customLaunchSetupCommands": [ { "text": "target-run", "description": "run target", "ignoreFailures": false }]`.

### launchCompleteCommand

The command to execute after the debugger is fully set up in order to cause the target process to run. Allowed values are "exec-run", "exec-continue", "None". The default value is "exec-run".

**Example:**

```json
{
   "name": "C++ Launch",
   "type": "cppdbg",
   "request": "launch",
   "program": "${workspaceFolder}/a.out",
   "stopAtEntry": false,
   "customLaunchSetupCommands": [
      { "text": "target-run", "description": "run target", "ignoreFailures": false }
   ],
   "launchCompleteCommand": "exec-run",
   "linux": {
      "MIMode": "gdb",
      "miDebuggerPath": "/usr/bin/gdb"
   },
   "osx": {
      "MIMode": "lldb"
   },
   "windows": {
      "MIMode": "gdb",
      "miDebuggerPath": "C:\\MinGw\\bin\\gdb.exe"
   }
}
```

### symbolLoadInfo

* **loadAll**: If true, symbols for all libs will be loaded, otherwise no solib symbols will be loaded. Modified by ExceptionList. Default value is true.
* **exceptionList**: List of filenames (wildcards allowed) separated by semicolons `;`. Modifies behavior of LoadAll. If LoadAll is true then don't load symbols for libs that match any name in the list. Otherwise only load symbols for libs that match. Example: ```"foo.so;bar.so"```

### dumpPath

If you want to debug a Windows dump file, set this to the path to the dump file to start debugging in the `launch` configuration.

### coreDumpPath

Full path to a core dump file to debug for the specified program. Set this to the path to the core dump file to start debugging in the `launch` configuration.
_Note: core dump debugging is not supported with MinGw._

### miDebuggerServerAddress

Network address of the debugger server (for example, gdbserver) to connect to for remote debugging (example: localhost:1234).

### debugServerPath

Full path to debug server to launch.

### debugServerArgs

Arguments for the debugger server.

### serverStarted

Server-started pattern to look for in the debug server output. Regular expressions are supported.

### filterStdout

If set to true, search stdout stream for server-started pattern and log stdout to debug output. Default value is true.

### filterStderr

If set to true, search stderr stream for server-started pattern and log stderr to debug output. Default value is false.

### serverLaunchTimeout

Time in milliseconds, for the debugger to wait for the debugServer to start up. Default is 10000.

### pipeTransport

For information about attaching to a remote process, such as debugging a process in a Docker container, see the Pipe transport settings article.

### hardwareBreakpoints

If provided, this explicitly controls hardware breakpoint behavior for remote targets. If require is set to true, always use hardware breakpoints. Default value is false. limit is an optional limit on the number of available hardware breakpoints to use which is only enforced when require is true and limit is greater than 0. Defaults value is 0. Example: "hardwareBreakpoints": { require: true, limit: 6 }.

### processId

Defaults to ${command:pickProcess} which will display a list of available processes the debugger can attach to. We recommend that you leave this default, but the property can be explicitly set to a specific process ID for the debugger to attach to.

### request

Indicates whether the configuration section is intended to `launch` the program or `attach` to an already running instance.

### targetArchitecture

Deprecated, This option is no longer needed as the target architecture is automatically detected.

### type

Indicates the underlying debugger being used. Must be `cppdbg`。

### sourceFileMap

This allows mapping of the compile-time paths for source to local source locations. It is an object of key/value pairs and will resolve the first string-matched path. (example: `"sourceFileMap": { "/mnt/c": "c:\\" }` will map any path returned by the debugger that begins with `/mnt/c` and convert it to `c:\\`. You can have multiple mappings in the object but they will be handled in the order provided.)

# Cpp Debug 说明

[Readme in English](#cpp-debug-readme)

此插件集成了 [MIEngine](https://github.com/microsoft/MIEngine)，支持使用 gdb 调试 C/C++ 程序。

* 尽管 MIEngine 支持 lldb，但此插件主要支持 gdb，因此我们对 lldb 的测试较少
* 由于此插件使用与 ms-vscode.cpptools 相同的调试适配器（MIEngine），因此设置了与 ms-vscode.cpptools 相同的类型属性 "cppdbg"。用于 ms-vscode.cpptools 的 launch.json 文件大概率可以直接用于此插件
* 该插件仅支持 linux-x64 平台和 linux-arm64 平台

## 要求

你需要在电脑上安装 gdb。

## 反馈

请通过在 [Gitee](https://gitee.com/quanzhuo/cpp-debug/issues) 上提交问题来提供反馈

## 配置 C/C++ 调试

`launch.json` 文件用于配置调试器。要开始调试，你需要在 `program` 字段中填写你计划调试的可执行文件的路径。

示例配置

```json
{
    "name": "C++ Launch",
    "type": "cppdbg",
    "request": "launch",
    "program": "此处请设置为被调试的程序路径，例如：${workspaceFolder}/a.out",
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

## 详细配置

### program（必需）

指定调试器将启动或附加到的可执行文件的完整路径。调试器需要此位置以加载调试符号。

### symbolSearchPath

告诉 Visual Studio Windows 调试器要搜索符号 (.pdb) 文件的路径。用分号分隔多个路径。例如：`"C:\\Symbols;C:\\SymbolDir2"`。

### requireExactSource

一个可选标志，告诉 Visual Studio Windows 调试器要求当前源代码与 pdb 匹配。

### additionalSOLibSearchPath

告诉 GDB 或 LLDB 要搜索 .so 文件的路径。用分号分隔多个路径。例如：`"/Users/user/dir1;/Users/user/dir2"`。

### externalConsole

仅在启动被调试程序时使用。对于 `attach`，此参数不会更改被调试程序的行为。

* **Windows**：当设置为 true 时，它将生成一个外部控制台。当设置为 false 时，它将使用集成终端。
* **Linux**：当设置为 true 时，它将生成一个外部控制台。当设置为 false 时，它将使用集成终端。
* **macOS**：当设置为 true 时，它将通过 `lldb-mi` 生成一个外部控制台。当设置为 false 时，输出可以在 debugConsole 中看到。由于 `lldb-mi` 的限制，不支持 integratedTerminal。

### avoidWindowsConsoleRedirection

为了支持在 Windows 上使用集成终端，插件会向被调试程序的参数添加控制台重定向命令，以便在集成终端中显示控制台输入和输出。将此选项设置为 `true` 将禁用它。

### logging

可选标志，用于确定哪些类型的消息应记录到调试控制台。

* **exceptions**：可选标志，用于确定是否将异常消息记录到调试控制台。默认值为 true。
* **moduleLoad**：可选标志，用于确定是否将模块加载事件记录到调试控制台。默认值为 true。
* **programOutput**：可选标志，用于确定是否将程序输出记录到调试控制台。默认值为 true。
* **engineLogging**：可选标志，用于确定是否将诊断引擎日志记录到调试控制台。默认值为 false。
* **trace**：可选标志，用于确定是否将诊断适配器命令跟踪记录到调试控制台。默认值为 false。
* **traceResponse**：可选标志，用于确定是否将诊断适配器命令和响应跟踪记录到调试控制台。默认值为 false。

### visualizerFile

调试时使用的 `.natvis` 文件。有关如何创建 Natvis 文件的信息，请参阅 [创建本机对象的自定义视图](https://learn.microsoft.com/visualstudio/debugger/create-custom-views-of-native-objects)。

### showDisplayString

当指定了 `visualizerFile` 时，`showDisplayString` 将启用显示字符串。启用此选项可能会导致调试期间性能变慢。

**示例：**

```json
{
   "name": "C++ Launch (Windows)",
   "type": "cppvsdbg",
   "request": "launch",
   "program": "C:\\app1\\Debug\\app1.exe",
   "symbolSearchPath": "C:\\Symbols;C:\\SymbolDir2",
   "externalConsole": true,
   "logging": {
       "moduleLoad": false,
       "trace": true
    },
   "visualizerFile": "${workspaceFolder}/my.natvis",
   "showDisplayString": true
}
```

### args

传递给程序的命令行参数的 JSON 数组。例如 `["arg1", "arg2"]`。如果你要转义字符，你需要双重转义它们。例如，`["{\\\"arg1\\\": true}"]` 将发送 `{"arg1": true}` 给你的应用程序。

### cwd

设置调试器启动的应用程序的工作目录。

### environment

添加到程序环境中的环境变量。例如：`[ { "name": "config", "value": "Debug" } ]`，而不是 `[ { "config": "Debug" } ]`。

**示例：**

```json
{
   "name": "C++ Launch",
   "type": "cppdbg",
   "request": "launch",
   "program": "${workspaceFolder}/a.out",
   "args": ["arg1", "arg2"],
   "environment": [{"name": "config", "value": "Debug"}],
   "cwd": "${workspaceFolder}"
}
```

### MIMode

指示连接到的调试器。必须设置为 `gdb` 或 `lldb`。这是根据操作系统预配置的，可以根据需要更改。

### miDebuggerPath

调试器（如 gdb）的路径。当只指定可执行文件时，它将搜索操作系统的 PATH 变量以查找调试器（Linux 和 Windows 上的 GDB，OS X 上的 LLDB）。

### miDebuggerArgs

传递给调试器（如 gdb）的附加参数。例如：指定代码路径 `"miDebuggerArgs": "--directory=${workspaceRoot}/xxx"`

### stopAtEntry

如果设置为 true，调试器应在目标的入口点停止（在附加时忽略）。默认值为 `false`。

### stopAtConnect

如果设置为 true，调试器应在连接到目标后停止。如果设置为 false，调试器将在连接后继续。默认值为 `false`。

### setupCommands

用于设置 GDB 或 LLDB 的命令的 JSON 数组。例如：`"setupCommands": [ { "text": "target-run", "description": "run target", "ignoreFailures": false }]`。

### customLaunchSetupCommands

如果提供，这将用其他命令替换用于启动目标的默认命令。例如，这可以是 "-target-attach" 以附加到目标进程。空命令列表将启动命令替换为空，这在调试器作为命令行选项提供启动选项时很有用。例如：`"customLaunchSetupCommands": [ { "text": "target-run", "description": "run target", "ignoreFailures": false }]`。

### launchCompleteCommand

调试器完全设置后执行的命令，以使目标进程运行。允许的值为 "exec-run"、"exec-continue"、"None"。默认值为 "exec-run"。

**示例：**

```json
{
   "name": "C++ Launch",
   "type": "cppdbg",
   "request": "launch",
   "program": "${workspaceFolder}/a.out",
   "stopAtEntry": false,
   "customLaunchSetupCommands": [
      { "text": "target-run", "description": "run target", "ignoreFailures": false }
   ],
   "launchCompleteCommand": "exec-run",
   "linux": {
      "MIMode": "gdb",
      "miDebuggerPath": "/usr/bin/gdb"
   },
   "osx": {
      "MIMode": "lldb"
   },
   "windows": {
      "MIMode": "gdb",
      "miDebuggerPath": "C:\\MinGw\\bin\\gdb.exe"
   }
}
```

### symbolLoadInfo

* **loadAll**：如果为 true，将加载所有库的符号，否则不加载任何 solib 符号。由 ExceptionList 修改。默认值为 true。
* **exceptionList**：文件名列表（允许使用通配符），用分号 `;` 分隔。修改 LoadAll 的行为。如果 LoadAll 为 true，则不加载与列表中任何名称匹配的库的符号。否则，仅加载与库匹配的符号。例如：```"foo.so;bar.so"```

### dumpPath

如果你想调试 Windows 转储文件，请将其设置为转储文件的路径，以在 `launch` 配置中开始调试。

### coreDumpPath

要调试的指定程序的核心转储文件的完整路径。将其设置为核心转储文件的路径，以在 `launch` 配置中开始调试。
_注意：MinGw 不支持核心转储调试。_

### miDebuggerServerAddress

调试服务器（例如，gdbserver）的网络地址，用于连接进行远程调试（例如：localhost:1234）。

### debugServerPath

要启动的调试服务器的完整路径。

### debugServerArgs

调试服务器的参数。

### serverStarted

在调试服务器输出中查找的服务器启动模式。支持正则表达式。

### filterStdout

如果设置为 true，则在 stdout 流中搜索服务器启动模式，并将 stdout 记录到调试输出。默认值为 true。

### filterStderr

如果设置为 true，则在 stderr 流中搜索服务器启动模式，并将 stderr 记录到调试输出。默认值为 false。

### serverLaunchTimeout

调试器等待 debugServer 启动的时间（以毫秒为单位）。默认值为 10000。

### pipeTransport

有关附加到远程进程的信息，例如调试 Docker 容器中的进程，请参阅管道传输设置文章。

### hardwareBreakpoints

如果提供，这将明确控制远程目标的硬件断点行为。如果 require 设置为 true，则始终使用硬件断点。默认值为 false。limit 是对可用硬件断点数量的可选限制，仅在 require 设置为 true 且 limit 大于 0 时强制执行。默认值为 0。示例："hardwareBreakpoints": { require: true, limit: 6 }。

### processId

默认为 ${command:pickProcess}，这将显示调试器可以附加到的可用进程列表。我们建议你保留此默认值，但可以将该属性显式设置为调试器要附加到的特定进程 ID。

### request

指示配置部分是用于 `launch` 程序还是 `attach` 到已运行的实例。

### targetArchitecture

已弃用，此选项不再需要，因为目标架构会自动检测。

### type

指示使用的底层调试器。必须为 `cppdbg`。

### sourceFileMap

这允许将源代码的编译时路径映射到本地源代码位置。它是键/值对的对象，将解析第一个字符串匹配的路径。（例如：`"sourceFileMap": { "/mnt/c": "c:\\" }` 将映射调试器返回的任何以 `/mnt/c` 开头的路径并将其转换为 `c:\\`。你可以在对象中有多个映射，但它们将按提供的顺序处理。）
