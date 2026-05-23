const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const watch = process.argv.includes('--watch');

const buildConfig = {
  bundle: true,
  entryPoints: ['./src/main.ts'],
  external: ['obsidian'],
  format: 'cjs',
  outfile: './dist/main.js',
  platform: 'node',
  sourcemap: true,
  target: 'es2020',
};

function copyStaticFiles() {
  const files = ['manifest.json', 'versions.json'];
  for (const file of files) {
    fs.copyFileSync(path.join(__dirname, file), path.join(__dirname, 'dist', file));
  }
}

async function main() {
  if (watch) {
    const ctx = await esbuild.context(buildConfig);
    await ctx.watch();
    fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
    copyStaticFiles();
    console.log('plugin-loader watcher started');
    return;
  }

  await esbuild.build(buildConfig);
  copyStaticFiles();
  console.log('plugin-loader build complete');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
