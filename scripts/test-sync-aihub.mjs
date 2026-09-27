import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {syncAIHubCandidate} from './sync-aihub.mjs';
import {findReadmePackage, applyReadmePackage} from './readme-packages.mjs';

const fixture = {
  schema: 'ai-hub-update-v1', app: 'ai-hub', channel: 'candidate', version: '2.13.0',
  commit: '6e51ff359b41391b7a4ce450eea7d049637053e3',
  notes: '新增能力中心，完善工作区引导。',
};
const bytes = Buffer.from('synthetic AI Hub Windows package for deterministic sync tests');
const digest = value => createHash('sha256').update(value).digest('hex');
const compare = (a, b) => {
  const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return 0;
};
const feedFor = (value = bytes, overrides = {}) => ({
  ...structuredClone(fixture),
  ...overrides,
  package: {bytes: value.length, sha256: digest(value), ...overrides.package},
});
const manifestFor = feed => ({
  version: feed.version,
  packages: [
    {name: `AI-Hub-v${feed.version}-Source.zip`, bytes: 100, sha256: 'a'.repeat(64), files: 5, kind: 'Source'},
    {name: `AI-Hub-v${feed.version}-Windows-x64.zip`, bytes: feed.package.bytes,
      sha256: feed.package.sha256, files: 163, kind: 'Windows-x64'},
  ],
});
const project = (version = '2.6.0') => ({
  id: 'ai-hub', version, status: '已发布', sync: 'manual', date: '2026-09-11',
  update: '原稳定版更新说明', details: '根目录维护的产品介绍', features: ['根目录维护的功能'],
  icon: 'assets/icons/ai-hub-current.png', downloads: [
    {label: `Windows ${version} ZIP`, url: `https://raw.githubusercontent.com/NOXEVYR/ai-hub/main/releases/AI-Hub-v${version}-Windows-x64.zip`},
    {label: '其他下载', url: 'https://example.test/other.zip', channel: 'other'},
  ],
});
const harness = ({feed = feedFor(), manifest, packageBytes = bytes, readBytesError, readCommit} = {}) => {
  const calls = [];
  return {
    calls,
    options: {
      compare,
      readCommit: readCommit ?? (async commit => ({committer: {date: '2026-09-26T19:42:53Z', commit}})),
      readJson: async (path, ref) => {
        calls.push(['json', path, ref]);
        if (path === 'updates/candidate.json') return feed;
        if (ref === 'main') return manifestFor(feedFor(bytes, {version: path.match(/v(\d+\.\d+\.\d+)/)[1]}));
        return manifest ?? manifestFor(feed);
      },
      readBytes: async (path, ref, maxBytes) => {
        calls.push(['bytes', path, ref, maxBytes]);
        if (readBytesError) throw readBytesError;
        return packageBytes;
      },
    },
  };
};

const original = project();
const {calls, options} = harness();
const result = await syncAIHubCandidate(original, options);
assert.deepEqual(result, {channel: 'candidate', version: fixture.version, commit: fixture.commit,
  sha256: digest(bytes), bytes: bytes.length, applied: true});
assert.equal(original.version, fixture.version);
assert.equal(original.status, '候选版');
assert.equal(original.sync, 'candidate');
assert.equal(original.downloads[0].label, `曜核 ${fixture.version} · Windows`);
assert.equal(original.downloads[0].channel, 'candidate');
assert.equal(original.downloads[0].url,
  `https://raw.githubusercontent.com/NOXEVYR/ai-hub/${fixture.commit}/releases/AI-Hub-v${fixture.version}-Windows-x64.zip`);
assert.equal(original.downloads.length, 2);
assert.equal(original.downloads[1].channel, 'other');
assert.equal(original.downloads.some(d => d.url.includes('v2.6.0')), false, 'obsolete AI Hub is not a recommended alternative to current 曜核');
assert.equal(original.update, fixture.notes);
assert.equal(original.documentationUrl, `https://github.com/NOXEVYR/ai-hub/blob/${fixture.commit}/README.md`);
assert.equal(original.releaseNotesUrl, original.documentationUrl);
assert.equal(original.sourceUrl, `https://github.com/NOXEVYR/ai-hub/tree/${fixture.commit}`);
assert.match(original.downloadNote, /原 AI Hub/);
assert.match(original.downloadNote, /候选更新通道/);
assert.match(original.downloadNote, /历史存档/);
assert.equal(original.date, '2026-09-26');
assert.equal(original.details, '根目录维护的产品介绍');
assert.deepEqual(original.features, ['根目录维护的功能']);
assert.equal(original.icon, 'assets/icons/ai-hub-current.png');
assert.deepEqual(calls, [
  ['json', 'updates/candidate.json', 'feat/aihub-collaboration-2.7.0'],
  ['json', `releases/AI-Hub-v${fixture.version}-release.json`, fixture.commit],
  ['bytes', `releases/AI-Hub-v${fixture.version}-Windows-x64.zip`, fixture.commit, bytes.length + 1],
]);

const failWithoutMutation = async (subject, setup, expected) => {
  const before = structuredClone(subject);
  await assert.rejects(() => syncAIHubCandidate(subject, setup.options), expected);
  assert.deepEqual(subject, before);
};

