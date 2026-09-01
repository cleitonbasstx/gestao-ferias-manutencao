import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('Public interface has valid inline JavaScript and no initial employee records', async () => {
  const html = await readFile('site/index.html','utf8');
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  assert.match(html, /<tbody id="vacations"><\/tbody>/);
  assert.match(html, /const ganttData = \{ summary: \{\}, people: \[\] \};/);
  assert.doesNotMatch(html, /gantt-data\.js|\/api\/state|\/api\/import|chatgpt\.site/);
  assert.match(html, /await window.VacationBackend.ready\(\)/);
  assert.match(html, /<img src="pcm-logo\.svg" alt="PCM">/);
  assert.match(html, /Gestor: Leonardo Bastos/);
  assert.match(html, /Entrar na plataforma/);
  assert.match(html, /nome@suzano\.com\.br/);
  assert.match(await readFile('src/supabase-adapter.js','utf8'), /SIGNUP_DOMAIN = '@suzano\.com\.br'/);
  assert.doesNotMatch(html, /Não é necessário ter conta no ChatGPT/);
  assert.ok((await readFile('site/pcm-logo.svg','utf8')).startsWith('<svg'));
  const css = await readFile('site/app.css','utf8');
  assert.doesNotMatch(css, /@import/);
});
