import {escapeHtml as esc, external, hasStatus, projectLinks, projectIcon, projectImages as imageRecords, imageDimensions, projectCard as baseCard, updateList, validCatalog} from './catalog-render.js';

export function initializeCatalog(data, document, window) {
 if(!validCatalog(data))return false;
 const required=['#project-grid','#search','#project-dialog','#empty','#result-summary','#reset-search','#close-dialog','#dialog-category','#dialog-content','#update-list','#checked-at','#year','#collection-toolbar','#catalog-status'];
 if(required.some(selector=>!document.querySelector(selector)))return false;
 const {projects,checkedAt}=data;
 const {location,history}=window;
 const dialogNode=document.querySelector('#project-dialog');
 if(typeof dialogNode.showModal!=='function'||typeof dialogNode.close!=='function'||!dialogNode.querySelector('.dialog-panel'))return false;
const grid=document.querySelector('#project-grid');
const builtIds=new Set([...grid.querySelectorAll('[data-project]')].map(node=>node.dataset.project));
if(builtIds.size&&(builtIds.size!==projects.length||projects.some(p=>!builtIds.has(p.id))))return false;
const search=document.querySelector('#search');
const dialog=document.querySelector('#project-dialog');
let activeFilter='all';let lastFocus=null;let previousHash='#projects';
const pageTitle=document.title;const panel=dialog.querySelector('.dialog-panel');let ownedHistory=false;
function projectImages(p){
 const images=imageRecords(p);
 if(!images.length)return '';
 const choices=images.length>1?`<div class="preview-choices" role="group" aria-label="选择${esc(p.name)}预览">${images.map((image,index)=>`<button type="button" data-preview-index="${index}" aria-pressed="${index===0}">${esc(image.label||`预览 ${index+1}`)}</button>`).join('')}</div>`:'';
 return `<section class="project-gallery" aria-label="${esc(p.name)}${p.category==='play'?'角色':'界面'}预览">${choices}${images.map((image,index)=>{
  const version=image.kind==='character'||p.imageKind==='character'?null:image.version||p.previewVersion;
  const original=image.originalSrc||image.src;
  const versionNote=version?`<span class="preview-version">v${esc(version)}${version!==p.version?' · 历史界面':''}</span>`:'';
  return `<figure class="project-preview" ${index?'hidden':''}><a href="${esc(original)}" ${external} aria-label="查看${esc(p.name)}：${esc(image.caption)}原图"><img class="dialog-image" src="${esc(image.src)}" alt="${esc(p.name)} · ${esc(image.caption)}" ${imageDimensions(image.width,image.height)} loading="${index?'lazy':'eager'}" decoding="async"></a><figcaption class="image-note">${versionNote}${esc(image.caption)} <a class="preview-original" href="${esc(original)}" ${external}>查看原图 ↗</a></figcaption></figure>`;
 }).join('')}</section>`;
}
dialog.addEventListener('click',event=>{
 const button=event.target.closest('[data-preview-index]');if(!button)return;
 const gallery=button.closest('.project-gallery'),index=Number(button.dataset.previewIndex);
 gallery.querySelectorAll('.project-preview').forEach((figure,i)=>{figure.hidden=i!==index});
 gallery.querySelectorAll('[data-preview-index]').forEach((choice,i)=>choice.setAttribute('aria-pressed',String(i===index)));
});
const card=p=>baseCard(p,{gallery:document.body.classList.contains('theme-gallery')});
function render(){const q=search.value.trim().toLocaleLowerCase();const filtered=projects.filter(p=>(activeFilter==='all'||p.category===activeFilter)&&[p.name,p.english,...(p.aliases||[]),p.description,p.label,p.platform,p.version,...p.features].join(' ').toLocaleLowerCase().includes(q));grid.innerHTML=filtered.map(card).join('');document.querySelector('#empty').hidden=filtered.length>0;document.querySelector('#result-summary').textContent=`找到 ${filtered.length} 个作品`;document.querySelectorAll('[data-filter]').forEach(b=>{const active=b.dataset.filter===activeFilter;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active))})}
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{activeFilter=b.dataset.filter;render()}));search.addEventListener('input',render);document.querySelector('#reset-search').addEventListener('click',()=>{activeFilter='all';search.value='';render();search.focus()});
function showProject(id){const p=projects.find(p=>p.id===id);if(!p||typeof dialog.showModal!=='function')return false;document.querySelector('#dialog-category').textContent=p.label;document.querySelector('#dialog-content').innerHTML=`<div class="dialog-title-row">${projectIcon(p,'eager')}<div><h2 id="dialog-title">${esc(p.name)}</h2><p class="dialog-subtitle">${esc(p.english)} · v${esc(p.version)}${hasStatus(p)?' · '+esc(p.status):''}</p></div></div><p class="dialog-description">${esc(p.details)}</p>${projectImages(p)}<ul class="feature-list">${p.features.map(f=>`<li>${esc(f)}</li>`).join('')}</ul><div class="requirements"><h3>运行要求与当前范围</h3><p>${esc(p.requirements)}</p></div>${p.downloads.length ? `<div class="download-actions">${p.downloads.map((d,i)=>`<a class="button ${i===0?'primary':''}" href="${esc(d.url)}" ${external}>${esc(d.label)} <span aria-hidden="true">↗</span></a>`).join('')}</div>` : ''}<p class="download-note">${esc(p.downloadNote||'下载与发布说明来自项目 GitHub；试用版请先阅读平台说明。')}</p><div class="dialog-links">${projectLinks(p)}</div>`;if(!dialog.open){document.dispatchEvent(new window.Event('portfolio:project-opening'));lastFocus=document.activeElement;dialog.showModal()}panel.scrollTop=0;document.title=`${p.name} — NOXEVYR`;return true;}
function currentProjectId(){return location.hash.startsWith('#project/')?location.hash.slice(9):null}
function openProject(id){
 if(!projects.some(p=>p.id===id)||typeof dialog.showModal!=='function')return false;
 const wasOpen=dialog.open;
 try{if(!showProject(id))return false}catch{return false}
 if(!wasOpen){previousHash=location.hash||'';history.pushState({portfolioDetail:true},'',`#project/${id}`);ownedHistory=true}
 else history.replaceState({portfolioDetail:true},'',`#project/${id}`);
 return true;
}
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-project]');if(!b||e.defaultPrevented||e.button>0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
 if(openProject(b.dataset.project))e.preventDefault();
});
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
// Prepare both fragments before touching the static directory.
const cards=projects.map(card).join(''), updates=updateList(projects);
grid.innerHTML=cards;document.querySelector('#update-list').innerHTML=updates;
document.querySelector('#result-summary').textContent=`找到 ${projects.length} 个作品`;
document.querySelector('#checked-at').textContent=`项目资料核对于 ${checkedAt}`;
document.querySelector('#year').textContent=new Date().getFullYear();
document.querySelector('#catalog-status').hidden=true;
document.querySelector('#collection-toolbar').hidden=false;
restoreLocation();
return true;
}

// data.js is a deferred classic script; wait for its turn even if the module arrived first.
if(typeof window!=='undefined'&&typeof document!=='undefined'){
 const start=()=>{try{initializeCatalog(window.PORTFOLIO,document,window)}catch{ /* Keep the basic directory and recovery links. */ }};
 if(document.readyState==='complete')start();
 else document.addEventListener('DOMContentLoaded',start,{once:true});
}
