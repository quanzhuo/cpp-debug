import * as vscode from 'vscode';
import { AttachItemsProvider, AttachPicker, RemoteAttachPicker } from './attachToProcess';
import { NativeAttachItemsProviderFactory } from './nativeAttach';
import { copyNatvisFilesToUserCache } from './utils';
import { CppDebugConfigurationProvider } from './configurationProvider';

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension Cpp Debug is now active!');

	const attachItemsProvider: AttachItemsProvider = NativeAttachItemsProviderFactory.Get();
	const attacher: AttachPicker = new AttachPicker(attachItemsProvider, context);
	context.subscriptions.push(vscode.commands.registerCommand('cppdebug.pickNativeProcess', () => attacher.ShowAttachEntries()));
	const remoteAttacher: RemoteAttachPicker = new RemoteAttachPicker();
	context.subscriptions.push(vscode.commands.registerCommand('cppdebug.pickRemoteNativeProcess', (any) => remoteAttacher.ShowAttachEntries(any)));

	// Register debug configuration provider to auto-inject GDB pretty printer setup
	const configProvider = new CppDebugConfigurationProvider(context.extensionPath);
	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider('cppdbg', configProvider)
	);

	copyNatvisFilesToUserCache(context);
}

export function deactivate() { }
