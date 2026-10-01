// EnvAnchor alone may promote a newer public preview while keeping stable as a
// backup. This uses the existing Release list and never inspects local installs.
export function syncEnvAnchor(project, releases, {version, compare, windows, preview, summary}) {
  if (project.id !== 'env-anchor') return;
  const releaseUrl = url => typeof url === 'string' && /^https:\/\/github\.com\/NOXEVYR\/env-anchor\/releases\/tag\/[^/?#]+$/.test(url);
  const candidates = releases.filter(release => {
    const v = version(release.tag_name || '');
    if (!v || !/^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)*)?$/.test(release.tag_name) ||
      release.draft || !release.published_at || !Number.isFinite(Date.parse(release.published_at)) || !releaseUrl(release.html_url)) return false;
    return release.assets?.some(asset => {
      // Both the standalone EXE and win10-portable ZIP are public Windows
      // programs; Source, extensions and other platform archives cannot qualify.
      const name = asset.name || '';
      const program = new RegExp(`^EnvAnchor[-_]v?${v.replaceAll('.', '\\.')}(?:[-_](?:win(?:dows)?(?:10|11)?|portable|x64|x86|setup|installer))*\\.(?:exe|zip|msi)$`, 'i');
      return program.test(name) && !/(source|extension|full[-_ ]?project|macos|osx|darwin|linux|appimage|android|ios)/i.test(name) &&
        asset.size > 0 && (!asset.state || asset.state === 'uploaded') &&
        asset.browser_download_url?.startsWith('https://github.com/NOXEVYR/env-anchor/releases/download/') &&
        windows({...release, assets: [asset]});
    });
  }).sort((a, b) => compare(version(b.tag_name), version(a.tag_name)) ||
    Number(Boolean(preview(a))) - Number(Boolean(preview(b))) || b.published_at.localeCompare(a.published_at));
  const newest = candidates[0];
  if (!newest || compare(version(newest.tag_name), project.version) < 0) return;
  const v = version(newest.tag_name);
  const isPreview = Boolean(preview(newest));
  // A stale API snapshot must not demote an already reviewed stable release.
  if (compare(v, project.version) === 0 && isPreview && project.status === '已发布') return;
  const status = isPreview ? '预览版' : '已发布';
  if (v !== project.version || status !== project.status) project.update = summary(newest);
  const extras = (project.downloads || []).filter(download =>
    (download.channel && !['stable', 'windows', 'preview'].includes(download.channel)) || /扩展|extension/i.test(download.label));
  const downloads = [{label: `Windows ${v}${isPreview ? ' 预览版' : ''}`, url: newest.html_url, channel: isPreview ? 'preview' : 'stable'}];
  if (isPreview) {
    const stable = candidates.find(release => !preview(release));
    let backup = stable && {v: version(stable.tag_name), url: stable.html_url};
    // A reviewed stable download may be newer than an older API snapshot.
    for (const download of project.downloads || []) {
      const old = version(download.label?.match(/\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?/)?.[0] || '');
      if (['stable', 'windows'].includes(download.channel) && old && !old.includes('-') && releaseUrl(download.url) &&
        compare(old, v) < 0 && (!backup || compare(old, backup.v) > 0)) backup = {v: old, url: download.url};
    }
    if (backup && compare(backup.v, v) < 0) downloads.push({label: `Windows ${backup.v} 稳定版（备用）`, url: backup.url, channel: 'stable'});
  }
  project.version = v;
  project.date = newest.published_at.slice(0, 10);
  project.status = status;
  project.downloads = [...downloads, ...extras].filter((download, index, list) => list.findIndex(entry => entry.url === download.url) === index);
  project.downloadNote = isPreview
    ? (downloads[1] ? '当前为功能预览版；稳定版保留为备用，请按需选择。' : '当前为功能预览版，请先备份并在独立副本上评估。')
    : '下载 Windows 程序包，更新内容与使用说明见发布页。';
}
