import { DebugProtocol } from "@vscode/debugprotocol";
import { MINode } from "./miParse";

export type ValuesFormattingMode = "disabled" | "parseText" | "prettyPrinters";

export interface Breakpoint {
    id?: number;
    file?: string;
    line?: number;
    raw?: string;
    condition?: string;
    countCondition?: string;
    logMessage?: string;
}

export class ThreadInfo implements DebugProtocol.Thread {
    id: number;
    targetId: string;
    name: string;

    constructor(thread: any) {
        this.id = parseInt(MINode.valueOf(thread, "id"));
        this.targetId = MINode.valueOf(thread, 'target-id');
        this.name = MINode.valueOf(thread, 'name') || undefined;
        const tid = this.getTidFromTargetId(this.targetId);
        if (this.name && tid !== 0) {
            this.name = `${this.name} [${tid}]`;
        }
    }

    private getTidFromTargetId(targetId: string): number {
        let tid = 0;

        // 1. <number>
        tid = parseInt(targetId, 10);
        if (!isNaN(tid) && tid !== 0) {
            return tid;
        }

        // 2. "Thread <number>"
        if (targetId.toLowerCase().startsWith("thread ")) {
            const rest = targetId.substring("Thread ".length);
            tid = parseInt(rest, 10);
            if (!isNaN(tid) && tid !== 0) {
                return tid;
            }
        }

        // 3. "Process <number>"
        if (targetId.toLowerCase().startsWith("process ")) {
            const rest = targetId.substring("Process ".length);
            tid = parseInt(rest, 10);
            if (!isNaN(tid) && tid !== 0) {
                return tid;
            }
        }

        // 4. "Thread <...> (LWP <number>)"
        if (targetId.toLowerCase().startsWith("thread ")) {
            const lwpPos = targetId.indexOf("(LWP ");
            const parenPos = targetId.lastIndexOf(')');
            if (lwpPos !== -1 && parenPos !== -1) {
                const lwpStart = lwpPos + 5;
                const len = parenPos - lwpStart;
                if (len > 0) {
                    const lwpStr = targetId.substr(lwpStart, len);
                    tid = parseInt(lwpStr, 10);
                    if (!isNaN(tid) && tid !== 0) {
                        return tid;
                    }
                }
            }
        }

        // 5. "LWP <number>"
        if (targetId.toLowerCase().startsWith("lwp ")) {
            const rest = targetId.substring("LWP ".length);
            tid = parseInt(rest, 10);
            if (!isNaN(tid) && tid !== 0) {
                return tid;
            }
        }
        return tid;
    }
}

export interface Stack {
    level: number;
    address: string;
    function: string;
    fileName: string;
    file: string;
    line: number;
}

export interface Variable {
    name: string;
    valueStr: string;
    type: string;
    raw?: any;
}

export interface RegisterValue {
    index: number;
    value: string;
}

export interface SSHArguments {
    forwardX11: boolean;
    host: string;
    keyfile: string;
    password: string;
    useAgent: boolean;
    cwd: string;
    port: number;
    user: string;
    remotex11screen: number;
    x11port: number;
    x11host: string;
    bootstrap: string;
    sourceFileMap: { [index: string]: string };
}

export interface IBackend {
    load(cwd: string, target: string, procArgs: string, separateConsole: string, autorun: string[]): Thenable<any>;
    ssh(args: SSHArguments, cwd: string, target: string, procArgs: string, separateConsole: string, attach: boolean, autorun: string[]): Thenable<any>;
    attach(cwd: string, executable: string, target: string, autorun: string[]): Thenable<any>;
    connect(cwd: string, executable: string, target: string, autorun: string[]): Thenable<any>;
    start(runToStart: boolean): Thenable<void>;
    stop(): void;
    detach(): void;
    interrupt(): Thenable<boolean>;
    continue(): Thenable<boolean>;
    next(): Thenable<boolean>;
    step(): Thenable<boolean>;
    stepOut(): Thenable<boolean>;
    loadBreakPoints(breakpoints: Breakpoint[]): Thenable<[boolean, Breakpoint | undefined][]>;
    addBreakPoint(breakpoint: Breakpoint): Thenable<[boolean, Breakpoint | undefined]>;
    removeBreakPoint(breakpoint: Breakpoint): Thenable<boolean>;
    clearBreakPoints(source?: string): Thenable<any>;
    getThreads(): Thenable<ThreadInfo[]>;
    getStack(startFrame: number, maxLevels: number, thread: number): Thenable<Stack[]>;
    getStackVariables(thread: number, frame: number): Thenable<Variable[]>;
    evalExpression(name: string, thread: number, frame: number): Thenable<any>;
    isReady(): boolean;
    changeVariable(name: string, rawValue: string): Thenable<any>;
    examineMemory(from: number, to: number): Thenable<any>;
}

export class VariableObject {
    name: string;
    exp: string;
    numchild: number;
    type: string;
    value: string;
    threadId: string;
    frozen: boolean;
    dynamic: boolean;
    displayhint: string;
    hasMore: boolean;
    id!: number;
    constructor(node: any) {
        this.name = MINode.valueOf(node, "name");
        this.exp = MINode.valueOf(node, "exp");
        this.numchild = parseInt(MINode.valueOf(node, "numchild"));
        this.type = MINode.valueOf(node, "type");
        this.value = MINode.valueOf(node, "value");
        this.threadId = MINode.valueOf(node, "thread-id");
        this.frozen = !!MINode.valueOf(node, "frozen");
        this.dynamic = !!MINode.valueOf(node, "dynamic");
        this.displayhint = MINode.valueOf(node, "displayhint");
        // TODO: use has_more when it's > 0
        this.hasMore = !!MINode.valueOf(node, "has_more");
    }

    public applyChanges(node: MINode) {
        this.value = MINode.valueOf(node, "value");
        if (MINode.valueOf(node, "type_changed")) {
            this.type = MINode.valueOf(node, "new_type");
        }
        this.dynamic = !!MINode.valueOf(node, "dynamic");
        this.displayhint = MINode.valueOf(node, "displayhint");
        this.hasMore = !!MINode.valueOf(node, "has_more");
    }

    public isCompound(): boolean {
        return this.numchild > 0 ||
            this.value === "{...}" ||
            (this.dynamic && (this.displayhint === "array" || this.displayhint === "map"));
    }

    public toProtocolVariable(): DebugProtocol.Variable {
        const res: DebugProtocol.Variable = {
            name: this.exp,
            evaluateName: this.name,
            value: (this.value === void 0) ? "<unknown>" : this.value,
            type: this.type,
            variablesReference: this.id
        };
        return res;
    }
}

// from https://gist.github.com/justmoon/15511f92e5216fa2624b#gistcomment-1928632
export interface MIError extends Error {
    readonly name: string;
    readonly message: string;
    readonly source: string;
}
export interface MIErrorConstructor {
    new(message: string, source: string): MIError;
    readonly prototype: MIError;
}

export const MIError: MIErrorConstructor = class MIError {
    private readonly _message: string;
    private readonly _source: string;
    public constructor(message: string, source: string) {
        this._message = message;
        this._source = source;
        Error.captureStackTrace(this, this.constructor);
    }

    get name() { return this.constructor.name; }
    get message() { return this._message; }
    get source() { return this._source; }

    public toString() {
        return `${this.message} (from ${this._source})`;
    }
};
Object.setPrototypeOf(MIError as any, Object.create(Error.prototype));
MIError.prototype.constructor = MIError;
