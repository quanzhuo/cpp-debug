const esbuild = require('esbuild');
const fse = require('fs-extra');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
    const distDir = path.join(__dirname, 'dist');
    const prettyPrintersDir = path.join(distDir, 'gdb-pretty-printers');

    // Copy gdb-pretty-printers submodule to dist
    try {
        const src = path.join(__dirname, 'submodules', 'gdb-pretty-printers');
        const dest = prettyPrintersDir;

        fse.ensureDirSync(distDir);
        fse.removeSync(dest);

        console.log(`[build] Copying gdb-pretty-printers to ${dest}...`);
        for (const item of ['printers', 'autoload.py']) {
            fse.copySync(path.join(src, item), path.join(dest, item), {
                filter: (srcPath) => {
                    const base = path.basename(srcPath);
                    if (base === '__pycache__' || base.endsWith('.pyc')) { return false; }
                    return true;
                }
            });
        }
    } catch (e) {
        console.error('[build] Error copying gdb-pretty-printers:', e);
    }

    if (production) {
        fse.removeSync(path.join(distDir, 'extension.js'));
        fse.removeSync(path.join(distDir, 'extension.js.map'));
    }
    const ctx = await esbuild.context({
        entryPoints: ['src/extension.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: !production,
        platform: 'node',
        outfile: path.join(distDir, 'extension.js'),
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
