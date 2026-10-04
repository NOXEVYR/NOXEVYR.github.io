// Shared by the offline build and the optional browser enhancement.
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
export const external = 'target="_blank" rel="noopener noreferrer"';
export const isPreview = p => ['预览版', '候选版'].includes(p.status);
export const isPending = p => p.pending === true;
export const hasStatus = p => isPreview(p) || isPending(p);
export const localIntroduction = value => typeof value === 'string' && /^projects\/[a-z0-9]+(?:-[a-z0-9]+)*\.html$/.test(value);
export const linkAttributes = url => localIntroduction(url) ? '' : external;
const text = value => typeof value === 'string' && value.trim().length > 0;
const asset = value => typeof value === 'string' && /^assets\/[\w./-]+$/.test(value) && !value.split('/').includes('..');
const https = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };

// Incomplete or mismatched data must never replace the built-in directory.
export function validCatalog(data) {
  if (!data || !text(data.checkedAt) || !Array.isArray(data.projects) || !data.projects.length) return false;
  const ids = new Set();
  return data.projects.every(p => {
    if (!p || !/^[a-z0-9-]+$/.test(p.id) || ids.has(p.id)) return false;
    ids.add(p.id);
    return ['creative', 'tools', 'play'].includes(p.category)
      && ['name', 'english', 'label', 'version', 'status', 'description', 'details', 'platform', 'requirements'].every(key => text(p[key]))
      && asset(p.icon) && (!p.image || asset(p.image)) && (!p.originalSrc || asset(p.originalSrc))
      && Array.isArray(p.features) && p.features.every(text)
      && (!p.aliases || (Array.isArray(p.aliases) && p.aliases.every(text)))
      && (p.pending === undefined || typeof p.pending === 'boolean')
      && (p.introductionUrl === undefined || (localIntroduction(p.introductionUrl) && p.introductionUrl === `projects/${p.id}.html`))
      && (!p.introductionUrl || (p.introduction && text(p.introduction.eyebrow) && text(p.introduction.previewNote)
        && Array.isArray(p.introduction.sections) && p.introduction.sections.length > 0 && p.introduction.sections.every(s => s && text(s.title) && text(s.body))
        && Array.isArray(p.introduction.notes) && p.introduction.notes.length > 0 && p.introduction.notes.every(text)))
      && Array.isArray(p.downloads) && (isPending(p)
        ? ['开发中', '待发布'].includes(p.status) && p.downloads.length === 0 && localIntroduction(p.introductionUrl) && text(p.downloadNote)
        : p.downloads.length > 0) && p.downloads.every(d => d && text(d.label) && https(d.url))
      && ['sourceUrl', 'documentationUrl', 'releaseNotesUrl'].every(key => !p[key] || https(p[key]))
      && (!p.screenshots || (Array.isArray(p.screenshots) && p.screenshots.every(s => s && asset(s.src) && (!s.originalSrc || asset(s.originalSrc)) && text(s.caption))))
      && (!p.date || (typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date)));
  });
}

