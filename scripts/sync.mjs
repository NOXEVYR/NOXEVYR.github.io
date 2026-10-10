import {readFile,writeFile} from 'node:fs/promises';
import {findReadmePackage, hasReadmePackages, applyReadmePackage} from './readme-packages.mjs';
import {syncVideoCatch} from './sync-videocatch.mjs';
import {syncEnvAnchor} from './sync-envanchor.mjs';
import {syncAIHubCandidate} from './sync-aihub.mjs';
import {syncYingXu} from './sync-yingxu.mjs';
import {syncPublishedProjects} from './sync-policy.mjs';
const path=new URL('../content/projects.json',import.meta.url);
const data=JSON.parse(await readFile(path,'utf8'));
const headers={'User-Agent':'noxevyr-personal-site','Accept':'application/vnd.github+json'};
if(process.env.GITHUB_TOKEN)headers.Authorization=`Bearer ${process.env.GITHUB_TOKEN}`;
const version=tag=>tag.match(/(?:^|v)(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)/)?.[1];
const compare=(a,b)=>{
 const [ac,ap]=a.split('-',2),[bc,bp]=b.split('-',2);const aa=ac.split('.').map(Number),bb=bc.split('.').map(Number);
 for(let i=0;i<3;i++)if(aa[i]!==bb[i])return aa[i]-bb[i];
 if(ap===bp)return 0;if(!ap)return 1;if(!bp)return -1;
 const x=ap.split('.'),y=bp.split('.');
 for(let i=0;i<Math.max(x.length,y.length);i++){
  if(x[i]===y[i])continue;if(x[i]===undefined)return -1;if(y[i]===undefined)return 1;
  const xn=/^\d+$/.test(x[i]),yn=/^\d+$/.test(y[i]);
  if(xn&&yn)return Number(x[i])-Number(y[i]);if(xn!==yn)return xn?-1:1;return x[i].localeCompare(y[i]);
 }return 0;
};
async function releases(repo){const list=[];for(let page=1;page<=10;page++){const r=await fetch(`https://api.github.com/repos/NOXEVYR/${repo}/releases?per_page=100&page=${page}`,{headers,signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`${repo}: GitHub HTTP ${r.status}`);list.push(...await r.json());if(!r.headers.get('link')?.includes('rel="next"'))return list}throw Error(`${repo}: pagination exceeded safety limit`)}
function summary(r){const lines=(r.body||'').split(/\r?\n/);const bullet=lines.find(l=>/^[-*] /.test(l)&&!l.includes(']('));return (bullet||`${r.name||r.tag_name} 已发布，查看完整更新与平台说明。`).replace(/^[-*] /,'').replace(/[*`#]/g,'').slice(0,150)}
// Only real downloadable binary releases qualify. Migration navigation and Source code archives never do.
const preview=r=>r.prerelease||Boolean(version(r.tag_name)?.includes('-'));
function windows(r){return !r.draft&&r.assets?.some(a=>/\.(zip|exe|msi)$/i.test(a.name)&&!/(source|extension|full[-_ ]?project|macos|darwin|linux|appimage|arm64)/i.test(a.name))}
async function aiHubJson(path,ref){
 const r=await fetch(`https://api.github.com/repos/NOXEVYR/ai-hub/contents/${path}?ref=${encodeURIComponent(ref)}`,{headers,signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error(`ai-hub ${path}: GitHub HTTP ${r.status}`);
 const doc=await r.json();if(doc.encoding!=='base64')throw Error(`ai-hub ${path}: expected a JSON file`);
 return JSON.parse(Buffer.from(doc.content,'base64').toString('utf8'));
}
async function aiHubBytes(path,ref,maxBytes){
 const r=await fetch(`https://raw.githubusercontent.com/NOXEVYR/ai-hub/${ref}/${path}`,{signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error(`ai-hub package: HTTP ${r.status}`);
 if(Number(r.headers.get('content-length'))>maxBytes){await r.body.cancel();throw Error('ai-hub package exceeds its declared size')}
 const reader=r.body.getReader(),chunks=[];let bytes=0;
 while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>maxBytes){await reader.cancel();throw Error('ai-hub package exceeds its declared size')}chunks.push(value)}
 return Buffer.concat(chunks,bytes);
}
async function aiHubCommit(ref){
 const r=await fetch(`https://api.github.com/repos/NOXEVYR/ai-hub/git/commits/${ref}`,{headers,signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error(`ai-hub package commit: GitHub HTTP ${r.status}`);
 return r.json();
}
let failed=false;
await syncPublishedProjects(data.projects,async p=>{try{
 const all=await releases(p.id);
 if(p.id==='yingxu'){
  syncYingXu(p,all,{version,compare,preview,summary});
  console.log(`${p.id}: ${p.version}`);
  return;
 }
 if(p.id==='video-catch'){
  syncVideoCatch(p,all,{version,compare,summary});
  console.log(`${p.id}: ${p.version}`);
  return;
 }
 if(p.id==='env-anchor'){
  syncEnvAnchor(p,all,{version,compare,windows,preview,summary});
  console.log(`${p.id}: ${p.version}`);
  return;
 }
 const eligible=all.filter(r=>windows(r)&&version(r.tag_name)&&(!preview(r)||p.id==='classicdesk')).sort((a,b)=>compare(version(b.tag_name),version(a.tag_name))||b.published_at.localeCompare(a.published_at));
 const newest=eligible[0];
 if(newest&&compare(version(newest.tag_name),p.version)>=0){
  const v=version(newest.tag_name);const changed=v!==p.version||p.status==='候选版';
  p.version=v;p.date=newest.published_at.slice(0,10);p.status=preview(newest)?'预览版':'已发布';
  const extras=p.downloads.filter(d=>(d.channel&&!['stable','windows','preview'].includes(d.channel))||/扩展|extension/i.test(d.label));
  const extension=newest.assets?.find(a=>/extension.*\.zip$/i.test(a.name));
  if(extension){
   const old=extras.findIndex(d=>d.channel==='extension'||/扩展|extension/i.test(d.label));
   if(old>=0)extras.splice(old,1);
   extras.push({label:`Chrome / Edge 扩展 ${v}`,url:extension.browser_download_url,channel:'extension'});
  }
  p.downloads=[{label:`Windows ${v}`,url:newest.html_url,channel:preview(newest)?'preview':'stable'},...extras];
  if(changed)p.update=summary(newest);
 }
 if(['yingxu','proxy-switch'].includes(p.id)){
  const mac=all.filter(r=>!r.draft&&r.assets?.some(a=>/macOS.*\.(zip|dmg)$/i.test(a.name))).sort((a,b)=>b.published_at.localeCompare(a.published_at))[0];
  if(mac)p.downloads=[...p.downloads.filter(d=>d.channel!=='mac'),{label:`macOS ${version(mac.tag_name)||mac.tag_name} ${p.id==='proxy-switch'?'测试版':'试用版'}`,url:mac.html_url,channel:'mac'}];
 }
 // Some projects publish packages in their repository instead of attaching a new Release.
 if(hasReadmePackages(p.id)){
  const r=await fetch(`https://api.github.com/repos/NOXEVYR/${p.id}/contents/README.md`,{headers,signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error(`${p.id} README HTTP ${r.status}`);
  const doc=await r.json();if(doc.encoding!=='base64')throw Error(`${p.id}: unsupported README encoding`);
  const text=Buffer.from(doc.content,'base64').toString('utf8');
  const published=findReadmePackage(p.id,text);
  applyReadmePackage(p,published,compare);
 }
 if(p.id==='ai-hub')await syncAIHubCandidate(p,{readJson:aiHubJson,readBytes:aiHubBytes,readCommit:aiHubCommit,compare});
 console.log(`${p.id}: ${p.version}`);
}catch(e){failed=true;console.error(e.message)}});
if(failed){console.error('Sync incomplete: preserved the previous catalog; deployment must not publish partial data.');process.exitCode=1}else{data.checkedAt=new Date().toISOString().slice(0,10);await writeFile(path,JSON.stringify(data,null,2)+'\n');console.log('Catalog refreshed; no remote repository was modified.')}
if(!failed)await import('./sync-icons.mjs');
