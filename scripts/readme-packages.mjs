// Public package names can change while repository IDs and historical links stay stable.
const packageNames = {'ai-hub': ['AI-Hub'], frameweave: ['PrismCanvas', 'FrameWeave']};
export const hasReadmePackages = repo => Object.hasOwn(packageNames, repo);
export function applyReadmePackage(project, published, compare) {
  if (!published || compare(published.version, project.version) < 0) return false;
  const changed = published.version !== project.version || project.status === '候选版';
  project.version = published.version;
  project.status = '已发布';
  project.downloads = [{label: `Windows ${project.version} ZIP`, url: published.url}];
  if (changed) {
    project.date = null;
    project.update = `${project.version} 已提供下载，完整改动见项目说明。`;
  }
  return true;
}
export function findReadmePackage(repo, text) {
  const names = packageNames[repo];
  if (!names) return null;
  const pattern = new RegExp(`https://raw\\.githubusercontent\\.com/(?:NOXEVYR|turnsolesama)/${repo}/main/releases/(?:${names.join('|')})-v(\\d+\\.\\d+\\.\\d+)-Windows-x64\\.zip(?=$|[\\s)"'<>])`, 'g');
  const matches = [...text.matchAll(pattern)].map(match => ({url: match[0], version: match[1]}));
  matches.sort((a, b) => {
    const x = a.version.split('.').map(Number), y = b.version.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i];
    return Number(b.url.includes('/NOXEVYR/')) - Number(a.url.includes('/NOXEVYR/'));
  });
  const latest = matches[0];
  // Historical READMEs retain the old account name after the repository migration.
  return latest ? {...latest, url: latest.url.replace('raw.githubusercontent.com/turnsolesama/', 'raw.githubusercontent.com/NOXEVYR/')} : null;
}
