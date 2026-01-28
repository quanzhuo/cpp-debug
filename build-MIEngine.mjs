import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = __dirname;
const miEngineDir = path.join(rootDir, 'submodules', 'MIEngine');
const debugAdapterDir = path.join(rootDir, 'debugAdapter');

async function build() {
    // 1. Delete debugAdapter directory
    if (fs.existsSync(debugAdapterDir)) {
        console.log(`Deleting ${debugAdapterDir}...`);
        fs.rmSync(debugAdapterDir, { recursive: true, force: true });
    }

    // 2. Determine script based on platform
    const isWindows = process.platform === 'win32';
    const scriptName = isWindows ? 'PublishOpenDebugAD7.bat' : './PublishOpenDebugAD7.sh';

    // Arguments: -c Release -o <absolute_path_to_debugAdapter>
    const args = ['-c', 'Release', '-o', debugAdapterDir];

    console.log(`Executing ${scriptName} ${args.join(' ')} in ${miEngineDir}...`);

    const child = spawn(scriptName, args, {
        cwd: miEngineDir,
        stdio: 'inherit',
        shell: true 
    });

    child.on('close', (code) => {
        if (code !== 0) {
            console.error(`Build failed with code ${code}`);
            process.exit(1);
        } else {
            console.log('Build completed successfully.');
        }
    });

    child.on('error', (err) => {
        console.error('Failed to start subprocess:', err);
        process.exit(1);
    });
}

build();
