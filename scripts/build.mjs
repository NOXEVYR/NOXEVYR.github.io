import {readFile, mkdir, cp, writeFile, rm} from 'node:fs/promises';
const production=process.argv.includes('--production');
const data=JSON.parse(await readFile(new URL('../content/projects.json',import.meta.url),'utf8'));
const ids=new Set();
for(const p of data.projects){
 if(ids.has(p.id)) throw Error('Duplicate project'); ids.add(p.id);
 for(const d of p.downloads) {const u=new URL(d.url); if(u.protocol!=='https:' || !['github.com','raw.githubusercontent.com'].includes(u.hostname)) throw Error('Invalid download URL');}
}
const source=new URL('../public/',import.meta.url);
const root=new URL(production?'../dist-production/':'../dist/',import.meta.url);
await rm(root,{recursive:true,force:true}); await mkdir(root,{recursive:true});
if(!production)await cp(source,root,{recursive:true});
await writeFile(new URL('data.js',root),'window.PORTFOLIO = '+JSON.stringify(data).replace(/</g,'\\u003c')+';\n');
const template=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const variants=[
 {id:'classic',title:'A · 清爽工具集'},
 {id:'studio',title:'B · 深色产品工作室',headline:'认真打磨，<br>每一个<span class="highlight">想法<span class="highlight-dot">.</span></span>'},
 {id:'editorial',title:'C · 编辑式个人作品集',headline:'创作，<br>是另一种<span class="highlight">表达<span class="highlight-dot">。</span></span>'},
 {id:'gallery',title:'D · 创意画廊',headline:'想法不止<br>一种<span class="highlight">形状<span class="highlight-dot">.</span></span>'}
];
function variantHtml(v, prefix='', isHome=false){
 let html=template;
 if(v.id!=='classic')html=html.replace('<body>',`<body class="theme-${v.id}">`);
 if(!isHome)html=html.replace(/<title>.*?<\/title>/,`<title>${v.title} — turnsolesama</title>`);
 if(v.headline)html=html.replace(/<h1>.*?<\/h1>/,`<h1>${v.headline}</h1>`);
 html=html.replaceAll('href="assets/',`href="${prefix}assets/`).replaceAll('src="assets/',`src="${prefix}assets/`).replace('href="styles.css',`href="${prefix}styles.css`).replace('src="app.js',`src="${prefix}app.js`).replace('href="dialog.css',`href="${prefix}dialog.css`);
 html=html.replace('<!-- variant-theme -->',v.id==='classic'?'':`<link rel="stylesheet" href="${prefix}themes/${v.id}.css?v=1">`);
 return html.replace(/<a class="variant-switch" data-variant-link[^>]*>.*?<\/a>/,production?'':`<a class="variant-switch" data-variant-link href="${prefix}styles.html">← 风格对比 · ${isHome?'已选 C':v.title}</a>`);
}
if(!production)for(const v of variants){
 const dir=new URL(`versions/${v.id}/`,root);await mkdir(dir,{recursive:true});
 const html=variantHtml(v,'../../');
 const local=structuredClone(data);for(const p of local.projects){if(p.icon)p.icon='../../'+p.icon;if(p.image)p.image='../../'+p.image}
 await writeFile(new URL('index.html',dir),html);
 await writeFile(new URL('data.js',dir),'window.PORTFOLIO = '+JSON.stringify(local).replace(/</g,'\\u003c')+';\n');
}
const homepage=variantHtml(variants.find(v=>v.id==='editorial'),'',true);
if(production){
 // Publish only the selected design and the artwork actually used by the page/catalog.
 const files=new Set(['app.js','styles.css','dialog.css','themes/editorial.css']);
 for(const match of homepage.matchAll(/(?:src|href)="(assets\/[^"?#]+)(?:[?#][^"]*)?"/g))files.add(match[1]);
 for(const p of data.projects)for(const field of ['icon','image'])if(p[field])files.add(p[field]);
 for(const file of files){
  const from=new URL(file,source),to=new URL(file,root);
  if(!from.href.startsWith(source.href)||!to.href.startsWith(root.href))throw Error(`Asset path outside website: ${file}`);
  await mkdir(new URL('./',to),{recursive:true});
  await cp(from,to);
 }
}
await writeFile(new URL('index.html',root),homepage);
console.log(`Built ${data.projects.length} projects into ${production?'dist-production/ (C only)':'dist/ (C homepage, A/B/C/D previews preserved)'}`);
