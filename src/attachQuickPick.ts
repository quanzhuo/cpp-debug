import * as path from 'path';
import * as vscode from 'vscode';

class RefreshButton implements vscode.QuickInputButton {
    constructor(private context: vscode.ExtensionContext) { }
    get iconPath(): { dark: vscode.Uri; light: vscode.Uri } {
        const refreshImagePathDark: string = path.join(this.context.extensionPath, "images", "Refresh_inverse.svg");
        const refreshImagePathLight: string = path.join(this.context.extensionPath, "images", "Refresh.svg");

        return {
            dark: vscode.Uri.file(refreshImagePathDark),
            light: vscode.Uri.file(refreshImagePathLight)
        };
    }

    get tooltip(): string {
        return vscode.l10n.t('Refresh process list');
    }
}

export interface AttachItem extends vscode.QuickPickItem {
    id?: string;
}

async function showAttachQuickPick(getAttachItems: () => Promise<AttachItem[]>, context: vscode.ExtensionContext): Promise<AttachItem | undefined> {
    const processEntries: AttachItem[] = await getAttachItems();
    return new Promise<AttachItem | undefined>((resolve, reject) => {
        const quickPick: vscode.QuickPick<AttachItem> = vscode.window.createQuickPick<AttachItem>();
        quickPick.title = vscode.l10n.t('Attach to process');
        quickPick.canSelectMany = false;
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        quickPick.placeholder = vscode.l10n.t('Select the process to attach to');
        quickPick.buttons = [new RefreshButton(context)];
        quickPick.items = processEntries;
        const disposables: vscode.Disposable[] = [];

        quickPick.onDidTriggerButton(async () => { quickPick.items = await getAttachItems(); }, undefined, disposables);

        quickPick.onDidAccept(() => {
            if (quickPick.selectedItems.length !== 1) {
                reject(new Error(vscode.l10n.t('Process not selected.')));
            }

            const selectedItem: AttachItem | undefined = quickPick.selectedItems[0];

            disposables.forEach(item => item.dispose());
            quickPick.dispose();

            resolve(selectedItem);
        }, undefined, disposables);

        quickPick.onDidHide(() => {
            disposables.forEach(item => item.dispose());
            quickPick.dispose();

            reject(new Error(vscode.l10n.t('Process not selected.')));
        }, undefined, disposables);

        quickPick.show();
    });
}

// We should not await on this function.
export async function showQuickPick(getAttachItems: () => Promise<AttachItem[]>, context: vscode.ExtensionContext): Promise<string | undefined> {
    const selectedItem = await showAttachQuickPick(getAttachItems, context);
    return selectedItem?.id;
}

// We should not await on this function.
export async function showAttachItemQuickPick(getAttachItems: () => Promise<AttachItem[]>, context: vscode.ExtensionContext): Promise<AttachItem | undefined> {
    return showAttachQuickPick(getAttachItems, context);
}
