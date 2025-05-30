import { logger as _logger } from "@vscode/debugadapter";
import { ILogCallback, LogLevel } from "@vscode/debugadapter/lib/logger";
import { LoggingSetup } from "./types";

export enum LoggingCategory {
    StdOut,
    StdErr,
    DebuggerStatus,
    DebuggerError,
    EngineLogging,
    AdapterTrace,
    AdapterResponse,
    Telemetry,
    Exception,
    Module,
    ProcessExit,
    NatvisDiagnostics
}

export class DebugEventLogger {
    private _isLoggingEnabled: Map<LoggingCategory, boolean>;
    private static _initTime = Date.now();

    constructor(loggingCategories: LoggingCategory[]) {
        this._isLoggingEnabled = new Map<LoggingCategory, boolean>([
            [LoggingCategory.StdOut, true],
            [LoggingCategory.StdErr, true],
            [LoggingCategory.DebuggerStatus, true],
            [LoggingCategory.DebuggerError, true],
            [LoggingCategory.Telemetry, true],
            [LoggingCategory.Exception, true],
            [LoggingCategory.Module, true],
            [LoggingCategory.ProcessExit, true],
            [LoggingCategory.EngineLogging, false],
            [LoggingCategory.AdapterTrace, false],
            [LoggingCategory.AdapterResponse, false],
        ]);

        for (const category of loggingCategories) {
            this._isLoggingEnabled.set(category, true);
        }
    }

    private setLoggingConfiguration(category: LoggingCategory, isEnabled: boolean): void {
        this._isLoggingEnabled.set(category, isEnabled);
    }

    public writeLine(category: LoggingCategory, message: string, data?: { [key: string]: any }): void {
        const eclipased = Date.now() - DebugEventLogger._initTime;
        const content = `${eclipased}: ${message} `;
        this.write(category, content, data);
    }

    public setup(consoleMinLogLevel: LogLevel, _logFilePath?: string | boolean, prependTimeStamp?: boolean) {
        _logger.setup(consoleMinLogLevel, _logFilePath, prependTimeStamp);
    }

    public write(category: LoggingCategory, message: string, data?: { [key: string]: any }): void {
        if (this._isLoggingEnabled.has(category) && !this._isLoggingEnabled.get(category)) {
            return;
        }

        if (category === LoggingCategory.EngineLogging) {
            _logger.warn(message);
        } else if (category === LoggingCategory.AdapterTrace || category === LoggingCategory.AdapterResponse) {
            _logger.verbose(message);
        } else {
            _logger.verbose(message);
        }
    }

    init(logCallback: ILogCallback, logFilePath?: string, logToConsole?: boolean): void {
        _logger.init(logCallback, logFilePath, logToConsole);
    }

    public loggingConfigure(logging?: LoggingSetup) {
        if (!logging) {
            logging = {
                trace: true,
                traceResponse: true,
                engineLogging: true,
            };
        }
        if (logging.engineLogging) {
            this.setLoggingConfiguration(LoggingCategory.EngineLogging, true);
        }
        if (logging.exceptions) {
            this.setLoggingConfiguration(LoggingCategory.Exception, true);
        }
        if (logging.moduleLoad) {
            this.setLoggingConfiguration(LoggingCategory.Module, true);
        }
        if (logging.natvisDiagnostics) {
            this.setLoggingConfiguration(LoggingCategory.NatvisDiagnostics, true);
        }
        if (logging.programOutput) {
            this.setLoggingConfiguration(LoggingCategory.StdOut, true);
        }
        if (logging.trace) {
            this.setLoggingConfiguration(LoggingCategory.AdapterTrace, true);
        }
        if (logging.traceResponse) {
            this.setLoggingConfiguration(LoggingCategory.AdapterResponse, true);
        }
    }
}

const logger = new DebugEventLogger([]);
// logger.setup(LogLevel.Verbose, false, true);
export { logger };