for (const bad of [
  feedFor(bytes, {schema: 'wrong'}),
  feedFor(bytes, {app: 'another-app'}),
  feedFor(bytes, {channel: 'stable'}),
  feedFor(bytes, {version: '2.13.0-rc.1'}),
  feedFor(bytes, {version: '02.13.0'}),
  feedFor(bytes, {commit: '1234'}),
  feedFor(bytes, {package: {bytes: 0}}),
  feedFor(bytes, {package: {bytes: 50 * 1024 * 1024 + 1}}),
  feedFor(bytes, {package: {sha256: 'f'.repeat(64)}}),
]) {
  const subject = project();
  await failWithoutMutation(subject, harness({feed: bad}), /candidate|version|package/i);
}

const manifestMismatch = manifestFor(feedFor());
manifestMismatch.packages.find(item => item.kind === 'Windows-x64').sha256 = 'f'.repeat(64);
await failWithoutMutation(project(), harness({manifest: manifestMismatch}), /metadata/);
await failWithoutMutation(project(), harness({packageBytes: Buffer.from('truncated')}), /size mismatch/);
await failWithoutMutation(project(), harness({readBytesError: new Error('package missing')}), /package missing/);

const semantic = project('2.9.0');
assert.equal((await syncAIHubCandidate(semantic, harness().options)).applied, true);
assert.equal(semantic.version, '2.13.0', '2.13.0 must compare newer than 2.9.0');

const future = project('2.14.0');
future.status = '预览版';
future.downloads[0].channel = 'stable';
const futureBefore = structuredClone(future);
const olderResult = await syncAIHubCandidate(future, harness().options);
assert.equal(olderResult.applied, false);
assert.deepEqual(future, futureBefore, 'an older candidate must not downgrade a newer catalog version');

const same = project();
await syncAIHubCandidate(same, harness().options);
const first = structuredClone(same);
assert.equal((await syncAIHubCandidate(same, harness().options)).applied, true);
assert.deepEqual(same, first, 'repeated candidate sync must be idempotent');

const promoted = structuredClone(same);
promoted.status = '已发布';
promoted.downloads.unshift({label: 'Windows 2.13.0', url: 'https://github.com/NOXEVYR/ai-hub/releases/tag/v2.13.0', channel: 'stable'});
const promotedResult = await syncAIHubCandidate(promoted, harness().options);
assert.equal(promotedResult.applied, false);
assert.equal(promoted.status, '已发布');
assert.equal(promoted.sync, 'stable');
assert.equal(promoted.downloads[0].channel, 'stable');
assert.equal(promoted.downloads.some(download => download.channel === 'candidate'), false);
assert.equal('documentationUrl' in promoted, false);
assert.equal('sourceUrl' in promoted, false);
assert.equal('releaseNotesUrl' in promoted, false);
assert.equal('downloadNote' in promoted, false);
assert.equal(promoted.update, fixture.notes);
assert.equal(promoted.details, same.details);
assert.deepEqual(promoted.features, same.features);
assert.equal(promoted.icon, same.icon);

// Exercise the same README -> candidate sequence used by sync.mjs.
for (const version of ['2.13.0', '2.14.0']) {
  const subject = structuredClone(same);
  const url = `https://raw.githubusercontent.com/NOXEVYR/ai-hub/main/releases/AI-Hub-v${version}-Windows-x64.zip`;
  const published = findReadmePackage('ai-hub', `[Windows](${url})`);
  assert.equal(applyReadmePackage(subject, published, compare), true);
  assert.equal((await syncAIHubCandidate(subject, harness().options)).applied, false);
  assert.equal(subject.version, version);
  assert.equal(subject.status, '已发布');
  assert.equal(subject.sync, 'stable');
  assert.equal(subject.date, null, 'do not retain the candidate package date for a stable README package');
  assert.deepEqual(subject.downloads, [{label: `Windows ${version} ZIP`, url}]);
  for (const key of ['documentationUrl', 'sourceUrl', 'releaseNotesUrl', 'downloadNote']) assert.equal(key in subject, false);
  assert.equal(subject.update, `${version} 已提供下载，完整改动见项目说明。`);
}
const oldStable = structuredClone(same);
assert.equal(applyReadmePackage(oldStable, {version: '2.6.0', url: 'https://example.test/old.zip'}, compare), false);
assert.deepEqual(oldStable, same, 'an older main package must not replace the current candidate');

const missingMain = structuredClone(same);
applyReadmePackage(missingMain, {version: fixture.version,
  url: `https://raw.githubusercontent.com/NOXEVYR/ai-hub/main/releases/AI-Hub-v${fixture.version}-Windows-x64.zip`}, compare);
for (const invalid of ['missing', 'corrupt']) {
  const setup = harness();
  const validRead = setup.options.readBytes;
  setup.options.readBytes = async (path, ref, max) => {
    if (ref !== 'main') return validRead(path, ref, max);
    if (invalid === 'missing') throw new Error('main package missing');
    return Buffer.from('corrupt main package');
  };
  await failWithoutMutation(structuredClone(missingMain), setup, /main package/);
}

const unrelated = {...project(), id: 'yingxu'};
const unrelatedBefore = structuredClone(unrelated);
assert.equal(await syncAIHubCandidate(unrelated, {}), null);
assert.deepEqual(unrelated, unrelatedBefore);

console.log('PASS AI Hub candidate feed validation, pinned Windows package integrity, version ordering, promotion cleanup, history, and product isolation');
