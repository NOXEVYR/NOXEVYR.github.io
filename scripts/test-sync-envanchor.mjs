import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {syncEnvAnchor} from './sync-envanchor.mjs';

// Exercise the real injected helpers without importing sync.mjs, whose top level
// fetches GitHub and writes the catalog. These fixtures perform no network IO.
const source = readFileSync(new URL('./sync.mjs', import.meta.url), 'utf8');
const helpers = runInNewContext(`${source.slice(source.indexOf('const version='), source.indexOf('async function releases('))}
${source.slice(source.indexOf('function summary('), source.indexOf('// Only real'))}
${source.slice(source.indexOf('const preview='), source.indexOf('async function aiHubJson('))}
({version, compare, windows, preview, summary})`);
const release = (v, options = {}) => ({
  tag_name: `v${v}`, html_url: `https://github.com/NOXEVYR/env-anchor/releases/tag/v${v}`,
  published_at: '2026-10-02T00:00:00Z', body: `- ${v} public changes`, draft: false,
  prerelease: v.includes('-'), assets: [{name: `EnvAnchor-${v}.exe`, size: 326144, state: 'uploaded',
    browser_download_url: `https://github.com/NOXEVYR/env-anchor/releases/download/v${v}/EnvAnchor-${v}.exe`}],
  ...options,
});
const project = () => ({id: 'env-anchor', version: '0.6.0', status: '已发布', date: '2026-09-19', update: 'reviewed summary',
  downloads: [{label: 'Windows 0.6.0', url: release('0.6.0').html_url, channel: 'stable'}],
  image: 'original.png', previewVersion: '0.6.0', imageNote: '历史界面',
  screenshots: [{src: 'original.png', version: '0.6.0', caption: '历史界面', width: 1096, height: 829}],
});
const stable = release('0.6.0');
const newerPreview = release('0.8.0-preview.1');
const imageFields = value => Object.fromEntries(['image', 'previewVersion', 'imageNote', 'screenshots'].map(key => [key, value[key]]));

const promoted = project();
syncEnvAnchor(promoted, [stable, newerPreview], helpers);
assert.equal(promoted.version, '0.8.0-preview.1');
assert.equal(promoted.status, '预览版');
assert.deepEqual(promoted.downloads.map(download => download.channel), ['preview', 'stable']);
assert.match(promoted.downloads[0].label, /预览版/);
assert.match(promoted.downloads[1].label, /0\.6\.0.*稳定版.*备用/);
assert.equal(promoted.downloads[1].url, stable.html_url);
assert.match(promoted.downloadNote, /功能预览版.*稳定版.*备用/);
assert.deepEqual(imageFields(promoted), imageFields(project()));
const once = structuredClone(promoted);
const reviewedStable = {...project(), version: '0.8.0', date: '2026-10-03', downloads: [{label: 'Windows 0.8.0', url: release('0.8.0').html_url, channel: 'stable'}]};
const reviewedStableBefore = structuredClone(reviewedStable);
syncEnvAnchor(reviewedStable, [release('0.8.0', {prerelease: true, published_at: '2026-10-01T00:00:00Z'})], helpers);
assert.deepEqual(reviewedStable, reviewedStableBefore, 'older same-version preview snapshot cannot demote stable');
syncEnvAnchor(promoted, [newerPreview, stable], helpers);
assert.deepEqual(promoted, once, 'repeated sync must not duplicate or reorder downloads');

const portable = release('0.8.0-preview.1');
portable.assets[0].name = 'EnvAnchor-0.8.0-preview.1-win10-portable.zip';
const portableProject = project();
syncEnvAnchor(portableProject, [portable, stable], helpers);
assert.equal(portableProject.version, '0.8.0-preview.1');
const stableZip = release('0.7.0');
stableZip.assets[0].name = 'EnvAnchor-0.7.0-win10-portable.zip';
const stableZipProject = project();
syncEnvAnchor(stableZipProject, [stableZip], helpers);
assert.equal(stableZipProject.version, '0.7.0');

