import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const src = path.join(root, 'src');
const bundleTargets = [
  ['background/service-worker.ts', 'background/service-worker.js', 'esm'],
  ['content/content-script.ts', 'content/content-script.js', 'iife'],
  ['sidepanel/sidepanel.ts', 'sidepanel/sidepanel.js', 'iife']
];
const staticFiles = [
  ['manifest.json', 'manifest.json'],
  ['content/content-script.css', 'content/content-script.css'],
  ['sidepanel/sidepanel.css', 'sidepanel/sidepanel.css'],
  ['sidepanel/sidepanel.html', 'sidepanel/sidepanel.html'],
  ['assets/fonts/VT323-Regular.ttf', 'fonts/VT323-Regular.ttf'],
  ['assets/icons/icon-16.png', 'icons/icon-16.png'],
  ['assets/icons/icon-32.png', 'icons/icon-32.png'],
  ['assets/icons/icon-48.png', 'icons/icon-48.png'],
  ['assets/icons/icon-128.png', 'icons/icon-128.png']
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await Promise.all(['background', 'content', 'sidepanel', 'fonts', 'icons'].map(dir => mkdir(path.join(dist, dir), { recursive: true })));

const baseBuild = {
  bundle: true,
  minify: false,
  sourcemap: false,
  target: 'chrome120',
  logLevel: 'info'
};

for (const [entryPoint, outfile, format] of bundleTargets) {
  await build({
    ...baseBuild,
    entryPoints: [path.join(src, entryPoint)],
    outfile: path.join(dist, outfile),
    format
  });
}

for (const [from, to] of staticFiles) {
  await copyFile(path.join(src, from), path.join(dist, to));
}

const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'));
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
manifest.version = version;
await writeFile(path.join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
