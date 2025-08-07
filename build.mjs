import { execSync } from 'child_process';
import { createWriteStream } from 'fs';
import { unlinkSync } from 'fs';
import { pipeline } from 'stream';
import { promisify } from 'util';
import fetch from 'node-fetch';
import * as tar from 'tar';

const debugAdapterZips = [
    'win32-x64.tar',
    'darwin-x64.tar',
    'linux-x64.tar',
    'linux-arm64.tar',
];

const downloadAndExtract = async (file) => {
    const url = `http://172.29.158.56:8000/${file}`;
    const filePath = `./${file}`;

    // 下载文件
    const response = await fetch(url);
    if (!response.ok) { throw new Error(`Failed to download ${file}`); }

    await promisify(pipeline)(
        response.body,
        createWriteStream(filePath)
    );

    await tar.x({ file: filePath });
    unlinkSync(filePath);

    const targetPlatform = file.slice(0, -4);
    execSync(`vsce package --target ${targetPlatform}`, { stdio: 'inherit' });
    execSync(`rm -rf debugAdapter`, { stdio: 'inherit' });
};

const main = async () => {
    execSync(`rm -rf debugAdapter *.tar *.vsix`, { stdio: 'inherit' });
    for (const file of debugAdapterZips) {
        try {
            await downloadAndExtract(file);
        } catch (error) {
            console.error(`Error processing ${file}:`, error);
        }
    }
};

main();