import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {syncYingXu} from './sync-yingxu.mjs';
import {projectCard, projectLinks} from '../public/catalog-render.js';

const helpers = {
  version: tag => tag.match(/(?:^|v)(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/)?.[1],
  compare: (a, b) => {
    const aa = a.split(/[.-]/).map(part => /^\d+$/.test(part) ? Number(part) : part);
    const bb = b.split(/[.-]/).map(part => /^\d+$/.test(part) ? Number(part) : part);
    for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
      if (aa[i] === bb[i]) continue;
      if (aa[i] === undefined) return -1;
      if (bb[i] === undefined) return 1;
      return aa[i] < bb[i] ? -1 : 1;
    }
    return 0;
  },
  preview: release => release.draft || release.prerelease || Boolean(helpers.version(release.tag_name)?.includes('-')),
  summary: release => `${release.tag_name} changes`,
};
const asset = (version, overrides = {}) => ({
  name: `YingXu-v${version}-Windows-x64.zip`,
  state: 'uploaded',
  browser_download_url: `https://github.com/NOXEVYR/yingxu/releases/download/yingxu-v${version}/YingXu-v${version}-Windows-x64.zip`,
  ...overrides,
});
const release = (version, overrides = {}) => ({
  tag_name: `yingxu-v${version}`,
  html_url: `https://github.com/NOXEVYR/yingxu/releases/tag/yingxu-v${version}`,
  published_at: '2026-10-10T09:00:00Z',
  assets: [asset(version)],
  ...overrides,
});
const project = () => ({
  id: 'yingxu', version: '0.4.31', status: '已发布', date: '2026-10-10',
  documentationUrl: 'https://github.com/NOXEVYR/yingxu/releases/tag/yingxu-v0.4.31',
  sourceUrl: 'https://github.com/NOXEVYR/yingxu/tree/main',
  downloads: [
    {label: 'Windows current', url: 'old-current', channel: 'stable'},
    {label: 'Windows historical', url: 'old-history', channel: 'previous'},
    {label: 'macOS historical', url: 'old-mac', channel: 'mac'},
  ],
});

const subject = project();
const macOnly = release('9.0.0', {assets: [{name: 'YingXu-v9.0.0-macOS-arm64.zip', browser_download_url: 'https://github.com/NOXEVYR/yingxu/releases/download/yingxu-v9.0.0/mac.zip'}]});
const releases = [
  release('0.4.28'),
  release('0.4.31'),
  release('0.4.32-rc.1', {prerelease: true}),
  release('0.4.33', {draft: true}),
  release('0.4.34', {assets: [{name: 'YingXu-v0.4.34-Source.zip', browser_download_url: 'https://github.com/NOXEVYR/yingxu/releases/download/yingxu-v0.4.34/source.zip'}]}),
  macOnly,
];
assert.equal(syncYingXu(subject, releases, helpers), true);
assert.equal(subject.version, '0.4.31');
assert.deepEqual(subject.downloads, [{
  label: 'Windows 0.4.31 ZIP',
  url: 'https://github.com/NOXEVYR/yingxu/releases/download/yingxu-v0.4.31/YingXu-v0.4.31-Windows-x64.zip',
  channel: 'stable',
}]);
assert.equal(subject.releaseNotesUrl, 'https://github.com/NOXEVYR/yingxu/releases/tag/yingxu-v0.4.31');
assert.equal('documentationUrl' in subject, false);

const reviewedMac = {
  label: 'macOS 0.4.31 · Apple Silicon ZIP',
  url: 'https://github.com/NOXEVYR/yingxu/releases/download/yingxu-v0.4.31/YingXu-v0.4.31-macOS-arm64.zip',
  channel: 'mac',
};
const withReviewedMac = project();
withReviewedMac.downloads = [
  {label: 'Windows current', url: 'old-current', channel: 'stable'},
  {label: 'Windows historical', url: 'old-history', channel: 'previous'},
  reviewedMac,
];
assert.equal(syncYingXu(withReviewedMac, releases, helpers), true);
assert.deepEqual(withReviewedMac.downloads, [
  {label: 'Windows 0.4.31 ZIP', url: asset('0.4.31').browser_download_url, channel: 'stable'},
  reviewedMac,
], 'a manually registered current Mac ZIP survives a same-version Windows sync while Windows history is removed');

