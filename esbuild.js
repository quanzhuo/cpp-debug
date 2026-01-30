const esbuild = require('esbuild');
const fse = require('fs-extra');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
    // Copy gdb-pretty-printers submodule to root
    try {
        const src = path.join(__dirname, 'submodules', 'gdb-pretty-printers');
        const dest = path.join(__dirname, 'gdb-pretty-printers');
        
        // Remove destination if it exists to ensure clean state
        fse.removeSync(dest);
        
        console.log(`[build] Copying gdb-pretty-printers to ${dest}...`);
        fse.copySync(src, dest, {
            filter: (srcPath) => {
                const base = path.basename(srcPath);
                // Exclude .git folder
                if (base === '.git') return false;
                // Exclude files ignored by git (from .gitignore)
                if (base === '__pycache__' || base.endsWith('.pyc') || base === 'gdb.txt' || base === 'autoload.log') {
                    return false;
                }
                return true;
            }
        });
    } catch (e) {
        console.error('[build] Error copying gdb-pretty-printers:', e);
    }

    if (production) {
        // remove dist folder
        const fs = require('fs');
        fs.rmSync('dist', { recursive: true, force: true });
    }
    const ctx = await esbuild.context({
        entryPoints: ['src/extension.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: 'dist/extension.js',
        external: ['vscode'],
        logLevel: 'silent',
        plugins: [
            /* add to the end of plugins array */
            esbuildProblemMatcherPlugin
        ]
    });
    if (watch) {
        await ctx.watch();
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',

    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd(result => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                console.error(`    ${location.file}:${location.line}:${location.column}:`);
            });
            console.log('[watch] build finished');
        });
    }
};

main().catch(e => {
    console.error(e);
    process.exit(1);
});
