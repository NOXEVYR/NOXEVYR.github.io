// CPU-only DOM doubles: no browser, canvas, server, or GPU process.
import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validCatalog, projectCard, projectImages, updateList, escapeHtml} from '../public/catalog-render.js';
import {initializeCatalog} from '../public/app.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(await readFile(resolve(root, 'content/projects.json'), 'utf8'));
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
class Node {
  constructor() { this.innerHTML = 'built-in links'; this.hidden = false; this.value = ''; this.listeners = {}; this.dataset = {}; this.classList = {toggle(){}}; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  emit(type, event = {}) { for (const fn of this.listeners[type] || []) fn(event); }
  setAttribute() {}
  focus() {}
}
function fixture() {
  const nodes = new Map(['project-grid','search','project-dialog','empty','result-summary','reset-search','close-dialog','dialog-category','dialog-content','update-list','checked-at','year','collection-toolbar','catalog-status'].map(id => [`#${id}`, new Node()]));
  nodes.get('#collection-toolbar').hidden = true;
  nodes.get('#project-grid').querySelectorAll = () => data.projects.map(p => ({dataset:{project:p.id}}));
  const dialog = nodes.get('#project-dialog'); dialog.open = false;
  dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; };
  const panel = new Node(); dialog.querySelector = selector => selector === '.dialog-panel' ? panel : null;
  const document = new Node(); document.querySelector = selector => nodes.get(selector) || null;
  document.querySelectorAll = () => []; document.body={classList:{contains:()=>false}}; document.title = 'NOXEVYR'; document.dispatchEvent = () => {};
  const window = new Node(); window.location = {hash:'#projects',pathname:'/',search:''}; window.Event = class {};
  window.history = {state:null,pushState(state,_title,url){this.state=state;window.location.hash=url},replaceState(state,_title,url){this.state=state;window.location.hash=url},back(){window.location.hash='#projects'}};
  return {nodes, document, window, dialog};
}
check('shared renderer provides every download and source without JavaScript', () => {
  assert.equal(validCatalog(data), true);
  for (const p of data.projects) {
    const card = projectCard(p, {fallback: true});
    assert.match(card, /<details class="card-footer catalog-fallback">/);
    assert.ok(!/<details[^>]*\bopen\b/.test(card), 'fallback downloads start collapsed');
    assert.ok(card.includes(`>v${escapeHtml(p.version)}</span>`), `${p.id}: card must preserve the full published version`);
    assert.ok(card.includes(`data-project="${p.id}"`));
    assert.ok(card.includes(`href="${escapeHtml(p.sourceUrl || `https://github.com/NOXEVYR/${p.id}`)}"`));
    for (const d of p.downloads) assert.ok(card.includes(`href="${escapeHtml(d.url)}"`));
  }
  assert.equal((updateList(data.projects).match(/class="update-row"/g) || []).length, 4);
});
check('missing, partial, empty, duplicate, and invalid data preserve static content', () => {
  const invalid = [undefined, {}, {checkedAt:data.checkedAt,projects:[]}, {...data,projects:[...data.projects,data.projects[0]]}, {...data,projects:data.projects.slice(1)}];
  const partial = structuredClone(data); delete partial.projects[0].features; invalid.push(partial);
  const unsafe = structuredClone(data); unsafe.projects[0].downloads[0].url = 'javascript:alert(1)'; invalid.push(unsafe);
  for (const broken of invalid) {
    const f = fixture(); assert.equal(initializeCatalog(broken,f.document,f.window),false);
    assert.equal(f.nodes.get('#project-grid').innerHTML,'built-in links');
    assert.equal(f.nodes.get('#update-list').innerHTML,'built-in links');
    assert.equal(f.nodes.get('#catalog-status').hidden,false);
    assert.equal(f.nodes.get('#collection-toolbar').hidden,true);
  }
});
check('missing DOM or unsupported dialog leaves links and recovery state usable', () => {
  for (const issue of ['missing','dialog']) {
    const f = fixture(); if(issue==='missing')f.nodes.delete('#search');else f.dialog.showModal=undefined;
    assert.equal(initializeCatalog(data,f.document,f.window),false);
    assert.equal(f.nodes.get('#project-grid').innerHTML,'built-in links');
    assert.equal(f.nodes.get('#collection-toolbar').hidden,true);
  }
});
check('complete data enables filtering and resets empty search results', () => {
  const f = fixture(); assert.equal(initializeCatalog(data,f.document,f.window),true);
  assert.ok(!f.nodes.get('#project-grid').innerHTML.includes('download-actions'), 'enhanced cards leave platform downloads in details');
  assert.ok(!f.nodes.get('#project-grid').innerHTML.includes('<details'), 'enhanced cards have one footer action');
  assert.equal(f.nodes.get('#catalog-status').hidden,true); assert.equal(f.nodes.get('#collection-toolbar').hidden,false);
  const search=f.nodes.get('#search'); search.value='AI Hub'; search.emit('input');
  assert.ok(f.nodes.get('#project-grid').innerHTML.includes('data-project="ai-hub"'));
  assert.equal((f.nodes.get('#project-grid').innerHTML.match(/<article /g)||[]).length,1);
  search.value='nonexistent-project'; search.emit('input'); assert.equal(f.nodes.get('#empty').hidden,false);
  f.nodes.get('#reset-search').emit('click'); assert.equal((f.nodes.get('#project-grid').innerHTML.match(/<article /g)||[]).length,data.projects.length);
});
check('ordinary detail clicks prevent navigation and preserve gallery provenance', () => {
  const f=fixture(); initializeCatalog(data,f.document,f.window); let prevented=false;
  const link={dataset:{project:'michelle-pet'}};
  f.document.emit('click',{target:{closest:()=>link},button:0,preventDefault(){prevented=true}});
  assert.equal(prevented,true); assert.equal(f.dialog.open,true); assert.equal(f.window.location.hash,'#project/michelle-pet');
  const markup=f.nodes.get('#dialog-content').innerHTML;
  assert.ok(markup.includes('src="assets/michelle-display.webp"')); assert.ok(markup.includes('href="assets/michelle.png"'));
  assert.ok(markup.includes('width="1145" height="1374"')); assert.ok(markup.includes('非当前应用运行截图'));
  assert.ok(!markup.includes('preview-version'));
  f.nodes.get('#close-dialog').emit('click'); assert.equal(f.dialog.open,false); assert.equal(f.document.title,'NOXEVYR');
});
check('every platform and extension download remains available inside project details', () => {
  for (const p of data.projects) {
    const f=fixture(); initializeCatalog(data,f.document,f.window);
    f.document.emit('click',{target:{closest:()=>({dataset:{project:p.id}})},button:0,preventDefault(){}});
    assert.equal(f.dialog.open,true);
    const detail=f.nodes.get('#dialog-content').innerHTML;
    for(const d of p.downloads)assert.ok(detail.includes(`href="${escapeHtml(d.url)}"`), `${p.id}: missing ${d.label}`);
  }
});
check('modified or middle clicks retain native link behavior', () => {
  for(const modifiers of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}]){
    const f=fixture();initializeCatalog(data,f.document,f.window);let prevented=false;
    f.document.emit('click',{target:{closest:()=>({dataset:{project:'yingxu'}})},button:0,preventDefault(){prevented=true},...modifiers});
    assert.equal(prevented,false);assert.equal(f.dialog.open,false);assert.equal(f.window.location.hash,'#projects');
  }
});
check('failed detail opening retains anchor navigation', () => {
  const f=fixture();initializeCatalog(data,f.document,f.window); f.dialog.showModal=()=>{throw Error('Unavailable dialog')};let prevented=false;
  f.document.emit('click',{target:{closest:()=>({dataset:{project:'yingxu'}})},button:0,preventDefault(){prevented=true}});
  assert.equal(prevented,false);assert.equal(f.window.location.hash,'#projects');
});
check('markup escapes public text and fallback images carry recorded dimensions', () => {
  const p=structuredClone(data.projects[0]);p.name='<script>"&';assert.ok(!projectCard(p).includes('<script>'));
  const pet=data.projects.find(p=>p.id==='michelle-pet');const image=projectImages(pet)[0];
  assert.equal(image.originalSrc,'assets/michelle.png');assert.equal(image.width,1145);assert.equal(image.height,1374);
});
for(const state of ['interactive','complete','missing-data']) {
  const f=fixture(); f.document.readyState=state==='complete'?'complete':'interactive';
  if(state==='complete')f.window.PORTFOLIO=data;
  globalThis.document=f.document;globalThis.window=f.window;
  try {
    await import(`../public/app.js?startup-test=${state}`);
    if(state!=='complete') {
      assert.equal(f.nodes.get('#project-grid').innerHTML,'built-in links');
      if(state==='interactive')f.window.PORTFOLIO=data;
      f.document.emit('DOMContentLoaded');
    }
    check(`module startup: ${state} respects data-script completion`,()=>{
      assert.equal(f.nodes.get('#collection-toolbar').hidden,state==='missing-data');
      assert.equal(f.nodes.get('#catalog-status').hidden,state!=='missing-data');
      if(state==='missing-data')assert.equal(f.nodes.get('#project-grid').innerHTML,'built-in links');
      else assert.equal((f.nodes.get('#project-grid').innerHTML.match(/<article /g)||[]).length,data.projects.length);
    });
  } finally {delete globalThis.document;delete globalThis.window;}
}
// Passing --built checks an already generated artifact; it never builds or serves it.
if(process.argv.includes('--built')) {
  for(const directory of ['dist','dist-production']) {
    const output=resolve(root,directory), html=await readFile(resolve(output,'index.html'),'utf8');
    const app=await readFile(resolve(output,'app.js'),'utf8');
    check(`${directory}: nonempty static directory, updates, recovery, and resolved templates`,()=>{
      assert.ok(!/\{\{[^}]+\}\}/.test(html));
      assert.equal((html.match(/<article class="project-card /g)||[]).length,data.projects.length);
      assert.equal((html.match(/<details class="card-footer catalog-fallback">/g)||[]).length,data.projects.length);
      assert.equal((html.match(/class="update-row"/g)||[]).length,4);
      assert.ok(/id="collection-toolbar"[^>]*\bhidden/.test(html));
      assert.ok(/id="catalog-status"(?![^>]*\bhidden)[^>]*>/.test(html));
      for(const p of data.projects)for(const d of p.downloads)assert.ok(html.includes(`href="${escapeHtml(d.url)}"`));
      const version=html.match(/src="app\.js\?v=([a-f0-9]+)"/)[1];
      assert.ok(app.includes(`'./catalog-render.js?v=${version}'`));
    });
    for(const match of html.matchAll(/(?:src|href)="(assets\/[^"?#]+)(?:[?#][^"]*)?"/g))assert.ok((await stat(resolve(output,match[1]))).size>0);
    for(const p of data.projects)for(const path of [p.image,p.originalSrc,...(p.screenshots||[]).flatMap(s=>[s.src,s.originalSrc])].filter(Boolean))assert.ok((await stat(resolve(output,path))).size>0);
    assert.ok((await stat(resolve(output,'catalog-render.js'))).size>0);
  }
}
console.log(`Catalog CPU checks: ${checks} passed.`);