export function imageDimensions(width, height) {
  return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0 ? `width="${width}" height="${height}"` : '';
}
export function projectImages(p) {
  return p.screenshots?.length ? p.screenshots : p.image ? [{src: p.image, originalSrc: p.originalSrc, caption: p.imageNote, width: p.imageWidth, height: p.imageHeight, kind: p.imageKind}] : [];
}
export function projectIcon(p, loading = 'lazy') {
  return `<span class="project-icon software-icon icon-${escapeHtml(p.id)}"><img src="${escapeHtml(p.icon)}" alt="${escapeHtml(p.name)}图标" width="44" height="44" loading="${loading}" decoding="async"></span>`;
}
export function sourceLink(p) { return p.sourceUrl || (isPending(p) ? '' : `https://github.com/NOXEVYR/${p.id}`); }
export function projectTarget(p) { return p.introductionUrl || sourceLink(p); }
export function projectLinks(p) {
  const links = isPending(p)
    ? [[p.introductionUrl, '独立介绍页'], [p.documentationUrl, '使用说明'], [p.sourceUrl, '源码']]
    : [[p.documentationUrl || `https://github.com/NOXEVYR/${p.id}#readme`, '使用说明'], [p.sourceUrl || `https://github.com/NOXEVYR/${p.id}`, '源码'], [`https://github.com/NOXEVYR/${p.id}/issues`, '反馈问题']];
  return links.filter(([url]) => url).map(([url, label]) => `<a href="${escapeHtml(url)}" ${linkAttributes(url)}>${label} ↗</a>`).join('');
}
export function projectCard(p, {gallery = false, fallback = false} = {}) {
  const esc = escapeHtml, url = projectTarget(p);
  const platform = `<span class="platform">${esc(p.platform)}</span>`;
  const footer = fallback
    ? p.introductionUrl
      ? `<div class="card-footer catalog-pending">${platform}<a class="detail-button" href="${esc(url)}" data-project="${esc(p.id)}" aria-label="查看${esc(p.name)}介绍">查看介绍 ↗</a></div>`
      : `<details class="card-footer catalog-fallback"><summary aria-label="${esc(p.name)}下载与源码">${platform}<span class="detail-button" aria-hidden="true"></span></summary><div class="download-actions catalog-downloads">${p.downloads.map(d => `<a class="button" href="${esc(d.url)}" ${external}>${esc(d.label)} ↗</a>`).join('')}<a class="text-link" href="${esc(url)}" ${external}>源码 ↗</a></div></details>`
    : `<div class="card-footer">${platform}<a class="detail-button" href="${esc(url)}" data-project="${esc(p.id)}" aria-label="查看${esc(p.name)}项目">查看项目 ↗</a></div>`;
  const cover = gallery ? `<button class="gallery-cover ${p.image ? '' : 'icon-cover'}" data-project="${esc(p.id)}" data-cover="${esc(p.id)}" aria-label="查看${esc(p.name)}作品封面与详情"><img src="${esc(p.image || p.icon)}" alt="${esc(p.image ? p.name + ' · ' + p.imageNote : p.name + '应用图标')}" ${p.image ? imageDimensions(p.imageWidth, p.imageHeight) : 'width="44" height="44"'} loading="lazy" decoding="async"></button>` : '';
  return `<article class="project-card ${p.category === 'play' ? 'pet-card' : ''}${p.introductionUrl ? ' introduction-project' : ''}">${cover}<div class="card-top">${projectIcon(p)}<span class="card-category">${esc(p.label)}</span><span class="card-version ${hasStatus(p) ? 'preview-status' : ''}">v${esc(p.version)}</span></div><h3 style="margin:0"><a class="card-title" href="${esc(url)}" data-project="${esc(p.id)}">${esc(p.name)}</a>${hasStatus(p) ? `<span class="status-label">${esc(p.status)}</span>` : ''}</h3><div class="card-english">${esc(p.english)}</div><p class="card-description">${esc(p.description)}</p>${p.category === 'play' && p.image ? `<img class="pet-image" loading="lazy" decoding="async" src="${esc(p.image)}" alt="${esc(p.name)} · ${esc(p.imageNote)}" ${imageDimensions(p.imageWidth, p.imageHeight)}>` : ''}${footer}</article>`;
}
// Repository-hosted packages may have an obsolete migration entry on Releases.
export function updateLink(p) {
  if (isPending(p)) return p.introductionUrl;
  if (p.releaseNotesUrl) return p.releaseNotesUrl;
  const url = p.downloads[0]?.url;
  return url?.startsWith('https://github.com/') && url.includes('/releases/tag/') ? url : `${sourceLink(p)}#readme`;
}
export function updateList(projects) {
  const esc = escapeHtml;
  return [...projects].filter(p => p.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4).map(p => `<a class="update-row" href="${esc(updateLink(p))}" ${linkAttributes(updateLink(p))}><time class="update-date" datetime="${esc(p.date)}">${esc(p.date.replaceAll('-', '.'))}</time><div><h3>${esc(p.name)} <span>v${esc(p.version)}${hasStatus(p) ? ' · ' + esc(p.status) : ''}</span></h3><p>${esc(p.update)}</p></div><span class="update-arrow" aria-hidden="true">↗</span></a>`).join('');
}
