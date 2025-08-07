import * as fs from 'fs';
import * as cp from 'child_process';
import * as vscode from 'vscode';
import localize from './localize';
import { ManualPromise } from './manualPromise';
import * as path from 'path';

export enum ArchType {
    ia32,
    x64
}

export const isWindows = process.platform === 'win32';

export class ArchitectureReplacer {
    public static checkAndReplaceWSLPipeProgram(pipeProgramStr: string, expectedArch: ArchType): string | undefined {
        let replacedPipeProgram: string | undefined;
        const winDir: string | undefined = process.env.WINDIR ? process.env.WINDIR.toLowerCase() : undefined;
        const winDirAltDirSep: string | undefined = process.env.WINDIR ? process.env.WINDIR.replace(/\\/g, '/').toLowerCase() : undefined;
        const winDirEnv: string = "${env:windir}";

        if (winDir && winDirAltDirSep && (pipeProgramStr.indexOf(winDir) === 0 || pipeProgramStr.indexOf(winDirAltDirSep) === 0 || pipeProgramStr.indexOf(winDirEnv) === 0)) {
            if (expectedArch === ArchType.x64) {
                const pathSep: string = ArchitectureReplacer.checkForFolderInPath(pipeProgramStr, "sysnative");
                if (pathSep) {
                    // User has sysnative but we expect 64 bit. Should be using System32 since sysnative is a 32bit concept.
                    replacedPipeProgram = pipeProgramStr.replace(`${pathSep}sysnative${pathSep}`, `${pathSep}system32${pathSep}`);
                }
            } else if (expectedArch === ArchType.ia32) {
                const pathSep: string = ArchitectureReplacer.checkForFolderInPath(pipeProgramStr, "system32");
                if (pathSep) {
                    // User has System32 but we expect 32 bit. Should be using sysnative
                    replacedPipeProgram = pipeProgramStr.replace(`${pathSep}system32${pathSep}`, `${pathSep}sysnative${pathSep}`);
                }
            }
        }

        return replacedPipeProgram;
    }

    // Checks to see if the folder name is in the path using both win and unix style path separators.
    // Returns the path separator it detected if the folder is in the path.
    // Or else it returns empty string to indicate it did not find it in the path.
    public static checkForFolderInPath(path: string, folder: string): string {
        if (path.indexOf(`/${folder}/`) >= 0) {
            return '/';
        } else if (path.indexOf(`\\${folder}\\`) >= 0) {
            return '\\';
        }

        return "";
    }
}

export async function fsStat(filePath: fs.PathLike): Promise<fs.Stats | undefined> {
    let stats: fs.Stats | undefined;
    try {
        stats = await fs.promises.stat(filePath);
    } catch (e) {
        // File doesn't exist
        return undefined;
    }
    return stats;
}

export async function checkFileExists(filePath: string): Promise<boolean> {
    const stats: fs.Stats | undefined = await fsStat(filePath);
    return !!stats && stats.isFile();
}

export function execChildProcess(process: string, workingDirectory?: string, channel?: vscode.OutputChannel): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        cp.exec(process, { cwd: workingDirectory, maxBuffer: 500 * 1024 }, (error: Error | null, stdout: string, stderr: string) => {
            if (channel) {
                let message: string = "";
                let err: boolean = false;
                if (stdout && stdout.length > 0) {
                    message += stdout;
                }

                if (stderr && stderr.length > 0) {
                    message += stderr;
                    err = true;
                }

                if (error) {
                    message += error.message;
                    err = true;
                }

                if (err) {
                    channel.append(message);
                    channel.show();
                }
            }

            if (error) {
                reject(error);
                return;
            }

            if (stderr && stderr.length > 0) {
                reject(new Error(stderr));
                return;
            }

            resolve(stdout);
        });
    });
}

export interface ProcessReturnType {
    succeeded: boolean;
    exitCode?: number | NodeJS.Signals;
    output: string;
    outputError: string;
}

