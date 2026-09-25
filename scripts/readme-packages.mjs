// Public package names can change while repository IDs and historical links stay stable.
const packageNames = {'ai-hub': ['AI-Hub'], frameweave: ['PrismCanvas', 'FrameWeave']};
export const hasReadmePackages = repo => Object.hasOwn(packageNames, repo);
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
  return matches[0] || null;
}
