import assert from 'node:assert/strict';
import {syncVideoCatch} from './sync-videocatch.mjs';
const helpers = {
  version: tag => tag.match(/(?:^|v)(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/)?.[1],
  compare: (a, b) => a.localeCompare(b, undefined, {numeric: true}),
  summary: release => release.body,
};
const asset = (name, overrides = {}) => ({name, size: 1024, state: 'uploaded', browser_download_url: `https://github.com/NOXEVYR/video-catch/releases/download/v0.5.0/${name}`, ...overrides});
const release = (v, names, extra = {}) => ({tag_name: `v${v}`, published_at: '2026-09-26T10:00:00Z', body: `${v} changes`, assets: names.map(name => asset(name)), ...extra});
const project = () => ({id: 'video-catch', version: '0.5.0', status: '发布准备', date: null, downloads: [
  {label: 'Windows 0.5.0', url: 'tag', channel: 'stable'},
  {label: 'macOS 0.5.0 · Apple Silicon', url: 'mac-arm-tag', channel: 'mac-arm64'},
  {label: 'macOS 0.5.0 · Intel', url: 'mac-intel-tag', channel: 'mac-x86_64'},
  {label: 'Chrome / Edge 扩展 0.4.2', url: 'extension-042', channel: 'extension'},
]});
const names = ['VideoCatch-v0.5.0-Windows-x64.zip', 'VideoCatch-v0.5.0-macOS-arm64.zip', 'VideoCatch-v0.5.0-macOS-x86_64.zip'];
const complete = project();
syncVideoCatch(complete, [release('0.5.0', names)], helpers);
assert.equal(complete.status, '已发布');
assert.equal(complete.downloads.length, 4);
assert.deepEqual(complete.downloads.slice(0, 3).map(download => download.url.split('/').at(-1)), names);
assert.equal(complete.downloads[3].url, 'extension-042');

const partial = project();
syncVideoCatch(partial, [release('0.6.0', ['VideoCatch-v0.6.0-Windows-x64.zip', 'VideoCatch-v0.6.0-macOS-arm64.zip'])], helpers);
assert.equal(partial.version, '0.6.0');
assert.equal(partial.downloads.find(download => download.channel === 'mac-x86_64').url, 'mac-intel-tag');
assert.match(partial.downloads.find(download => download.channel === 'mac-arm64').label, /0\.6\.0/);

const excluded = project();
syncVideoCatch(excluded, [release('0.9.0', ['VideoCatch-v0.9.0-Windows-x64.zip'], {draft: true}),
  release('0.8.0', ['VideoCatch-v0.8.0-Windows-x64.zip'], {prerelease: true}),
  release('0.7.0-dev.1', ['VideoCatch-v0.7.0-dev.1-Windows-x64.zip']),
  release('0.6.0', ['VideoCatch-v0.5.0-Windows-x64.zip', 'VideoCatch-v0.6.0-Source.zip']),
  release('0.4.2', ['VideoCatch-v0.4.2-Windows-x64.zip'])], helpers);
assert.deepEqual(excluded, project());

const invalid = project();
syncVideoCatch(invalid, [release('0.5.0', [], {assets: [asset(names[0], {size: 0}), asset(names[1], {state: 'starter'}), asset(names[2], {browser_download_url: 'https://example.com/binary.zip'})]})], helpers);
assert.deepEqual(invalid, project());
const other = {...project(), id: 'yingxu'};
const before = structuredClone(other);
syncVideoCatch(other, [release('0.5.0', names)], helpers);
assert.deepEqual(other, before);
console.log('PASS VideoCatch native asset links, partial architectures, history, preview/source exclusions and product isolation');