for (const names of [[], ['EnvAnchor-0.9.0-Source.zip'], ['EnvAnchor-0.9.0-extension.zip'],
  ['EnvAnchor-0.9.0-macOS.zip'], ['EnvAnchor-0.9.0-osx.zip'], ['EnvAnchor-0.9.0-linux.zip'],
  ['EnvAnchor-0.9.0-android.zip'], ['EnvAnchor-0.9.0-win10-arm64.zip'],
  ['EnvAnchor-0.8.0.exe'], ['EnvAnchor-0.9.0-preview.1.exe'], ['unrelated-Windows.exe']]) {
  const candidate = release('0.9.0');
  candidate.assets = names.map(name => ({...candidate.assets[0], name}));
  const untouched = project();
  syncEnvAnchor(untouched, [candidate], helpers);
  assert.deepEqual(untouched, project(), `invalid program attachments: ${names}`);
}
for (const overrides of [{draft: true}, {tag_name: 'vnext'}, {tag_name: 'v0.9.0junk'},
  {published_at: null}, {published_at: 'invalid'}, {html_url: 'https://example.com/release'}]) {
  const untouched = project();
  syncEnvAnchor(untouched, [release('0.9.0', overrides)], helpers);
  assert.deepEqual(untouched, project());
}
for (const overrides of [{size: 0}, {state: 'starter'}, {browser_download_url: 'https://example.com/program.exe'}]) {
  const invalid = release('0.9.0');
  Object.assign(invalid.assets[0], overrides);
  const untouched = project();
  syncEnvAnchor(untouched, [invalid], helpers);
  assert.deepEqual(untouched, project());
}

const graduated = structuredClone(promoted);
syncEnvAnchor(graduated, [newerPreview, stable, release('0.8.0')], helpers);
assert.equal(graduated.version, '0.8.0');
assert.equal(graduated.status, '已发布');
assert.deepEqual(graduated.downloads.map(download => download.channel), ['stable']);
assert.deepEqual(imageFields(graduated), imageFields(project()));
// A release flagged preview may have an unsuffixed version; stable still wins
// equal versions even if the preview has a later publication date.
const sameVersion = project();
syncEnvAnchor(sameVersion, [release('0.8.0', {prerelease: true, published_at: '2026-10-03T00:00:00Z'}),
  release('0.8.0', {body: '- stable wins'})], helpers);
assert.equal(sameVersion.status, '已发布');
assert.equal(sameVersion.update, 'stable wins');

const ahead = {...project(), version: '0.10.0-preview.1', status: '预览版'};
const aheadBefore = structuredClone(ahead);
syncEnvAnchor(ahead, [stable, newerPreview], helpers);
assert.deepEqual(ahead, aheadBefore, 'older API snapshot cannot roll back reviewed catalog');
const empty = project();
syncEnvAnchor(empty, [], helpers);
assert.deepEqual(empty, project());
const preservedStable = project();
syncEnvAnchor(preservedStable, [newerPreview], helpers);
assert.equal(preservedStable.downloads[1].url, stable.html_url, 'preserve reviewed stable when absent from snapshot');
const staleStable = project();
syncEnvAnchor(staleStable, [newerPreview, release('0.5.0')], helpers);
assert.equal(staleStable.downloads[1].url, stable.html_url, 'backup must not regress');

const duplicate = project();
duplicate.downloads.push({label: 'other duplicate', url: newerPreview.html_url, channel: 'other'});
syncEnvAnchor(duplicate, [newerPreview, stable, newerPreview], helpers);
assert.equal(new Set(duplicate.downloads.map(download => download.url)).size, duplicate.downloads.length);
const other = {...project(), id: 'classicdesk'};
const otherBefore = structuredClone(other);
syncEnvAnchor(other, [newerPreview], helpers);
assert.deepEqual(other, otherBefore);
assert.match(source, /if\(p\.id==='env-anchor'\)\{\s*syncEnvAnchor\(p,all,\{version,compare,windows,preview,summary\}\);[\s\S]*?return;/);
console.log('PASS EnvAnchor public preview/stable selection, Windows program exclusions, no rollback, download deduplication, product isolation and historical images');