const ambiguousMac = project();
ambiguousMac.downloads = [reviewedMac, {...reviewedMac, url: reviewedMac.url.replace('arm64', 'x64')}];
syncYingXu(ambiguousMac, releases, helpers);
assert.equal(ambiguousMac.downloads.some(download => download.channel === 'mac'), false,
  'ambiguous multiple Mac entries are not kept');

const newer = release('0.4.32');
assert.equal(syncYingXu(subject, [...releases, newer], helpers), true);
assert.equal(subject.version, '0.4.32');
assert.equal(subject.downloads.length, 1);
assert.equal(subject.downloads[0].url, asset('0.4.32').browser_download_url);
assert.equal(subject.releaseNotesUrl, newer.html_url);

const olderOnly = project();
const beforeOlder = structuredClone(olderOnly);
assert.equal(syncYingXu(olderOnly, [release('0.4.28'), macOnly], helpers), false);
assert.deepEqual(olderOnly, beforeOlder, 'older Windows or macOS releases must not downgrade the catalog');

const other = {...project(), id: 'proxy-switch'};
const beforeOther = structuredClone(other);
syncYingXu(other, releases, helpers);
assert.deepEqual(other, beforeOther, 'the special policy only applies to YingXu');

const catalog = JSON.parse(await readFile(new URL('../content/projects.json', import.meta.url), 'utf8'));
const displayed = catalog.projects.find(item => item.id === 'yingxu');
const expectedWindowsUrl = `https://github.com/NOXEVYR/yingxu/releases/download/yingxu-v${displayed.version}/YingXu-v${displayed.version}-Windows-x64.zip`;
const currentWindows = displayed.downloads.filter(download => download.channel === 'stable');
const currentMac = displayed.downloads.filter(download => download.channel === 'mac');
assert.deepEqual(currentWindows, [{
  label: `Windows ${displayed.version} ZIP`,
  url: expectedWindowsUrl,
  channel: 'stable',
}]);
assert.ok(currentMac.length <= 1, 'at most one reviewed Mac download may be listed');
for (const download of currentMac) {
  assert.match(download.label, /^macOS\s+/i);
  assert.match(download.url, /^https:\/\/github\.com\/NOXEVYR\/yingxu\/releases\/download\/[^/?#]+\/[^/?#]*mac[^/?#]*\.zip$/i);
}
assert.equal(displayed.downloads.length, currentWindows.length + currentMac.length,
  'only the current Windows ZIP and an optional reviewed Mac ZIP may be listed');
assert.equal(displayed.downloads.some(download => download.channel === 'previous' || /历史/i.test(download.label)), false,
  'historical Windows downloads must stay off the catalog');
assert.equal(displayed.releaseNotesUrl, `https://github.com/NOXEVYR/yingxu/releases/tag/yingxu-v${displayed.version}`);
const detailLinks = projectLinks(displayed);
assert.equal((detailLinks.match(/<a\b/g) || []).length, 1);
assert.match(detailLinks, /发布说明/);
const fallbackCard = projectCard(displayed, {fallback: true});
assert.doesNotMatch(fallbackCard, /源码|历史/);
assert.equal((fallbackCard.match(/class="button(?:\s|\")/g) || []).length, displayed.downloads.length,
  'the static card exposes exactly the registered current downloads');

console.log('PASS YingXu current Windows ZIP, reviewed Mac ZIP preservation, release notes, and no historical/automatic Mac links or sync downgrade');
