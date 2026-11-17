// Bundles the game into one self-contained HTML file inside the Xcode app folder.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const res = await build({
  entryPoints: [join(here, 'src/main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  loader: { '.jpg': 'dataurl', '.glb': 'binary' },
  write: false,
});
const js = res.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const html = readFileSync(join(here, 'template.html'), 'utf8').replace('/*__JS__*/', () => js);
const out = join(here, '..', 'Hyperrealistic_boat_game', 'Wakefire.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
// Same file as a static site (web/index.html) for hosting.
mkdirSync(join(here, 'web'), { recursive: true });
writeFileSync(join(here, 'web', 'index.html'), html);
console.log('wrote web/index.html');
