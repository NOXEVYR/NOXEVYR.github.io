// Dependency-free CPU/DOM checks; this never launches a browser or a GPU.
import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validCatalog, projectCard, projectLinks, sourceLink, projectTarget, updateLink, updateList, localIntroduction} from '../public/catalog-render.js';
import {initializeCatalog} from '../public/app.js';
import {projectIntroduction} from './project-introduction.mjs';
import {syncPublishedProjects} from './sync-policy.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(await readFile(resolve(root, 'content/projects.json'), 'utf8'));
const published = data.projects.find(p => p.id === 'casecontrol');
const pending = {...structuredClone(published), pending: true, status: '待发布', downloads: [], downloadNote: '开发中，尚未发布下载。'};
for (const key of ['sourceUrl','documentationUrl','releaseNotesUrl']) delete pending[key];
const pendingData = {...data, projects: data.projects.map(p => p.id === pending.id ? pending : p)};
let checks = 0;
function check(name, test) { test(); checks++; console.log(`PASS ${name}`); }
function changed(change) { const copy = structuredClone(pendingData); change(copy.projects.find(p => p.id === pending.id)); return copy; }
check('only explicitly pending projects may have no downloads', () => {
  assert.ok(validCatalog(pendingData)); assert.equal(pending.pending, true); assert.deepEqual(pending.downloads, []);
  for (const change of [p => delete p.pending, p => p.pending = false, p => p.pending = 'true', p => p.status = '已发布', p => delete p.introductionUrl, p => delete p.downloadNote, p => delete p.introduction, p => p.downloads.push({label:'fake release',url:'https://github.com/example/release'})]) assert.equal(validCatalog(changed(change)), false);
  const regular = structuredClone(data); regular.projects.find(p => !p.pending).downloads = [];
  assert.equal(validCatalog(regular), false);
});
check('introduction paths reject traversal, protocols, queries and fragments', () => {
  for (const path of ['../projects/casecontrol.html','projects/../casecontrol.html','/projects/casecontrol.html','//evil.example/a.html','https://evil.example/a.html','javascript:alert(1)','projects/%2e%2e/a.html','projects\\casecontrol.html','projects/casecontrol.html?x=1','projects/casecontrol.html#section','projects/casecontrol.html/','projects/CaseControl.html','projects/casecontrol.svg','',null,0]) {
    assert.equal(localIntroduction(path), false, String(path));
    assert.equal(validCatalog(changed(p => p.introductionUrl = path)), false, String(path));
  }
  assert.ok(localIntroduction('projects/casecontrol.html'));
  assert.equal(validCatalog(changed(p => p.introductionUrl = 'projects/another-project.html')), false);
});
check('published projects keep source and release targets distinct from introduction', () => {
  assert.ok(validCatalog(data)); assert.equal(projectTarget(published), published.introductionUrl);
  assert.equal(sourceLink(published), published.sourceUrl); assert.equal(updateLink(published), published.releaseNotesUrl);
  const fallback = projectCard(published,{fallback:true}); assert.ok(fallback.includes(`href="${published.introductionUrl}"`));
  const ordinary = {...published}; delete ordinary.introductionUrl;
  assert.ok(projectCard(ordinary,{fallback:true}).includes(`href="${published.sourceUrl}"`));
  const withoutReleaseNotes = {...published, downloads:[{label:'Windows',url:'https://github.com/example/project/releases/download/v1/program.zip'}]}; delete withoutReleaseNotes.releaseNotesUrl;
  assert.equal(updateLink(withoutReleaseNotes), `${published.sourceUrl}#readme`);
  assert.ok(projectIntroduction(published).includes(published.downloads[0].url));
});
const fetched = [];
const before = structuredClone(pending);
await syncPublishedProjects(pendingData.projects, async p => { fetched.push(p.id); });
check('release sync does not invoke network work for pending projects', () => {
  assert.ok(!fetched.includes(pending.id)); assert.equal(fetched.length, data.projects.length - 1); assert.deepEqual(pending, before);
});
check('card, fallback, links and updates never invent repository URLs', () => {
  assert.equal(sourceLink(pending), ''); assert.equal(projectTarget(pending), pending.introductionUrl); assert.equal(updateLink(pending), pending.introductionUrl);
  for (const markup of [projectCard(pending), projectCard(pending,{fallback:true}), projectLinks(pending), updateList([pending])]) {
    assert.ok(markup.includes(`href="${pending.introductionUrl}"`)); assert.ok(!markup.includes('github.com')); assert.ok(!markup.includes('download-actions'));
  }
  const fallback = projectCard(pending,{fallback:true}); assert.ok(fallback.includes('v0.2.0')); assert.ok(fallback.includes('待发布')); assert.ok(!fallback.includes('<details'));
});
check('introduction uses catalog text, complete captions, and escaped content', () => {
  const html = projectIntroduction(pending);
  for (const text of [pending.details,pending.downloadNote,pending.requirements,pending.introduction.previewNote,...pending.introduction.sections.flatMap(s=>[s.title,s.body]),...pending.introduction.notes]) assert.ok(html.includes(text));
  assert.equal((html.match(/<figure>/g)||[]).length,4); assert.ok(html.includes('<details class="gallery">')); assert.ok(html.includes('../index.html#projects'));
  for (const shot of pending.screenshots) assert.ok(html.includes(shot.caption));
  assert.ok(!/<script|<canvas|github\.com/.test(html));
  const malicious = structuredClone(pending); malicious.details = '<script>alert("x")</script>';
  assert.ok(projectIntroduction(malicious).includes('&lt;script&gt;')); assert.ok(!projectIntroduction(malicious).includes('<script>'));
});
class Node {
  constructor() { this.listeners={}; this.dataset={}; this.classList={contains:()=>false,toggle(){}}; this.value=''; }
  addEventListener(type,fn) {(this.listeners[type]??=[]).push(fn);} emit(type,event={}) {for(const fn of this.listeners[type]||[])fn(event);}
  setAttribute() {} focus() {}
}
check('actual dialog presents pending status and one real introduction link', () => {
  const ids=['project-grid','search','project-dialog','empty','result-summary','reset-search','close-dialog','dialog-category','dialog-content','update-list','checked-at','year','collection-toolbar','catalog-status'];
  const nodes=new Map(ids.map(id=>['#'+id,new Node()])); const dialog=nodes.get('#project-dialog');
  dialog.showModal=()=>{dialog.open=true}; dialog.close=()=>{dialog.open=false}; dialog.querySelector=()=>new Node();
  nodes.get('#project-grid').querySelectorAll=()=>data.projects.map(p=>({dataset:{project:p.id}}));
  const document=new Node(); document.querySelector=s=>nodes.get(s); document.querySelectorAll=()=>[]; document.body=new Node(); document.title='NOXEVYR'; document.dispatchEvent=()=>{};
  const window=new Node(); window.location={hash:'#projects'}; window.history={pushState(){},replaceState(){}}; window.Event=class {};
  assert.ok(initializeCatalog(pendingData,document,window));
  document.emit('click',{target:{closest:()=>({dataset:{project:pending.id}})},button:0,preventDefault(){}});
  const html=nodes.get('#dialog-content').innerHTML; assert.ok(dialog.open); assert.ok(html.includes('v0.2.0 · 待发布'));
  assert.ok(html.includes(pending.downloadNote)); assert.ok(html.includes(`href="${pending.introductionUrl}"`));
  assert.ok(!html.includes('github.com')); assert.ok(!html.includes('download-actions')); assert.equal(document.title,`${pending.name} — NOXEVYR`);
});
if (process.argv.includes('--built')) {
  for (const directory of ['dist','dist-production']) {
    const output=resolve(root,directory); const page=resolve(output,published.introductionUrl); const html=await readFile(page,'utf8');
    check(`${directory}: standalone introduction generated from catalog`,()=>assert.equal(html,projectIntroduction(published)));
    for (const match of html.matchAll(/(?:src|href)="([^"#]+)(?:#[^"]*)?"/g)) {
      if (/^https:/.test(match[1])) continue;
      const path=resolve(dirname(page),match[1]); assert.ok(path.startsWith(output)); assert.ok((await stat(path)).size>0,match[1]);
    }
    
    const index=await readFile(resolve(output,'index.html'),'utf8'); assert.ok(index.includes(`href="${pending.introductionUrl}"`));
  }
}
console.log(`Pending project CPU checks: ${checks} passed.`);
