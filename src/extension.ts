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
	const configProvider = new CppDebugConfigurationProvider(context.extensionPath, context);
	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider('cppdbg', configProvider)
	);
	// Register as Dynamic provider so the "Run and Debug" panel shows auto-detected configs
	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider('cppdbg', configProvider, vscode.DebugConfigurationProviderTriggerKind.Dynamic)
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
	context.subscriptions.push(
		vscode.commands.registerCommand('cppdebug.attachToProcess', async () => {
			const activeFolder = vscode.window.activeTextEditor
				? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
				: undefined;
			const fallbackFolder = vscode.workspace.workspaceFolders?.[0];
			await configProvider.attachToProcess(activeFolder ?? fallbackFolder);
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('cppdebug.attachToProcessWithConfiguration', async () => {
			const activeFolder = vscode.window.activeTextEditor
				? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
				: undefined;
			const fallbackFolder = vscode.workspace.workspaceFolders?.[0];
			await configProvider.attachToProcessWithConfiguration(activeFolder ?? fallbackFolder);
		})
	);
}

export function deactivate() { }
