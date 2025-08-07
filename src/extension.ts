import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "debug" is now active!');

	// context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('cppdbg', new CppDbgConfigurationProvider()));
	// context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('cppdbg', {
	// 	// triggerKind: vscode.DebugConfigurationProviderTriggerKind.Dynamic
	// 	//
	// 	// With the trigger kind Dynamic the provideDebugConfigurations method is used to dynamically determine debug configurations to be presented to the user (in addition to the static configurations from the launch.json).
	// 	// 当用户在运行和调试视图中点击下拉列表，并选择 'C++ (GDB/LLDB)...' 时，会调用这个方法提供调试配置
	// 	provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration[]> {
	// 		return [
	// 			{
	// 				name: "Launch Program",
	// 				type: "cppdbg",
	// 				request: "launch",
	// 				program: "${file}",
	// 				stopAtEntry: true,
	// 				args: [],
	// 				cwd: ".",
	// 				preLaunchTask: "build"
	// 			}
	// 		];
	// 	}
	// }, vscode.DebugConfigurationProviderTriggerKind.Dynamic));


	// context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('cppdbg', {
	// 	// triggerKind: vscode.DebugConfigurationProviderTriggerKind.Initial
	// 	//
	// 	// With the value Initial (or if no trigger kind argument is given) the provideDebugConfigurations method is used to provide the initial debug configurations to be copied into a newly created launch.json
	// 	// 也就是说，当工作区中不存在 launch.json 文件时，在运行和调试视图中点击 '创建 launch.json 文件' 按钮时，会调用这个方法提供调试配置并复制到 launch.json 文件中，同时 设置于 package.json 中的 initialConfigurations 也会被复制到 launch.json 文件中
	// 	// 如果已经存在了 launch.json 文件，点击 '创建 launch.json 文件' 按钮时，不会调用这个方法，没有任何效果
	// 	provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration[]> {
	// 		return [
	// 			{
	// 				name: "Launch Program",
	// 				type: "cppdbg",
	// 				request: "launch",
	// 				program: "${file}",
	// 				stopAtEntry: true,
	// 				args: [],
	// 				cwd: ".",
	// 				preLaunchTask: "build"
	// 			}
	// 		];
	// 	}
	// }, vscode.DebugConfigurationProviderTriggerKind.Initial));
}

class CppDbgConfigurationProvider implements vscode.DebugConfigurationProvider {

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 * 
	 * 用于在启动调试会话之前解析和修改调试配置。它允许你在用户启动调试之前对调试配置进行最后的调整或验证。
	 */
	resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
		if (!config.program) {
			return null;
		}

		if (!config.type && !config.request && !config.name) {
			config.type = 'cppdbg';
			config.request = 'launch';
			config.name = 'Launch Program';
			config.stopAtEntry = true;
		}
		return config;
	}


}

export function deactivate() { }
