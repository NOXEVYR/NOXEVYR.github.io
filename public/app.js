const {projects,checkedAt}=window.PORTFOLIO;
const grid=document.querySelector('#project-grid');
const search=document.querySelector('#search');
const dialog=document.querySelector('#project-dialog');
let activeFilter='all';let lastFocus=null;let previousHash='#projects';
const pageTitle=document.title;const panel=dialog.querySelector('.dialog-panel');let ownedHistory=false;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const external='target="_blank" rel="noopener noreferrer"';
function projectIcon(p){return `<span class="project-icon software-icon icon-${esc(p.id)}"><img src="${esc(p.icon)}" alt="${esc(p.name)}图标" width="44" height="44"></span>`}
function galleryCover(p){if(!document.body.classList.contains('theme-gallery'))return '';const src=p.image||p.icon;return `<button class="gallery-cover ${p.image?'':'icon-cover'}" data-project="${p.id}" data-cover="${p.id}" aria-label="查看${esc(p.name)}作品封面与详情"><img src="${esc(src)}" alt="${esc(p.image?p.name+' · '+p.imageNote:p.name+'应用图标')}" loading="lazy"></button>`}
function card(p){return `<article class="project-card ${p.category==='play'?'pet-card':''}">${galleryCover(p)}<div class="card-top">${projectIcon(p)}<span class="card-category">${esc(p.label)}</span><span class="card-version ${p.status==='预览版'?'preview-status':''}">v${esc(p.version.replace('-preview',''))}</span></div><h3 style="margin:0"><button class="card-title" data-project="${p.id}">${esc(p.name)}</button>${p.status==='预览版'?'<span class="status-label">预览版</span>':''}</h3><div class="card-english">${esc(p.english)}</div><p class="card-description">${esc(p.description)}</p>${p.category==='play'?`<img class="pet-image" loading="lazy" src="${esc(p.image)}" alt="${esc(p.name)}角色形象">`:''}<div class="card-footer"><span class="platform">${esc(p.platform)}</span><button class="detail-button" data-project="${p.id}" aria-label="查看${esc(p.name)}详情">查看项目 ↗</button></div></article>`}
function render(){const q=search.value.trim().toLocaleLowerCase();const filtered=projects.filter(p=>(activeFilter==='all'||p.category===activeFilter)&&[p.name,p.english,p.description,p.label,p.platform,p.version,...p.features].join(' ').toLocaleLowerCase().includes(q));grid.innerHTML=filtered.map(card).join('');document.querySelector('#empty').hidden=filtered.length>0;document.querySelector('#result-summary').textContent=`找到 ${filtered.length} 个作品`;document.querySelectorAll('[data-filter]').forEach(b=>{const active=b.dataset.filter===activeFilter;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active))})}
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{activeFilter=b.dataset.filter;render()}));search.addEventListener('input',render);document.querySelector('#reset-search').addEventListener('click',()=>{activeFilter='all';search.value='';render();search.focus()});
function showProject(id){const p=projects.find(p=>p.id===id);if(!p)return;document.querySelector('#dialog-category').textContent=p.label;document.querySelector('#dialog-content').innerHTML=`<div class="dialog-title-row">${projectIcon(p)}<div><h2 id="dialog-title">${esc(p.name)}</h2><p class="dialog-subtitle">${esc(p.english)} · v${esc(p.version)}</p></div></div><p class="dialog-description">${esc(p.details)}</p>${p.image?`<img class="dialog-image" src="${esc(p.image)}" alt="${esc(p.name)}${esc(p.imageNote)}"><p class="image-note">${esc(p.imageNote)}</p>`:''}<ul class="feature-list">${p.features.map(f=>`<li>${esc(f)}</li>`).join('')}</ul><div class="requirements"><h3>运行要求与当前范围</h3><p>${esc(p.requirements)}</p></div><div class="download-actions">${p.downloads.map((d,i)=>`<a class="button ${i===0?'primary':''}" href="${esc(d.url)}" ${external}>${esc(d.label)} <span aria-hidden="true">↗</span></a>`).join('')}</div><p class="download-note">下载与发布说明来自项目 GitHub；试用版请先阅读平台说明。</p><div class="dialog-links"><a href="https://github.com/NOXEVYR/${p.id}#readme" ${external}>使用说明 ↗</a><a href="https://github.com/NOXEVYR/${p.id}" ${external}>源码 ↗</a><a href="https://github.com/NOXEVYR/${p.id}/issues" ${external}>反馈问题 ↗</a></div>`;if(!dialog.open){document.dispatchEvent(new Event('portfolio:project-opening'));lastFocus=document.activeElement;dialog.showModal()}panel.scrollTop=0;document.title=`${p.name} — NOXEVYR`;}
function currentProjectId(){return location.hash.startsWith('#project/')?location.hash.slice(9):null}
function openProject(id){
 if(!projects.some(p=>p.id===id))return;
 if(!dialog.open){previousHash=location.hash||'';history.pushState({portfolioDetail:true},'',`#project/${id}`);ownedHistory=true}
 else history.replaceState({portfolioDetail:true},'',`#project/${id}`);
 showProject(id);
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-project]');if(b)openProject(b.dataset.project)});
function dismissProject(){
 if(dialog.open)dialog.close();
 document.title=pageTitle;
 if(lastFocus?.isConnected&&lastFocus!==document.body)lastFocus.focus({preventScroll:true});
 lastFocus=null;
}
function closeProject(){
 const back=ownedHistory;ownedHistory=false;
 dismissProject();
 if(back)history.back();
 else if(currentProjectId())history.replaceState(null,'',location.pathname+location.search+(previousHash||'#projects'));
}
document.querySelector('#close-dialog').addEventListener('click',closeProject);
dialog.addEventListener('cancel',e=>{e.preventDefault();closeProject()});
dialog.addEventListener('keydown',e=>{
 if(e.key!=='Tab')return;
 const first=document.querySelector('#close-dialog');
 const last=dialog.querySelector('.dialog-links a:last-child');
 if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}
 else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
});
let outsideStart=false;
dialog.addEventListener('pointerdown',e=>{outsideStart=e.target===dialog});
dialog.addEventListener('click',e=>{if(e.target===dialog&&outsideStart)closeProject();outsideStart=false});
function restoreLocation(){
 const id=currentProjectId();
 if(id&&projects.some(p=>p.id===id)){ownedHistory=Boolean(history.state?.portfolioDetail);showProject(id)}
 else {ownedHistory=false;dismissProject();if(id)history.replaceState(null,'',location.pathname+location.search+'#projects')}
}
window.addEventListener('popstate',restoreLocation);
window.addEventListener('hashchange',restoreLocation);
const recent=[...projects].filter(p=>p.date).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4);
document.querySelector('#update-list').innerHTML=recent.map(p=>`<a class="update-row" href="https://github.com/NOXEVYR/${p.id}/releases" ${external}><time class="update-date" datetime="${esc(p.date)}">${esc(p.date.replaceAll('-','.'))}</time><div><h3>${esc(p.name)} <span>v${esc(p.version)}</span></h3><p>${esc(p.update)}</p></div><span class="update-arrow" aria-hidden="true">↗</span></a>`).join('');
document.querySelector('#checked-at').textContent=`项目资料核对于 ${checkedAt}`;document.querySelector('#year').textContent=new Date().getFullYear();render();restoreLocation();
