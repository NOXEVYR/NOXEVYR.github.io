// YingXu's macOS packages follow a separate review path. Keep the website's
// catalog focused on the current Windows archive until a macOS package is
// explicitly approved and added to the catalog.
export function syncYingXu(project, releases, {version, compare, preview, summary}) {
  if (project.id !== 'yingxu') return false;
  const registeredMac = project.downloads?.filter(download => download.channel === 'mac') || [];
  const macDownload = registeredMac.length === 1
    && /^macOS\s+/i.test(registeredMac[0].label || '')
    && /^https:\/\/github\.com\/NOXEVYR\/yingxu\/releases\/download\/[^/?#]+\/[^/?#]*mac[^/?#]*\.zip$/i.test(registeredMac[0].url || '')
    ? registeredMac[0]
    : null;
  const packages = releases.flatMap(release => {
    const v = version(release.tag_name);
    if (!v || release.draft || preview(release)) return [];
    const expected = `YingXu-v${v}-Windows-x64.zip`.toLowerCase();
    const asset = release.assets?.find(item => item.name?.toLowerCase() === expected
      && item.state !== 'starter'
      && /^https:\/\/github\.com\/NOXEVYR\/yingxu\/releases\/download\//i.test(item.browser_download_url || ''));
    return asset && release.html_url ? [{release, asset, version: v}] : [];
  }).sort((a, b) => compare(b.version, a.version)
    || (b.release.published_at || '').localeCompare(a.release.published_at || ''));

  const newest = packages[0];
  if (!newest || compare(newest.version, project.version) < 0) return false;

  const changed = newest.version !== project.version || project.status === '候选版';
  project.version = newest.version;
  project.date = newest.release.published_at?.slice(0, 10) || project.date;
  project.status = '已发布';
  project.downloads = [{
    label: `Windows ${newest.version} ZIP`,
    url: newest.asset.browser_download_url,
    channel: 'stable',
  }, ...(macDownload ? [macDownload] : [])];
  project.releaseNotesUrl = newest.release.html_url;
  delete project.documentationUrl;
  if (changed) project.update = summary(newest.release);
  return true;
}
