import {createHash} from 'node:crypto';

const FEED_BRANCH = 'feat/aihub-collaboration-2.7.0';
const FEED_PATH = 'updates/candidate.json';
const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
const CANDIDATE_DOWNLOAD_NOTE = '曜核是原 AI Hub 优化改名后的当前版本，此下载使用候选更新通道；旧版本仅作历史存档。';
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validPackage = value => isRecord(value) && Number.isSafeInteger(value.bytes) &&
  value.bytes > 0 && value.bytes <= MAX_PACKAGE_BYTES &&
  typeof value.sha256 === 'string' && SHA256_PATTERN.test(value.sha256);
const candidateUrl = value => typeof value === 'string' &&
  /(?:raw\.githubusercontent\.com|github\.com)\/NOXEVYR\/ai-hub\/(?:blob|tree)\/[0-9a-f]{40}(?:\/|$)/i.test(value);

function validateFeed(feed) {
  if (!isRecord(feed) || feed.schema !== 'ai-hub-update-v1' || feed.app !== 'ai-hub' || feed.channel !== 'candidate') {
    throw new Error('AI Hub candidate feed has an unsupported schema, app, or channel');
  }
  if (typeof feed.version !== 'string' || !VERSION_PATTERN.test(feed.version)) {
    throw new Error('AI Hub candidate version must be numeric stable semver');
  }
  if (typeof feed.commit !== 'string' || !COMMIT_PATTERN.test(feed.commit)) {
    throw new Error('AI Hub candidate commit must be a 40-character Git commit');
  }
  if (!validPackage(feed.package)) {
    throw new Error('AI Hub candidate package must have a bounded positive size and SHA-256');
  }
  if (typeof feed.notes !== 'string' || !feed.notes.trim() || feed.notes.length > 1000) {
    throw new Error('AI Hub candidate notes must be a non-empty string of at most 1000 characters');
  }
  return feed;
}

