import * as vscode from 'vscode';

export interface ExpansionVars {
    [key: string]: string;
    workspaceFolder: string;
    workspaceFolderBasename: string;
}

export interface ExpansionOptions {
    vars: ExpansionVars;
    doNotSupportCommands?: boolean;
    recursive?: boolean;
}

export async function expandAllStrings(obj: any, options: ExpansionOptions): Promise<void> {
    if (Array.isArray(obj) || (obj !== null && typeof obj === 'object')) {
        for (const key of Object.keys(obj)) {
            if (typeof obj[key] === 'string') {
                obj[key] = await expandString(obj[key], options);
            } else {
                await expandAllStrings(obj[key], options);
            }
        }
    }
}

export async function expandString(input: string, options: ExpansionOptions): Promise<string> {
    const maxRecursion = 10;
    let result: string = input;
    let didReplacement = false;

    let i = 0;
    do {
        [result, didReplacement] = await expandStringImpl(result, options);
        i++;
    } while (i < maxRecursion && options.recursive && didReplacement);

    return replaceAll(result, '${dollar}', '$');
}

async function expandStringImpl(input: string, options: ExpansionOptions): Promise<[string, boolean]> {
    if (!input) {
        return [input, false];
    }

    const subs: Map<string, string> = new Map<string, string>();

    const varRe: RegExp = /\$\{(\w+)\}/g;
    let match: RegExpExecArray | null = null;
    while (match = varRe.exec(input)) {
        const full: string = match[0];
        const key: string = match[1];
        if (key !== 'dollar') {
            const repl: string = options.vars[key];
            if (!repl) {
                void vscode.window.showWarningMessage(`Invalid variable reference ${full} in string: ${input}.`);
            } else {
                subs.set(full, repl);
            }
        }
    }

    const varValueRegexp = '.+?';
    const envRe: RegExp = new RegExp(`\\$\\{env:(${varValueRegexp})\\}`, 'g');
    while (match = envRe.exec(input)) {
        const full: string = match[0];
        const varname: string = match[1];
        if (process.env[varname] === undefined) {
            void vscode.window.showWarningMessage(`Environment variable ${varname} not found.`);
        }
        subs.set(full, process.env[varname] || '');
    }

    const commandRe: RegExp = new RegExp(`\\$\\{command:(${varValueRegexp})\\}`, 'g');
    while (match = commandRe.exec(input)) {
        if (options.doNotSupportCommands) {
            void vscode.window.showWarningMessage(`Commands are not supported for string: ${input}.`);
            break;
        }
        const full: string = match[0];
        const command: string = match[1];
        if (subs.has(full)) {
            continue;
        }
        try {
            const commandRet: unknown = await vscode.commands.executeCommand(command, options.vars.workspaceFolder);
            subs.set(full, `${commandRet}`);
        } catch (e: any) {
            void vscode.window.showWarningMessage(`Exception while executing command ${command} for string: ${input} ${e}.`);
        }
    }

    let result: string = input;
    let didReplacement = false;
    subs.forEach((value, key) => {
        if (value !== key) {
            result = replaceAll(result, key, value);
            didReplacement = true;
        }
    });

    return [result, didReplacement];
}

function replaceAll(input: string, search: string, replacement: string): string {
    return input.split(search).join(replacement);
}