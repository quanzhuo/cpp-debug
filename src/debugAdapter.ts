import * as DebugAdapter from '@vscode/debugadapter';
import { ContinuedEvent, DebugSession, Handles, InitializedEvent, OutputEvent, Scope, Source, StackFrame, StoppedEvent, TerminatedEvent, Thread, ThreadEvent } from '@vscode/debugadapter';
import { LogLevel } from '@vscode/debugadapter/lib/logger';
import { DebugProtocol } from '@vscode/debugprotocol';
import { execSync } from 'child_process';
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as systemPath from "path";
import { Breakpoint, MIError, MIReadMemoryResult, ValuesFormattingMode, Variable, VariableObject } from './backend/backend';
import { MI2 } from './backend/mi2/mi2';
import { MI2_LLDB } from './backend/mi2/mi2lldb';
import { MINode } from './backend/miParse';
import { logger, LoggingCategory } from './logger';
import { SourceFileMap } from "./sourceFileMap";
import { CppDbgAttachRequestArguments, CppDbgLaunchRequestArguments, SourceFileMapInfo } from './types';

class VariableScope {
    constructor(public readonly name: string, public readonly threadId: number, public readonly level: number) {
    }

    public static variableName(handle: number, name: string): string {
        return `var_${handle}_${name}`;
    }
}

export enum RunCommand { CONTINUE, RUN, NONE }

export class CppDebugSession extends DebugSession {
    private variableHandles = new Handles<VariableScope | VariableObject>();
    private variableHandlesReverse: { [id: string]: number } = {};
    private scopeHandlesReverse: { [key: string]: number } = {};
    private quit: boolean = false;
    private attached: boolean = false;
    private initialRunCommand: RunCommand = RunCommand.RUN;
    private stopAtEntry: boolean | string = true;
    private isSSH: boolean = false;
    private sourceFileMap!: SourceFileMap;
    private started: boolean = false;
    private crashed: boolean = false;
    private miDebugger!: MI2;
    private commandServer?: net.Server;
    private serverPath!: string;
    private miMode: 'gdb' | 'lldb' = 'gdb';
    private obsolete_logFilePath?: string;

    public constructor(debuggerLinesStartAt1: boolean, isServer: boolean = false) {
        super(debuggerLinesStartAt1, isServer);
    }

    private initDebugger() {
        this.miDebugger.on("launcherror", this.launchError.bind(this));
        this.miDebugger.on("quit", this.quitEvent.bind(this));
        this.miDebugger.on("exited-normally", this.quitEvent.bind(this));
        this.miDebugger.on("stopped", this.stopEvent.bind(this));
        this.miDebugger.on("msg", this.handleMsg.bind(this));
        this.miDebugger.on("breakpoint", this.handleBreakpoint.bind(this));
        this.miDebugger.on("watchpoint", this.handleBreak.bind(this));	// consider to parse old/new, too (otherwise it is in the console only)
        this.miDebugger.on("step-end", this.handleBreak.bind(this));
        //this.miDebugger.on("step-out-end", this.handleBreak.bind(this));  // was combined into step-end
        this.miDebugger.on("step-other", this.handleBreak.bind(this));
        this.miDebugger.on("signal-stop", this.handlePause.bind(this));
        this.miDebugger.on("thread-created", this.threadCreatedEvent.bind(this));
        this.miDebugger.on("thread-exited", this.threadExitedEvent.bind(this));
        this.miDebugger.once("debug-ready", (() => this.sendEvent(new InitializedEvent())));
        try {
            this.commandServer = net.createServer(c => {
                c.on("data", data => {
                    const rawCmd = data.toString();
                    const spaceIndex = rawCmd.indexOf(" ");
                    let func = rawCmd;
                    let args = [];
                    if (spaceIndex !== -1) {
                        func = rawCmd.substring(0, spaceIndex);
                        args = JSON.parse(rawCmd.substring(spaceIndex + 1));
                    }
                    Promise.resolve((this.miDebugger as any)[func].apply(this.miDebugger, args)).then(data => {
                        c.write(data.toString());
                    });
                });
            });
            this.commandServer.on("error", err => {
                if (process.platform !== "win32") {
                    this.handleMsg("stderr", "Code-Debug WARNING: Utility Command Server: Error in command socket " + err.toString() + "\nCode-Debug WARNING: The examine memory location command won't work");
                }
            });
            if (!fs.existsSync(systemPath.join(os.tmpdir(), "code-debug-sockets"))) {
                fs.mkdirSync(systemPath.join(os.tmpdir(), "code-debug-sockets"));
            }
            this.commandServer.listen(this.serverPath = systemPath.join(os.tmpdir(), "code-debug-sockets", ("Debug-Instance-" + Math.floor(Math.random() * 36 * 36 * 36 * 36).toString(36)).toLowerCase()));
        } catch (e: any) {
            if (process.platform !== "win32") {
                this.handleMsg("stderr", "Code-Debug WARNING: Utility Command Server: Failed to start " + e.toString() + "\nCode-Debug WARNING: The examine memory location command won't work");
            }
        }
    }

