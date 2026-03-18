import * as vscode from 'vscode';
import { AttachItemsProvider, AttachPicker, RemoteAttachPicker } from './attachToProcess';
import { CppDebugConfigurationProvider } from './configurationProvider';
import { NativeAttachItemsProviderFactory } from './nativeAttach';

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

	// Register Build and Debug / Build and Run / Add Debug Configuration commands
	context.subscriptions.push(
		vscode.commands.registerTextEditorCommand('cppdebug.buildAndDebugFile', (textEditor) => configProvider.buildAndDebug(textEditor))
	);
	context.subscriptions.push(
		vscode.commands.registerTextEditorCommand('cppdebug.buildAndRunFile', (textEditor) => configProvider.buildAndRun(textEditor))
	);
	context.subscriptions.push(
		vscode.commands.registerTextEditorCommand('cppdebug.addDebugConfiguration', (textEditor) => configProvider.addDebugConfiguration(textEditor))
	);
}

export function deactivate() { }