export async function spawnChildProcess(program: string, args: string[] = [], continueOn?: string, skipLogging?: boolean, cancellationToken?: vscode.CancellationToken): Promise<ProcessReturnType> {
    // Do not use CppSettings to avoid circular require()
    if (skipLogging === undefined || !skipLogging) {
        // FIXME: 
        const settings: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp", null);
        // FIXME: 暂时只是掉
        // if (getNumericLoggingLevel(settings.get<string>("loggingLevel")) >= 5) {
        //     getOutputChannelLogger().appendLine(`$ ${program} ${args.join(' ')}`);
        // }
    }
    const programOutput: ProcessOutput = await spawnChildProcessImpl(program, args, continueOn, skipLogging, cancellationToken);
    const exitCode: number | NodeJS.Signals | undefined = programOutput.exitCode;
    if (programOutput.exitCode) {
        return { succeeded: false, exitCode, outputError: programOutput.stderr, output: programOutput.stderr || programOutput.stdout || localize('process.exited', 'Process exited with code {0}', `${exitCode}`) };
    } else {
        let stdout: string;
        if (programOutput.stdout.length) {
            // Type system doesn't work very well here, so we need call toString
            stdout = programOutput.stdout;
        } else {
            stdout = localize('process.succeeded', 'Process executed successfully.');
        }
        return { succeeded: true, exitCode, outputError: programOutput.stderr, output: stdout };
    }
}

interface ProcessOutput {
    exitCode?: number | NodeJS.Signals;
    stdout: string;
    stderr: string;
}

async function spawnChildProcessImpl(program: string, args: string[], continueOn?: string, skipLogging?: boolean, cancellationToken?: vscode.CancellationToken): Promise<ProcessOutput> {
    const result = new ManualPromise<ProcessOutput>();

    // Do not use CppSettings to avoid circular require()
    const settings: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("C_Cpp", null);
    // const loggingLevel: number = (skipLogging === undefined || !skipLogging) ? getNumericLoggingLevel(settings.get<string>("loggingLevel")) : 0;
    const loggingLevel: number = 0;

    let proc: cp.ChildProcess;
    if (await isExecutable(program)) {
        proc = cp.spawn(`.${isWindows ? '\\' : '/'}${path.basename(program)}`, args, { shell: true, cwd: path.dirname(program) });
    } else {
        proc = cp.spawn(program, args, { shell: true });
    }

    const cancellationTokenListener: vscode.Disposable | undefined = cancellationToken?.onCancellationRequested(() => {
        // getOutputChannelLogger().appendLine(localize('killing.process', 'Killing process {0}', program));
        proc.kill();
    });

    const clean = () => {
        proc.removeAllListeners();
        if (cancellationTokenListener) {
            cancellationTokenListener.dispose();
        }
    };

    let stdout: string = '';
    let stderr: string = '';
    if (proc.stdout) {
        proc.stdout.on('data', data => {
            const str: string = data.toString();
            if (loggingLevel > 0) {
                // getOutputChannelLogger().append(str);
            }
            stdout += str;
            if (continueOn) {
                const continueOnReg: string = escapeStringForRegex(continueOn);
                if (stdout.search(continueOnReg)) {
                    result.resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
                }
            }
        });
    }
    if (proc.stderr) {
        proc.stderr.on('data', data => stderr += data.toString());
    }
    proc.on('close', (code, signal) => {
        clean();
        result.resolve({ exitCode: code || signal || undefined, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    proc.on('error', error => {
        clean();
        result.reject(error);
    });
    return result;
}

/**
 * @param permission fs file access constants: https://nodejs.org/api/fs.html#file-access-constants
 */
export function pathAccessible(filePath: string, permission: number = fs.constants.F_OK): Promise<boolean> {
    if (!filePath) { return Promise.resolve(false); }
    return new Promise(resolve => fs.access(filePath, permission, err => resolve(!err)));
}

export function isExecutable(file: string): Promise<boolean> {
    return pathAccessible(file, fs.constants.X_OK);
}

export function escapeStringForRegex(str: string): string {
    return str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, '\\$1');
}

/**
 * Find PowerShell executable from PATH (for Windows only).
 */
export function findPowerShell(): string | undefined {
    const dirs: string[] = (process.env.PATH || '').replace(/"+/g, '').split(';').filter(x => x);
    const exts: string[] = (process.env.PATHEXT || '').split(';');
    const names: string[] = ['pwsh', 'powershell'];
    for (const name of names) {
        const candidates: string[] = dirs.reduce<string[]>((paths, dir) => [
            ...paths, ...exts.map(ext => path.join(dir, name + ext))
        ], []);
        for (const candidate of candidates) {
            try {
                if (fs.statSync(candidate).isFile()) {
                    return name;
                }
            } catch (e) {
                return undefined;
            }
        }
    }
}