    // verifies that the specified command can be executed
    private checkCommand(debuggerName: string): boolean {
        try {
            const command = process.platform === 'win32' ? 'where' : 'command -v';
            execSync(`${command} ${debuggerName}`, { stdio: 'ignore' });
            return true;
        } catch (error) {
            return false;
        }
    }

    private setValuesFormattingMode(mode: ValuesFormattingMode) {
        switch (mode) {
            case "disabled":
                this.miDebugger.prettyPrint = false;
                break;
            case "prettyPrinters":
                this.miDebugger.prettyPrint = true;
                break;
        }
    }

    private handleMsg(type: string, msg: string) {
        if (type === "target") {
            type = "stdout";
        }
        if (type === "log") {
            type = "stderr";
        }
        this.sendEvent(new OutputEvent(msg, type));
    }

    private handleBreakpoint(info: MINode) {
        const event = new StoppedEvent("breakpoint", parseInt(info.record("thread-id")));
        (event as DebugProtocol.StoppedEvent).body.allThreadsStopped = info.record("stopped-threads") === "all";
        this.sendEvent(event);
    }

    private handleBreak(info?: MINode) {
        const event = new StoppedEvent("step", info ? parseInt(info.record("thread-id")) : 1);
        (event as DebugProtocol.StoppedEvent).body.allThreadsStopped = info ? info.record("stopped-threads") === "all" : true;
        this.sendEvent(event);
    }

    private handlePause(info: MINode) {
        const event = new StoppedEvent("user request", parseInt(info.record("thread-id")));
        (event as DebugProtocol.StoppedEvent).body.allThreadsStopped = info.record("stopped-threads") === "all";
        this.sendEvent(event);
    }

    private stopEvent(info: MINode) {
        if (!this.started) {
            this.crashed = true;
        }
        if (!this.quit) {
            const event = new StoppedEvent("exception", parseInt(info.record("thread-id")));
            (event as DebugProtocol.StoppedEvent).body.allThreadsStopped = info.record("stopped-threads") === "all";
            this.sendEvent(event);
        }
    }

    private threadCreatedEvent(info: MINode) {
        this.sendEvent(new ThreadEvent("started", info.record("id")));
    }

    private threadExitedEvent(info: MINode) {
        this.sendEvent(new ThreadEvent("exited", info.record("id")));
    }

    private quitEvent() {
        this.quit = true;
        this.sendEvent(new TerminatedEvent());

        if (this.serverPath) {
            fs.unlink(this.serverPath, (err) => {
                console.error("Failed to unlink debug server");
            });
        }
    }

    private launchError(err: any) {
        this.handleMsg("stderr", "Could not start debugger process, does the program exist in filesystem?\n");
        this.handleMsg("stderr", err.toString() + "\n");
        this.quitEvent();
    }

    //#region DebugSession

    protected override initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        response.body = {
            supportsConfigurationDoneRequest: true,
            supportsFunctionBreakpoints: true,
            supportsConditionalBreakpoints: true,
            supportsEvaluateForHovers: true,
            // exceptionBreakpointFilters: [
            //     {
            //         filter: "all",
            //         label: "All C++ Exceptions",
            //         default: false,
            //         supportsCondition: true,
            //         conditionDescription: "std::out_of_range,std::invalid_argument"
            //     }
            // ],
            supportsSetVariable: true,
            supportsGotoTargetsRequest: true,
            supportsCompletionsRequest: true,
            completionTriggerCharacters: [],
            // supportsModulesRequest: true,
            // supportedChecksumAlgorithms: [],
            // supportsValueFormattingOptions: true,
            supportsLogPoints: true,
            // supportsSetExpression: true,
            // supportsDataBreakpoints: true,
            supportsReadMemoryRequest: true,
            // supportsDisassembleRequest: true,
            // supportsClipboardContext: true,
            // supportsSteppingGranularity: true,
            // supportsInstructionBreakpoints: true,
            // supportsExceptionFilterOptions: true,

            // Cpp Debug doesn't support following two features yet
            // supportsHitConditionalBreakpoints: true,
            // supportsStepBack: true,
        };

