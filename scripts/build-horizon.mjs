import {readFile, mkdir, cp, writeFile, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve, dirname, sep} from 'node:path';
const production = process.argv.includes('--production');
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(projectRoot, 'public');
const output = resolve(projectRoot, production ? 'dist-production' : 'dist');
// Only these two generated directories may be replaced by the build.
if (dirname(output) !== projectRoot || !['dist', 'dist-production'].includes(output.slice(projectRoot.length + 1))) throw Error('Unsafe output directory');
const data = JSON.parse(await readFile(resolve(projectRoot, 'content/projects.json'), 'utf8'));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]));
const ids = new Set();
for (const p of data.projects) {
  if (ids.has(p.id)) throw Error('Duplicate project'); ids.add(p.id);
  for (const d of p.downloads) {
    const u = new URL(d.url);
    if (u.protocol !== 'https:' || !['github.com', 'raw.githubusercontent.com'].includes(u.hostname)) throw Error('Invalid download URL');
  }
}
let html = await readFile(resolve(source, 'horizon.html'), 'utf8');
const files = new Set(['app.js', 'horizon.css', 'horizon.js', 'blackhole.js', 'assets/noxevyr-social.jpg', 'assets/plasma-flow.png', 'assets/plasma-turbulence.png', 'assets/plasma-flow-standard.png', 'assets/plasma-turbulence-standard.png']);
for (const match of html.matchAll(/(?:src|href)="(assets\/[^"?#]+)(?:[?#][^"]*)?"/g)) files.add(match[1]);
for (const p of data.projects) {
  for (const field of ['icon', 'image']) if (p[field]) files.add(p[field]);
  for (const shot of p.screenshots || []) files.add(shot.src);
  const preview = p.screenshots?.[0];
  const fields = {
    name: p.name, english: p.english, description: p.description,
    icon: p.icon || 'assets/noxevyr-mark.svg',
    preview: preview?.src || p.image,
    previewWidth: preview?.width || 1600, previewHeight: preview?.height || 1000,
    previewCaption: preview?.caption || p.imageNote,
  };
  for (const [field, value] of Object.entries(fields)) html = html.replaceAll(`{{${field}:${p.id}}}`, escapeHtml(value));
}
html = html.replaceAll('{{count:all}}', String(data.projects.length)).replaceAll('{{count:total}}', String(data.projects.length).padStart(2, '0'));
for (const category of ['creative', 'tools', 'play']) html = html.replaceAll(`{{count:${category}}}`, String(data.projects.filter(p => p.category === category).length));
const hash = createHash('sha256').update(html);
const sourceFiles = [];
for (const file of files) {
  const from = resolve(source, file), to = resolve(output, file);
  if (!from.startsWith(source + sep) || !to.startsWith(output + sep)) throw Error(`Asset path outside website: ${file}`);
  hash.update(await readFile(from)); sourceFiles.push({from, to});
}
const buildVersion = hash.digest('hex').slice(0, 12);
const dataVersion = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 12);
html = html.replaceAll('{{build}}', buildVersion).replaceAll('{{data}}', dataVersion);
if (/\{\{[^}]+\}\}/.test(html)) throw Error('Unresolved template field');
await rm(output, {recursive: true, force: true}); await mkdir(output, {recursive: true});
for (const {from, to} of sourceFiles) { await mkdir(dirname(to), {recursive: true}); await cp(from, to); }
await writeFile(resolve(output, 'data.js'), 'window.PORTFOLIO = ' + JSON.stringify(data).replace(/</g, '\\u003c') + ';\n');
await writeFile(resolve(output, 'index.html'), html);
console.log(`Built ${data.projects.length} projects into ${production ? 'dist-production' : 'dist'}/ — NOXEVYR black-hole design (${buildVersion})`);
