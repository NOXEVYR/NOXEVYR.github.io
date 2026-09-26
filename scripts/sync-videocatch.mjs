// VideoCatch has three independently published native packages. Only this product
// uses this policy; the other catalog projects retain their existing selection.
export function syncVideoCatch(project, releases, {version, compare, summary}) {
  if (project.id !== 'video-catch') return;
  const baseline = project.version;
  const stable = releases.filter(release => {
    const v = version(release.tag_name);
    return v && !v.includes('-') && !release.draft && !release.prerelease && release.published_at;
  }).sort((a, b) => compare(version(b.tag_name), version(a.tag_name)) || b.published_at.localeCompare(a.published_at));
  const assetFor = (release, pattern) => release.assets?.find(asset => {
    const match = asset.name.match(pattern);
    return match && match[1] === version(release.tag_name) && asset.size > 0 &&
      (!asset.state || asset.state === 'uploaded') &&
      asset.browser_download_url?.startsWith('https://github.com/NOXEVYR/video-catch/releases/download/');
  });
  const candidates = pattern => stable.map(release => ({release, asset: assetFor(release, pattern)})).filter(entry => entry.asset);
  const windows = candidates(/^VideoCatch-v(\d+\.\d+\.\d+)-Windows-x64\.zip$/i)
    .find(entry => compare(version(entry.release.tag_name), baseline) >= 0);
  if (windows) {
    const {release, asset} = windows;
    const v = version(release.tag_name);
    if (v !== project.version) project.update = summary(release);
    project.version = v;
    project.date = release.published_at.slice(0, 10);
    project.status = '已发布';
    project.downloads = [{label: `Windows ${v} ZIP`, url: asset.browser_download_url, channel: 'stable'},
      ...project.downloads.filter(download => (download.channel && !['stable', 'windows'].includes(download.channel)) || /扩展|extension/i.test(download.label))];
    const extension = assetFor(release, /^VideoCatch-Extension-v(\d+\.\d+\.\d+)\.zip$/i);
    if (extension) {
      // Package release numbers need not equal the browser manifest's version.
      project.downloads = project.downloads.filter(download => download.channel !== 'extension' && !/扩展|extension/i.test(download.label));
      project.downloads.push({label: 'Chrome / Edge 扩展', url: extension.browser_download_url, channel: 'extension'});
    }
  }
  for (const arch of ['arm64', 'x86_64']) {
    const channel = `mac-${arch}`;
    const previous = project.downloads.find(download => download.channel === channel);
    const current = previous?.label.match(/\d+\.\d+\.\d+/)?.[0] || baseline;
    const pattern = new RegExp(`^VideoCatch-v(\\d+\\.\\d+\\.\\d+)-macOS-${arch}\\.zip$`, 'i');
    const selected = candidates(pattern).find(entry => compare(version(entry.release.tag_name), current) >= 0);
    if (!selected) continue; // Keep the reviewed link if an architecture is absent in the newer release.
    const v = version(selected.release.tag_name);
    project.downloads = project.downloads.filter(download => download.channel !== channel && download.channel !== 'mac');
    const extensionIndex = project.downloads.findIndex(download => download.channel === 'extension');
    project.downloads.splice(extensionIndex < 0 ? project.downloads.length : extensionIndex, 0, {
      label: `macOS ${v} · ${arch === 'arm64' ? 'Apple Silicon' : 'Intel'} ZIP`,
      url: selected.asset.browser_download_url, channel,
    });
  }
}