        this.sendResponse(response);
    }

    protected override launchRequest(response: DebugProtocol.LaunchResponse, args: CppDbgLaunchRequestArguments): void {
        logger.loggingConfigure(args.logging);
        this.miMode = args.MIMode ?? 'gdb';
        let miDebuggerPath = args.miDebuggerPath;
        if (!miDebuggerPath) {
            miDebuggerPath = this.miMode === 'gdb' ? 'gdb' : 'lldb-mi';
        }
        if (!this.checkCommand(miDebuggerPath)) {
            this.sendErrorResponse(response, 104, `Configured debugger ${miDebuggerPath} not found.`);
            return;
        }

        let env: { [key: string]: string } = {};
        if (args.environment) {
            for (const item of args.environment) {
                if (item && item.name) {
                    env[item.name] = item.value;
                }
            }
        }

        // FIXME: split
        const debuggerArgs: string[] = args.miDebuggerArgs ? args.miDebuggerArgs.split(' ') : [];
        if (this.miMode === 'gdb') {
            this.miDebugger = new MI2(miDebuggerPath, ["--interpreter=mi2"], debuggerArgs, env);
        } else {
            this.miDebugger = new MI2_LLDB(miDebuggerPath, [], debuggerArgs, env);
        }


        if (args.sourceFileMap) {
            this.setSourceFileMapInfo(args.sourceFileMap);
        }
        this.initDebugger();
        this.quit = false;
        this.attached = false;
        this.initialRunCommand = RunCommand.RUN;
        this.isSSH = false;
        this.started = false;
        this.crashed = false;
        this.setValuesFormattingMode('prettyPrinters');
        this.miDebugger.frameFilters = true;
        this.stopAtEntry = args.stopAtEntry ?? false;
        this.miDebugger.registerLimit = "";

        const progArgs = (args.args ?? []).join(' ');
        // TODO: change args.terminal to undefined is miMode === 'lldb'
        this.miDebugger.load(args.cwd ?? '', args.program, progArgs, undefined, []).then(() => {
            this.sendResponse(response);
        }, err => {
            this.sendErrorResponse(response, 103, `Failed to load MI Debugger: ${err.toString()}`);
        });

    }

    protected override attachRequest(response: DebugProtocol.AttachResponse, args: CppDbgAttachRequestArguments): void {
        logger.loggingConfigure(args.logging);
        const miMode = args.MIMode ?? 'gdb';
        let miDebuggerPath = args.miDebuggerPath;
        if (!miDebuggerPath) {
            miDebuggerPath = miMode === 'gdb' ? 'gdb' : 'lldb-mi';
        }

        // FIXME: split
        const debuggerArgs: string[] = args.miDebuggerArgs ? args.miDebuggerArgs.split(' ') : [];

        // for attach, cpp debug doesn't support pass environment
        if (miMode === 'gdb') {
            this.miDebugger = new MI2(miDebuggerPath, ["--interpreter=mi2"], debuggerArgs, {});
        } else {
            this.miDebugger = new MI2_LLDB(miDebuggerPath, [], debuggerArgs, {});
        }

        if (args.sourceFileMap) {
            this.setSourceFileMapInfo(args.sourceFileMap);
        }
        this.initDebugger();
        this.quit = false;
        this.attached = true;
        this.initialRunCommand = RunCommand.NONE;
        this.isSSH = false;
        this.setValuesFormattingMode('prettyPrinters');
        this.miDebugger.frameFilters = true;
        // FIXME: 针对 attach 类型，不应该有 stopAtEntry 设置项
        this.stopAtEntry = false;
        this.miDebugger.registerLimit = "";
        this.miDebugger.attach('', args.program, args.program, []).then(() => {
            this.sendResponse(response);
        }, err => {
            this.sendErrorResponse(response, 101, `Failed to attach: ${err.toString()}`);
        });
    }

    protected override disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
        if (this.attached) {
            this.miDebugger.detach();
        } else {
            this.miDebugger.stop();
        }
        this.commandServer?.close();
        this.commandServer = undefined;
        this.sendResponse(response);
    }

    protected override async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): Promise<void> {
        try {
            let name = args.name;
            const parent = this.variableHandles.get(args.variablesReference);
            if (parent instanceof VariableScope) {
                name = VariableScope.variableName(args.variablesReference, name);
            } else if (parent instanceof VariableObject) {
                name = `${parent.name}.${name}`;
            }

            const res = await this.miDebugger.varAssign(name, args.value);
            response.body = {
                value: res.result("value")
            };

            this.sendResponse(response);
        } catch (err) {
            this.sendErrorResponse(response, 11, `Could not continue: ${err}`);
        }
    }

    protected override setFunctionBreakPointsRequest(response: DebugProtocol.SetFunctionBreakpointsResponse, args: DebugProtocol.SetFunctionBreakpointsArguments): void {
        const all: Thenable<[boolean, Breakpoint | undefined]>[] = [];
        args.breakpoints.forEach(brk => {
            all.push(this.miDebugger.addBreakPoint({ raw: brk.name, condition: brk.condition, countCondition: brk.hitCondition }));
        });
        Promise.all(all).then(brkpoints => {
            const finalBrks: DebugProtocol.Breakpoint[] = [];
            brkpoints.forEach(brkp => {
                if (brkp[0]) {
                    finalBrks.push({ line: brkp[1]!.line, verified: true });
                }
            });
            response.body = {
                breakpoints: finalBrks
            };
            this.sendResponse(response);
        }, msg => {
            this.sendErrorResponse(response, 10, msg.toString());
        });
    }

    protected override setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
        let path = args.source.path;
        if (this.isSSH) {
            // convert local path to ssh path
            path = this.sourceFileMap.toRemotePath(path!);
        }
        this.miDebugger.clearBreakPoints(path).then(() => {
            const all = args.breakpoints?.map(brk => {
                return this.miDebugger.addBreakPoint({ file: path, line: brk.line, condition: brk.condition, countCondition: brk.hitCondition, logMessage: brk.logMessage });
            }) ?? [];
            Promise.all(all).then(brkpoints => {
                const finalBrks: DebugProtocol.Breakpoint[] = [];
                brkpoints.forEach(brkp => {
                    // TODO: Currently all breakpoints returned are marked as verified,
                    // which leads to verified breakpoints on a broken lldb.
                    if (brkp[0]) {
                        finalBrks.push(new DebugAdapter.Breakpoint(true, brkp[1]!.line));
                    }
                });
                response.body = {
                    breakpoints: finalBrks
                };
                this.sendResponse(response);
            }, msg => {
                this.sendErrorResponse(response, 9, msg.toString());
            });
        }, msg => {
            this.sendErrorResponse(response, 9, msg.toString());
        });
    }

    protected override threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        if (!this.miDebugger) {
            this.sendResponse(response);
            return;
        }
        this.miDebugger.getThreads().then(threads => {
            response.body = {
                threads: []
            };
            for (const thread of threads) {
                const threadName = thread.name || thread.targetId || "<unnamed>";
                response.body.threads.push(new Thread(thread.id, thread.id + ":" + threadName));
            }
            this.sendResponse(response);
        }).catch((error: MIError) => {
            if (error.message === 'Selected thread is running.') {
                this.sendResponse(response);
                return;
            }
            this.sendErrorResponse(response, 17, `Could not get threads: ${error}`);
        });
    }

    protected override stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
        this.miDebugger.getStack(args.startFrame ?? 0, args.levels ?? 0, args.threadId).then(stack => {
            const ret: StackFrame[] = [];
            stack.forEach(element => {
                let source = undefined;
                let path = element.file;
                if (path) {
                    if (this.isSSH) {
                        // convert ssh path to local path
                        path = this.sourceFileMap.toLocalPath(path);
                    } else if (process.platform === "win32") {
                        if (path.startsWith("\\cygdrive\\") || path.startsWith("/cygdrive/")) {
                            path = path[10] + ":" + path.substring(11); // replaces /cygdrive/c/foo/bar.txt with c:/foo/bar.txt
                        }
                    }
                    source = new Source(element.fileName, path);
                }

                ret.push(new StackFrame(
                    this.threadAndLevelToFrameId(args.threadId, element.level),
                    element.function + (element.address ? "@" + element.address : ""),
                    source,
                    element.line,
                    0));
            });
            response.body = {
                stackFrames: ret
            };
            this.sendResponse(response);
        }, err => {
            this.sendErrorResponse(response, 12, `Failed to get Stack Trace: ${err.toString()}`);
        });
    }

    protected override configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        const promises: Thenable<any>[] = [];
        let entryPoint: string | undefined = undefined;
        let runToStart: boolean = false;
        // Setup temporary breakpoint for the entry point if needed.
        switch (this.initialRunCommand) {
            case RunCommand.CONTINUE:
            case RunCommand.NONE:
                if (typeof this.stopAtEntry === 'boolean' && this.stopAtEntry) {
                    entryPoint = "main";

                } // sensible default
                else if (typeof this.stopAtEntry === 'string') {
                    entryPoint = this.stopAtEntry;
                }
                break;
            case RunCommand.RUN:
                if (typeof this.stopAtEntry === 'boolean' && this.stopAtEntry) {
                    if (this.miDebugger.features.includes("exec-run-start-option")) {
                        runToStart = true;
                    } else {
                        entryPoint = "main";
                    } // sensible fallback
                } else if (typeof this.stopAtEntry === 'string') {
                    entryPoint = this.stopAtEntry;
                }
                break;
            default:
                throw new Error('Unhandled run command: ' + RunCommand[this.initialRunCommand]);
        }
        if (entryPoint) {
            promises.push(this.miDebugger.setEntryBreakPoint(entryPoint));
        }
        switch (this.initialRunCommand) {
            case RunCommand.CONTINUE:
                promises.push(this.miDebugger.continue().then(() => {
                    // Some debuggers will provide an out-of-band status that they are stopped
                    // when attaching (e.g., gdb), so the client assumes we are stopped and gets
                    // confused if we start running again on our own.
                    //
                    // If we don't send this event, the client may start requesting data (such as
                    // stack frames, local variables, etc.) since they believe the target is
                    // stopped.  Furthermore, the client may not be indicating the proper status
                    // to the user (may indicate stopped when the target is actually running).
                    this.sendEvent(new ContinuedEvent(1, true));
                }));
                break;
            case RunCommand.RUN:
                promises.push(this.miDebugger.start(runToStart).then(() => {
                    this.started = true;
                    if (this.crashed) {
                        // FIXME:
                        this.handlePause(undefined!);
                    }
                }));
                break;
            case RunCommand.NONE: {
                // Not all debuggers seem to provide an out-of-band status that they are stopped
                // when attaching (e.g., lldb), so the client assumes we are running and gets
                // confused when we don't actually run or continue.  Therefore, we'll force a
                // stopped event to be sent to the client (just in case) to synchronize the state.
                const event: DebugProtocol.StoppedEvent = new StoppedEvent("pause", 1);
                event.body.description = "paused on attach";
                event.body.allThreadsStopped = true;
                this.sendEvent(event);
                break;
            }
            default:
                throw new Error('Unhandled run command: ' + RunCommand[this.initialRunCommand]);
        }
        Promise.all(promises).then(() => {
            this.sendResponse(response);
        }).catch(err => {
            this.sendErrorResponse(response, 18, `Could not run/continue: ${err.toString()}`);
        });
    }

    protected override scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
        const scopes = new Array<Scope>();
        const [threadId, level] = this.frameIdToThreadAndLevel(args.frameId);

        const createScope = (scopeName: string, expensive: boolean): Scope => {
            const key: string = scopeName + ":" + threadId + ":" + level;
            let handle: number;

            if (this.scopeHandlesReverse.hasOwnProperty(key)) {
                handle = this.scopeHandlesReverse[key];
            } else {
                handle = this.variableHandles.create(new VariableScope(scopeName, threadId, level));
                this.scopeHandlesReverse[key] = handle;
            }

            return new Scope(scopeName, handle, expensive);
        };

        scopes.push(createScope("Locals", false));
        scopes.push(createScope("Registers", false));

        response.body = {
            scopes: scopes
        };
        this.sendResponse(response);
    }

    protected override async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
        const variables: DebugProtocol.Variable[] = [];
        const id: VariableScope | VariableObject = this.variableHandles.get(args.variablesReference);

        const findOrCreateVariable = (varObj: VariableObject): number => {
            let id: number;
            if (this.variableHandlesReverse.hasOwnProperty(varObj.name)) {
                id = this.variableHandlesReverse[varObj.name];
            } else {
                id = this.variableHandles.create(varObj);
                this.variableHandlesReverse[varObj.name] = id;
            }
            return varObj.isCompound() ? id : 0;
        };

        if (id instanceof VariableScope) {
            try {
                if (id.name === "Registers") {
                    const registers = await this.miDebugger.getRegisters();
                    for (const reg of registers) {
                        variables.push({
                            name: reg.name,
                            value: reg.valueStr,
                            variablesReference: 0
                        });
                    }
                } else {
                    const stack: Variable[] = await this.miDebugger.getStackVariables(id.threadId, id.level);
                    for (const variable of stack) {
                        try {
                            const varObjName = VariableScope.variableName(args.variablesReference, variable.name);
                            let varObj: VariableObject;
                            try {
                                const changes = await this.miDebugger.varUpdate(varObjName);
                                const changelist = changes.result("changelist");
                                changelist.forEach((change: any) => {
                                    const name = MINode.valueOf(change, "name");
                                    const vId = this.variableHandlesReverse[name];
                                    const v = this.variableHandles.get(vId) as any;
                                    v.applyChanges(change);
                                });
                                const varId = this.variableHandlesReverse[varObjName];
                                varObj = this.variableHandles.get(varId) as any;
                            } catch (err) {
                                if (err instanceof MIError && (err.message === "Variable object not found" || err.message.endsWith("does not exist"))) {
                                    varObj = await this.miDebugger.varCreate(id.threadId, id.level, variable.name, varObjName);
                                    const varId = findOrCreateVariable(varObj);
                                    varObj.exp = variable.name;
                                    varObj.id = varId;
                                } else {
                                    throw err;
                                }
                            }
                            variables.push(varObj.toProtocolVariable());
                        } catch (err) {
                            variables.push({
                                name: variable.name,
                                value: `<${err}>`,
                                variablesReference: 0
                            });
                        }
                    }
                }
                response.body = {
                    variables: variables
                };
                this.sendResponse(response);
            } catch (err) {
                this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
            }
        } else if (id instanceof VariableObject) {
            // Variable members
            let children: VariableObject[];
            try {
                children = await this.miDebugger.varListChildren(id.name);
                const vars = children.map(child => {
                    const varId = findOrCreateVariable(child);
                    child.id = varId;
                    return child.toProtocolVariable();
                });

                response.body = {
                    variables: vars
                };
                this.sendResponse(response);
            } catch (err) {
                this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
            }
        } else {
            response.body = {
                variables: variables
            };
            this.sendResponse(response);
        }
    }

    protected override pauseRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        this.miDebugger.interrupt().then(done => {
            this.sendResponse(response);
        }, msg => {
            this.sendErrorResponse(response, 3, `Could not pause: ${msg}`);
        });
    }

    protected override reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse, args: DebugProtocol.ReverseContinueArguments): void {
        this.miDebugger.continue(true).then(done => {
            this.sendResponse(response);
        }, msg => {
            this.sendErrorResponse(response, 2, `Could not continue: ${msg}`);
        });
    }

    protected override continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        this.miDebugger.continue().then(done => {
            this.sendResponse(response);
        }, msg => {
            this.sendErrorResponse(response, 2, `Could not continue: ${msg}`);
        });
    }

    protected override stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments): void {
        this.miDebugger.step(true).then(done => {
            this.sendResponse(response);
        }, msg => {
            this.sendErrorResponse(response, 4, `Could not step back: ${msg} - Try running 'target record-full' before stepping back`);
        });
    }

    protected override stepInRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        this.miDebugger.step().then(done => {
            this.sendResponse(response);
        }, msg => {
            this.sendErrorResponse(response, 4, `Could not step in: ${msg}`);
        });
    }

    protected override stepOutRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        this.miDebugger.stepOut().then(done => {
            this.sendResponse(response);
        }, msg => {
            this.sendErrorResponse(response, 5, `Could not step out: ${msg}`);
        });
    }

    protected override nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        this.miDebugger.next().then(done => {
            this.sendResponse(response);
        }, msg => {
            this.sendErrorResponse(response, 6, `Could not step over: ${msg}`);
        });
    }

    protected override evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
        const [threadId, level] = this.frameIdToThreadAndLevel(args.frameId!);
        if (args.context === "watch" || args.context === "hover") {
            this.miDebugger.evalExpression(args.expression, threadId, level).then((res) => {
                response.body = {
                    variablesReference: 0,
                    result: res.result("value")
                };
                this.sendResponse(response);
            }, msg => {
                if (args.context === "hover") {
                    // suppress error for hover as the user may just play with the mouse
                    this.sendResponse(response);
                } else {
                    this.sendErrorResponse(response, 7, msg.toString());
                }
            });
        } else {
            this.miDebugger.sendUserInput(args.expression, threadId, level).then(output => {
                if (typeof output === "undefined") {
                    response.body = {
                        result: "",
                        variablesReference: 0
                    };
                } else {
                    response.body = {
                        result: JSON.stringify(output),
                        variablesReference: 0
                    };
                }
                this.sendResponse(response);
            }, msg => {
                this.sendErrorResponse(response, 8, msg.toString());
            });
        }
    }

    protected override gotoTargetsRequest(response: DebugProtocol.GotoTargetsResponse, args: DebugProtocol.GotoTargetsArguments): void {
        const path: string = this.isSSH ? this.sourceFileMap.toRemotePath(args.source.path!) : args.source.path!;
        this.miDebugger.goto(path, args.line).then(done => {
            response.body = {
                targets: [{
                    id: 1,
                    label: args.source.name!,
                    column: args.column,
                    line: args.line
                }]
            };
            this.sendResponse(response);
        }, msg => {
            this.sendErrorResponse(response, 16, `Could not jump: ${msg}`);
        });
    }

    protected override gotoRequest(response: DebugProtocol.GotoResponse, args: DebugProtocol.GotoArguments): void {
        this.sendResponse(response);
    }

    protected override completionsRequest(response: DebugProtocol.CompletionsResponse, args: DebugProtocol.CompletionsArguments, request?: DebugProtocol.Request): void {
        // if debug is not stopped, return error code 1105, and error string: Unable to perform this action because the process is running.
        // if (this.miDebugger.isRunning()) {
        //     this.sendErrorResponse(response, 1105, "Unable to perform this action because the process is running.");
        //     return;
        // }
        if (args.frameId) {
            const [threadId, level] = this.frameIdToThreadAndLevel(args.frameId);
            let command: string;
            let prefix: string;
            if (args.text.startsWith('-exec ')) {
                prefix = '-exec ';
                command = args.text.substring(6);
            } else if (args.text.startsWith('`')) {
                prefix = '`';
                command = args.text.substring(1);
            } else {
                this.sendResponse(response);
                return;
            }

            this.miDebugger.completions(command, threadId, level).then((completions) => {
                const matches: string[] = [];
                for (const comp of completions) {
                    matches.push(prefix + comp);
                }
                response.body = {
                    targets: matches.map(m => ({
                        label: m,
                        type: 'text',
                        start: 0,
                        length: m.length
                    }))
                };
                this.sendResponse(response);
            }, msg => {
                this.sendErrorResponse(response, 1104, `Could not get completions: ${msg}`);
            });
        }
    }

    //#endregion

    //#region logging

    public start(inStream: NodeJS.ReadableStream, outStream: NodeJS.WritableStream): void {
        super.start(inStream, outStream);
        logger.init(e => this.sendEvent(e), this.obsolete_logFilePath, this._isServer);
        logger.setup(LogLevel.Verbose, false, true);
    }

    public sendEvent(event: DebugProtocol.Event): void {
        if (!(event instanceof DebugAdapter.Logger.LogOutputEvent)) {
            // Don't create an infinite loop...

            let objectToLog = event;
            if (event instanceof OutputEvent && event.body && event.body.data && event.body.data.doNotLogOutput) {
                delete event.body.data.doNotLogOutput;
                objectToLog = { ...event };
                objectToLog.body = { ...event.body, output: '<output not logged>' };
            }

            // _logger.verbose(`To client: ${JSON.stringify(objectToLog)}`);
            logger.writeLine(LoggingCategory.StdErr, `To client: ${JSON.stringify(objectToLog)}`);
        }

        super.sendEvent(event);
    }

    public sendRequest(command: string, args: any, timeout: number, cb: (response: DebugProtocol.Response) => void): void {
        logger.writeLine(LoggingCategory.AdapterTrace, `To client: ${JSON.stringify(command)}(${JSON.stringify(args)}), timeout: ${timeout}`);
        super.sendRequest(command, args, timeout, cb);
    }

    public sendResponse(response: DebugProtocol.Response): void {
        logger.writeLine(LoggingCategory.AdapterResponse, `To client: ${JSON.stringify(response)}`);
        super.sendResponse(response);
    }

    protected dispatchRequest(request: DebugProtocol.Request): void {
        logger.writeLine(LoggingCategory.AdapterTrace, `From client: ${request.command}(${JSON.stringify(request.arguments)})`);
        super.dispatchRequest(request);
    }

    protected readMemoryRequest(response: DebugProtocol.ReadMemoryResponse, args: DebugProtocol.ReadMemoryArguments, request?: DebugProtocol.Request): void {
        if (args.memoryReference.length === 0) {
            this.sendErrorResponse(response, 19, "Memory reference is empty");
            return;
        }

        if (args.count === 0) {
            response.body = response.body || { address: '' };
            response.body.address = args.memoryReference;
            // response.body.data = Buffer.from(bytes.subarray(0, bytesRead)).toString('base64');
            response.body.unreadableBytes = 0;
            this.sendResponse(response);
            return;
        }

        // memoryReference can be like: 
        // '0x7fffffffe250' or
        // '0x7fffffffe250 "/home/quan/workspace/cpp/qt/QtWidgetApplication/build/Debug/QtWidgetApplication"'
        // Extract only the address part before converting to BigInt
        const memRefParts = args.memoryReference.trim().split(' ');
        let address: bigint;
        try {
            address = BigInt(memRefParts[0]);
        } catch (e) {
            this.sendErrorResponse(response, 19, `Invalid memory reference: ${args.memoryReference}`);
            logger.writeLine(LoggingCategory.EngineLogging, `Invalid memory reference: ${args.memoryReference}`);
            return;
        }

        if (args.offset) {
            address += BigInt(args.offset);
        }

        this.miDebugger.readProcessMemory(address, args.count).then((data: MIReadMemoryResult) => {
            // ensure the buffer contains the desired bytes.
            if (data.begin + data.offset !== address) {
                this.sendErrorResponse(response, 20, `Memory read error: expected address ${address}, got ${data.begin + data.offset}`);
                return;
            }

            let bytesRead = data.contents.length / 2;
            if (bytesRead > args.count) {
                bytesRead = args.count;
            }

            const bytes = new Uint8Array(args.count);
            for (let i = 0; i < bytesRead; i++) {
                bytes[i] = parseInt(data.contents.substring(i * 2, (i + 1) * 2), 16);
            }

            // vscode requested to read a block of memory (args.count bytes), but actually read fewer 
            // bytes than requested, for example due to hitting an invalid memory page or crossing a page boundary.
            // Need to inform the frontend how many bytes at the end are unreadable (unreadableBytes)
            let unreadableBytes = 0n;
            if (bytesRead < args.count) {
                // Assume the memory page size is 4096 bytes (actual ARM may have 64K pages, but we use 4K here)
                const pageSize = 4096n;
                // Calculate the end address of this read: readEnd = addr.Address + bytesRead
                const readEnd = address + BigInt(bytesRead);
                let nextPageStart = (readEnd + pageSize - 1n) / pageSize * pageSize;
                if (nextPageStart === readEnd) {
                    nextPageStart = readEnd + pageSize;
                }

                // if we have crossed a page boundry - Unreadable = bytes till end of page
                const maxUnreadable = BigInt(args.count - bytesRead);
                const minBigInt = (...args: bigint[]): bigint => {
                    return args.reduce((a, b) => a < b ? a : b);
                };
                if (address + BigInt(args.count) > nextPageStart) {
                    unreadableBytes = minBigInt(maxUnreadable, nextPageStart - readEnd);
                } else {
                    unreadableBytes = minBigInt(maxUnreadable, pageSize);
                }
            }

            response.body = response.body || { address: '' };
            response.body.address = address.toString();
            response.body.data = Buffer.from(bytes.subarray(0, bytesRead)).toString('base64');
            response.body.unreadableBytes = Number(unreadableBytes);

            this.sendResponse(response);

        }).catch((err: string) => {
            if (err === 'Unable to read memory.') {
                response.body = response.body || { address: '' };
                response.body.address = address.toString();
                response.body.data = '';
                response.body.unreadableBytes = 0;
                this.sendResponse(response);
                return;
            } else {
                this.sendErrorResponse(response, 21, `Could not read memory, readMemoryArguments: ${JSON.stringify(args)}`);
            }

        });
    }

    //#endregion

    private setSourceFileMap(configMap: { [index: string]: string }, fallbackGDB: string, fallbackIDE: string): void {
        if (configMap === undefined) {
            this.sourceFileMap = new SourceFileMap({ [fallbackGDB]: fallbackIDE });
        } else {
            this.sourceFileMap = new SourceFileMap(configMap, fallbackGDB);
        }
    }

    private prettyStringArray(strings: any) {
        if (typeof strings === "object") {
            if (strings.length !== undefined) {
                return strings.join(", ");
            } else {
                return JSON.stringify(strings);
            }
        } else {
            return strings;
        }
    }

    private setSourceFileMapInfo(sourceFileMap: SourceFileMapInfo) {
        const isGDB = this.miMode === 'gdb';
        Object.entries(sourceFileMap).forEach(([source, value]) => {
            const mappedPath = typeof value === 'string' ? value : value.editorPath;
            if (isGDB) {
                this.miDebugger.extraCommands.push(
                    `gdb-set substitute-path "${escape(source)}" "${escape(mappedPath)}"`
                );
            } else {
                this.miDebugger.extraCommands.push(
                    `settings append target.source-map ${source} ${mappedPath}`
                );
            }
        });

    }

    // Supports 65535 threads.
    private threadAndLevelToFrameId(threadId: number, level: number) {
        return level << 16 | threadId;
    }
    private frameIdToThreadAndLevel(frameId: number) {
        return [frameId & 0xffff, frameId >> 16];
    }
}

DebugSession.run(CppDebugSession);
