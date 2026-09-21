// CPU workload estimate of the current shader, not a GPU timing benchmark.
// Compares r^5 multiplication plus a conservative distant-plane fast path.
// Matches the shipped |y| > 2 gate without any precise endpoint correction.
// The optimized path also skips volume when its camera-uniform weight is zero.
// This models the current ray equations; it does not execute GPU shader code.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/blackhole.js',import.meta.url),'utf8').replace(/\s+/g,'');
for(const formula of [
 'if(abs(p.y)>2.)return0.;',
 'smoothstep(3.4,10.,r)*(.05*sin(angle*5.+r*.8)+.015*sin(angle*11.-r*1.5))',
 'float edgeOn=1.-smoothstep(.02,.09,abs(forward.y));',
 'for(int i=0;i<420;i++)',
 'clamp((r-1.)*.075,.025,1.25)',
 'mix(stepLength,min(stepLength,.18),nearDisc*radialBand)',
 '(-1.5*h2/(r2*r2*r))*p',
 '(-1.5*h2/(safeRadius2*safeRadius2*safeRadius))*next',
 'if(edgeOn>0.){vec3 middle=(p+next)*.5;',
 'float height=.014+.0025*(cr-3.);',
 'float span=abs(nextPlaneDistance-planeDistance);',
])assert.ok(source.includes(formula.replace(/\s+/g,'')),`Shader equation changed; update CPU model: ${formula}`);
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const mul=(a,s)=>a.map(v=>v*s);
const norm=a=>Math.hypot(...a);
const normalize=a=>mul(a,1/norm(a));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const erf=x=>{const x2=x*x;return Math.sign(x)*Math.sqrt(Math.max(0,1-Math.exp(-x2*(1.2732395+.147*x2)/(1+.147*x2))));};
function discHeight(p){const r=Math.hypot(p[0],p[2]),a=Math.atan2(p[2],p[0]+.00001);return smooth(3.4,10,r)*(.05*Math.sin(a*5+r*.8)+.015*Math.sin(a*11-r*1.5));}
function trace(eye, initial, optimized=false){
 let p=[...eye],ray=[...initial],r=norm(p),h2=norm(cross(p,ray))**2;
 const edgeOn=1-smooth(.02,.09,Math.abs(eye[1]/r));
 const acceleration=(v,rad)=>{const r2=rad*rad;return mul(v,-1.5*h2/(optimized?r2*r2*rad:rad**5));};
 let trueHeightCalls=0;
 const preciseHeight=q=>{trueHeightCalls++;return discHeight(q);};
 const height=q=>optimized&&Math.abs(q[1])>2?0:preciseHeight(q);
 let acc=acceleration(p,r),plane=p[1]-height(p),hits=[];
 let steps=0,heightCalls=1,volumeCandidates=0,nearDiscSteps=0,maxDisplacement=0,escaped=false,volumeWeight=0,volumePosition=[0,0,0];
 if(Math.sqrt(h2)>16)return {early:true,steps:0,heightCalls:0,trueHeightCalls:0,volumeCandidates:0,nearDiscSteps:0,hits,escaped:true,terminal:ray,volumeWeight,volumePosition};
 for(let i=0;i<420;i++){
  if(r<1.015)break;if(r>46){escaped=true;break;}steps++;
  let ds=clamp((r-1)*.075,.025,1.25),cyl=Math.hypot(p[0],p[2]);
  const near=1-smooth(.08,.8,Math.abs(plane)),band=smooth(2.8,3.1,cyl)*(1-smooth(12.8,13.5,cyl));
  if(near*band>0)nearDiscSteps++;
  ds=ds*(1-near*band)+Math.min(ds,.18)*near*band;
  const next=add(add(p,mul(ray,ds)),mul(acc,.5*ds*ds)),nr=norm(next),na=acceleration(next,Math.max(nr,.8)),nextRay=add(ray,mul(add(acc,na),.5*ds));
  const np=next[1]-height(next);heightCalls++;
  maxDisplacement=Math.max(maxDisplacement,norm(add(next,mul(p,-1))));
  const mid=mul(add(p,next),.5),cr=Math.hypot(mid[0],mid[2]);
  const intersects=plane*np<=0&&Math.abs(plane-np)>.000001;
  const sampleVolume=(!optimized||edgeOn>0)&&cr>2.95&&cr<12.8&&Math.abs(mid[1])<.5;
  if(intersects){
   const t=clamp(plane/(plane-np),0,1),hit=add(mul(p,1-t),mul(next,t)),hr=Math.hypot(hit[0],hit[2]);
   if(hr>2.95&&hr<12.8)hits.push(hit);
  }
  if(sampleVolume){
   volumeCandidates++;const height=.014+.0025*(cr-3),span=Math.abs(np-plane);
   const vertical=span>.00001?Math.abs(erf(np/height)-erf(plane/height))*.8862269*height/span:Math.exp(-((plane/height)**2));
   if(vertical>.015){const amount=vertical*ds;volumeWeight+=amount;volumePosition=add(volumePosition,mul(mid,amount));}
  }
  p=next;ray=nextRay;r=nr;acc=na;plane=np;
 }
 return {early:false,steps,heightCalls,trueHeightCalls,volumeCandidates,nearDiscSteps,maxDisplacement,hits,escaped,terminal:ray,volumeWeight,volumePosition};
}
let cases=0,totalRays=0;
for(const distance of [11,17.5,34])for(const elevation of [.001,.075,.45,1.4]){
 const yaw=.45,eye=[Math.sin(yaw)*Math.cos(elevation)*distance,Math.sin(elevation)*distance,Math.cos(yaw)*Math.cos(elevation)*distance];
 const forward=normalize(mul(eye,-1)),right=[Math.cos(yaw),0,-Math.sin(yaw)],up=cross(right,forward);
 const edgeOn=1-smooth(.02,.09,Math.abs(forward[1]));
 const stats={distance,viewDegrees:Math.round(elevation*180/Math.PI*10)/10,rays:0,early:0,steps:0,maxSteps:0,capHits:0,heightCalls:0,heightCallsOptimized:0,volumeCandidates:0,volumeCandidatesOptimized:0,nearDiscSteps:0,hitCounts:[0,0,0,0],classificationDifferences:0,maxDirectionDelta:0,maxHitDelta:0,maxDisplacement:0,maxEffectiveVolumeWeightDelta:0,maxEffectiveVolumePositionDelta:0};
 for(let y=0;y<45;y++)for(let x=0;x<81;x++){
  const sx=((x+.5)/81-.67)*16/9,sy=((y+.5)/45-.5),ray=normalize(add(add(forward,mul(right,sx*.92)),mul(up,sy*.92)));
  const a=trace(eye,ray),b=trace(eye,ray,true);stats.rays++;stats.early+=+a.early;
  for(const k of ['steps','heightCalls','volumeCandidates','nearDiscSteps'])stats[k]+=a[k];
  stats.heightCallsOptimized+=b.trueHeightCalls;
  stats.volumeCandidatesOptimized+=b.volumeCandidates;
  stats.hitCounts[Math.min(3,a.hits.length)]++;
  stats.maxSteps=Math.max(stats.maxSteps,a.steps);stats.capHits+=+(a.steps===420);stats.maxDisplacement=Math.max(stats.maxDisplacement,a.maxDisplacement||0);
  if(a.escaped!==b.escaped||a.hits.length!==b.hits.length||a.steps!==b.steps)stats.classificationDifferences++;
  stats.maxDirectionDelta=Math.max(stats.maxDirectionDelta,...a.terminal.map((v,i)=>Math.abs(v-b.terminal[i])));
  stats.maxEffectiveVolumeWeightDelta=Math.max(stats.maxEffectiveVolumeWeightDelta,Math.abs((a.volumeWeight-b.volumeWeight)*edgeOn));
  stats.maxEffectiveVolumePositionDelta=Math.max(stats.maxEffectiveVolumePositionDelta,...a.volumePosition.map((v,i)=>Math.abs((v-b.volumePosition[i])*edgeOn)));
  if(edgeOn===0){assert.equal(b.volumeWeight,0);assert.deepEqual(b.volumePosition,[0,0,0]);assert.equal(b.volumeCandidates,0);}
  for(let n=0;n<Math.min(a.hits.length,b.hits.length);n++)stats.maxHitDelta=Math.max(stats.maxHitDelta,...a.hits[n].map((v,i)=>Math.abs(v-b.hits[n][i])));
 }
 stats.averageSteps=+(stats.steps/stats.rays).toFixed(1);
 stats.volumeContributionEnabled=edgeOn>0;
 stats.heightCallsSavedPercent=+((1-stats.heightCallsOptimized/stats.heightCalls)*100).toFixed(1);
 assert.equal(stats.classificationDifferences,0,`Ray classification changed at ${JSON.stringify({distance,elevation})}`);
 for(const key of ['maxDirectionDelta','maxHitDelta','maxEffectiveVolumeWeightDelta','maxEffectiveVolumePositionDelta'])assert.ok(Number.isFinite(stats[key])&&stats[key]<1e-8,`${key} exceeds double-precision comparison tolerance: ${stats[key]}`);
 assert.ok(stats.heightCallsOptimized<stats.heightCalls,'Far-plane gate should skip height evaluations');
 cases++;totalRays+=stats.rays;
 console.log(JSON.stringify(stats));
}
console.log(`PASS: ${cases} views, ${totalRays} rays; production 2.0 gate + r^5 multiplication + uniform volume skip preserve traced geometry and visible volume (CPU model).`);
