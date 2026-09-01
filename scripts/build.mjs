import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
const assets = ['index.html','app.css','auth.css','config.js','pcm-logo.svg'];
if (!process.argv.includes('--verify-only')) {
  await mkdir('dist', { recursive: true });
  for (const asset of assets) await copyFile(`site/${asset}`, `dist/${asset}`);
  await build({ entryPoints: ['src/supabase-adapter.js'], outfile: 'dist/supabase-adapter.js',
    bundle: true, format: 'iife', platform: 'browser', target: ['es2022'], minify: true });
}
await writeFile('dist/.nojekyll', '');
const allowed = new Set([...assets, 'supabase-adapter.js', '.nojekyll']);
for (const name of await readdir('dist')) {
  if (!allowed.has(name)) throw new Error(`Arquivo não autorizado para publicação: ${name}`);
}
const html = await readFile('dist/index.html','utf8');
for (const forbidden of ['gantt-data.js','/api/state','/api/import','signin-with-chatgpt','chatgpt.site']) {
  if (html.includes(forbidden)) throw new Error(`Arquivo público contém conteúdo antigo: ${forbidden}`);
}
console.log('Arquivos estáticos verificados em dist/. Nenhum backup foi incluído.');
