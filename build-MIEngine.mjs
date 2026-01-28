import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = __dirname;
const miEngineDir = path.join(rootDir, 'submodules', 'MIEngine');
const debugAdapterDir = path.join(rootDir, 'debugAdapter');
const csprojPath = path.join(miEngineDir, 'src', 'MakePIAPortable', 'MakePIAPortable.csproj');

async function build() {
    // 1. Delete debugAdapter directory
    if (fs.existsSync(debugAdapterDir)) {
        console.log(`Deleting ${debugAdapterDir}...`);
        fs.rmSync(debugAdapterDir, { recursive: true, force: true });
    }

    let originalCsprojContent = null;
    let modified = false;

    // 1.5 Patch MakePIAPortable.csproj for Linux ARM64
    if (process.platform === 'linux' && process.arch === 'arm64') {
        if (fs.existsSync(csprojPath)) {
            try {
                originalCsprojContent = fs.readFileSync(csprojPath, 'utf8');
                if (originalCsprojContent.includes('linux-x64')) {
                    console.log('Detected Linux ARM64, patching MakePIAPortable.csproj...');
                    const newContent = originalCsprojContent.replace(/linux-x64/g, 'linux-arm64');
                    fs.writeFileSync(csprojPath, newContent, 'utf8');
                    modified = true;
                }
            } catch (err) {
                console.error('Error patching MakePIAPortable.csproj:', err);
            }
        }
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

    const restoreCsproj = () => {
        if (modified && originalCsprojContent) {
            try {
                console.log('Restoring MakePIAPortable.csproj...');
                fs.writeFileSync(csprojPath, originalCsprojContent, 'utf8');
                modified = false;
            } catch (err) {
                console.error('Error restoring MakePIAPortable.csproj:', err);
            }
        }
    };

    child.on('close', (code) => {
        restoreCsproj();
        if (code !== 0) {
            console.error(`Build failed with code ${code}`);
            process.exit(1);
        } else {
            console.log('Build completed successfully.');
        }
    });

    child.on('error', (err) => {
        restoreCsproj();
        console.error('Failed to start subprocess:', err);
        process.exit(1);
    });
}

build();
