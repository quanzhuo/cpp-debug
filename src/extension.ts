import * as vscode from 'vscode';
import { AttachItemsProvider, AttachPicker, RemoteAttachPicker } from './attachToProcess';
import { NativeAttachItemsProviderFactory } from './nativeAttach';
import { copyNatvisFilesToUserCache } from './utils';

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension Cpp Debug is now active!');

	const attachItemsProvider: AttachItemsProvider = NativeAttachItemsProviderFactory.Get();
	const attacher: AttachPicker = new AttachPicker(attachItemsProvider, context);
	context.subscriptions.push(vscode.commands.registerCommand('extension.pickNativeProcess', () => attacher.ShowAttachEntries()));
	const remoteAttacher: RemoteAttachPicker = new RemoteAttachPicker();
	context.subscriptions.push(vscode.commands.registerCommand('extension.pickRemoteNativeProcess', (any) => remoteAttacher.ShowAttachEntries(any)));

	copyNatvisFilesToUserCache(context);
}

export function deactivate() { }