function validateManifest(manifest, feed, packageName) {
  if (!isRecord(manifest) || manifest.version !== feed.version || !Array.isArray(manifest.packages)) {
    throw new Error('AI Hub release manifest does not match the candidate version');
  }
  const windows = manifest.packages.filter(item => isRecord(item) && item.kind === 'Windows-x64');
  if (windows.length !== 1) throw new Error('AI Hub release manifest must contain exactly one Windows-x64 package');
  const entry = windows[0];
  if (entry.name !== packageName || entry.bytes !== feed.package.bytes ||
      typeof entry.sha256 !== 'string' || entry.sha256.toLowerCase() !== feed.package.sha256.toLowerCase()) {
    throw new Error('AI Hub Windows-x64 package metadata does not match the candidate feed');
  }
  return entry;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function dateFromCommit(commit) {
  const value = commit?.committer?.date ?? commit?.commit?.committer?.date;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString().slice(0, 10);
}

function candidateMetadataPresent(project) {
  return project.sync === 'candidate' || project.downloads?.some(download =>
    download?.channel === 'candidate' || /候选版/.test(download?.label ?? '')) ||
    ['documentationUrl', 'sourceUrl', 'releaseNotesUrl'].some(key => candidateUrl(project[key])) ||
    project.downloadNote === CANDIDATE_DOWNLOAD_NOTE;
}

function clearCandidateMetadata(project) {
  project.downloads = (project.downloads ?? []).filter(download =>
    download?.channel !== 'candidate' && !/候选版/.test(download?.label ?? ''));
  for (const key of ['documentationUrl', 'sourceUrl', 'releaseNotesUrl']) {
    if (candidateUrl(project[key])) delete project[key];
  }
  if (project.downloadNote === CANDIDATE_DOWNLOAD_NOTE) delete project.downloadNote;
  project.sync = 'stable';
}

/**
 * Sync the one configured AI Hub candidate feed after stable release sync.
 * I/O is injected so the module is deterministic in tests and has no network globals.
 */
export async function syncAIHubCandidate(project, {readJson, readBytes, compare, readCommit} = {}) {
  if (project?.id !== 'ai-hub') return null;
  if (typeof readJson !== 'function' || typeof readBytes !== 'function' || typeof compare !== 'function') {
    throw new TypeError('readJson, readBytes, and compare callbacks are required');
  }

  const feed = validateFeed(await readJson(FEED_PATH, FEED_BRANCH));
  const packageName = `AI-Hub-v${feed.version}-Windows-x64.zip`;
  const manifestPath = `releases/AI-Hub-v${feed.version}-release.json`;
  const manifest = await readJson(manifestPath, feed.commit);
  validateManifest(manifest, feed, packageName);

  const packagePath = `releases/${packageName}`;
  const bytes = await readBytes(packagePath, feed.commit, feed.package.bytes + 1);
  if (!Buffer.isBuffer(bytes) || bytes.length !== feed.package.bytes) {
    throw new Error(`AI Hub candidate package size mismatch: expected ${feed.package.bytes} bytes`);
  }
  const actualHash = sha256(bytes);
  if (actualHash !== feed.package.sha256.toLowerCase()) {
    throw new Error('AI Hub candidate package SHA-256 mismatch');
  }

  if (typeof project.version !== 'string' || !VERSION_PATTERN.test(project.version)) {
    throw new Error('AI Hub catalog version must be numeric stable semver');
  }
  const order = compare(feed.version, project.version);
  if (!Number.isFinite(order)) throw new Error('AI Hub version comparator returned an invalid result');
  const provenance = {channel: 'candidate', version: feed.version, commit: feed.commit,
    sha256: actualHash, bytes: bytes.length, applied: false};

  if (project.status === '已发布' && order <= 0) {
    // A README link alone does not prove its replacement package exists or is intact.
    const mainName = `AI-Hub-v${project.version}-Windows-x64.zip`;
    if (project.downloads?.[0]?.url === `https://raw.githubusercontent.com/NOXEVYR/ai-hub/main/releases/${mainName}`) {
      const mainManifest = await readJson(`releases/AI-Hub-v${project.version}-release.json`, 'main');
      const mainPackage = mainManifest?.packages?.find(item => item?.kind === 'Windows-x64');
      if (!validPackage(mainPackage)) throw new Error('AI Hub main package must have a bounded size and SHA-256');
      validateManifest(mainManifest, {version: project.version, package: mainPackage}, mainName);
      const mainBytes = await readBytes(`releases/${mainName}`, 'main', mainPackage.bytes + 1);
      if (!Buffer.isBuffer(mainBytes) || mainBytes.length !== mainPackage.bytes ||
          sha256(mainBytes) !== mainPackage.sha256.toLowerCase()) {
        throw new Error('AI Hub main package size or SHA-256 mismatch');
      }
    }
    if (candidateMetadataPresent(project)) clearCandidateMetadata(project);
    return provenance;
  }
  if (order < 0) return provenance;

  // 曜核 is the current AI Hub product. Superseded Windows packages stay in repository history,
  // not alongside the current download as a supposedly more reliable alternative.
  const extras = (project.downloads ?? []).filter(download =>
    download?.channel && !['candidate', 'stable', 'windows'].includes(download.channel));
  const commitData = typeof readCommit === 'function' ? await readCommit(feed.commit) : null;
  const readmeUrl = `https://github.com/NOXEVYR/ai-hub/blob/${feed.commit}/README.md`;

  project.version = feed.version;
  project.status = '候选版';
  project.sync = 'candidate';
  project.downloads = [
    {label: `曜核 ${feed.version} · Windows`,
      url: `https://raw.githubusercontent.com/NOXEVYR/ai-hub/${feed.commit}/releases/${packageName}`,
      channel: 'candidate'},
    ...extras,
  ];
  project.documentationUrl = readmeUrl;
  project.sourceUrl = `https://github.com/NOXEVYR/ai-hub/tree/${feed.commit}`;
  project.releaseNotesUrl = readmeUrl;
  project.downloadNote = CANDIDATE_DOWNLOAD_NOTE;
  project.update = feed.notes.trim();
  project.date = dateFromCommit(commitData);
  provenance.applied = true;
  return provenance;
}
