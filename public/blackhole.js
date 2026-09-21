/* Real-time 3D ray integration. A seamless flow texture shades the 3D gas disc.
   Schwarzschild-inspired bending is an artistic approximation, not a scientific solver. */
(() => {
  const canvas = document.querySelector('#blackhole-canvas');
  const scene = document.querySelector('.hero-scene');
  const hero = document.querySelector('.hero');
  const toggle = document.querySelector('#motion-toggle');
  const explore = document.querySelector('#explore-hole');
  const readout = document.querySelector('#orbit-readout');
  const hint = document.querySelector('#orbit-hint');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const qualityButton = document.querySelector('#render-quality');
  const projectDialog = document.querySelector('#project-dialog');
  const buildQuery=new URL(document.currentScript.src).search;
  const qMultiply=(a,b)=>[
    a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
    a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
    a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
    a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
  const qNormalize=q=>{const n=Math.hypot(...q);return q.map(x=>x/n);};
  const qAxis=(x,y,z,angle)=>[x*Math.sin(angle/2),y*Math.sin(angle/2),z*Math.sin(angle/2),Math.cos(angle/2)];
  const qView=(yaw,pitch,roll=0)=>qMultiply(qMultiply(qAxis(0,1,0,yaw),qAxis(1,0,0,-pitch)),qAxis(0,0,1,roll));
  const qRotate=(q,v)=>qMultiply(qMultiply(q,[...v,0]),[-q[0],-q[1],-q[2],q[3]]).slice(0,3);
  const defaults = { rotation:qView(.45,.075,.045), distance:17.5 };
  let camera = { rotation:[...defaults.rotation],distance:defaults.distance }, paused = reduced.matches, expanded = false;
  let quality='high';
  let running = 0, ready = false, failed = false, pageActive = true, dirty = true, elapsed = 0, last = 0;
  let lastDrawAt = -Infinity;
  let savedScroll = 0, pinchDistance = 0, pinchAngle = null;
  const pointers = new Map();
  try { paused ||= localStorage.getItem('noxevyr-motion') === 'paused'; } catch {}
  try { if(localStorage.getItem('noxevyr-quality')==='ultra')quality='ultra'; } catch {}
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  function state() {
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.setAttribute('aria-label', paused ? '开启动态效果' : '暂停动态效果');
    toggle.querySelector('.motion-label').textContent = paused ? '继续流动' : '暂停流动';
    toggle.querySelector('.motion-symbol').textContent = paused ? '▷' : 'Ⅱ';
    const elevation=Math.asin(clamp(qRotate(camera.rotation,[0,0,1])[1],-1,1))*180/Math.PI;
    readout.textContent = `${Math.round(elevation)}° / ${(defaults.distance / camera.distance).toFixed(1)}×`;
    qualityButton.textContent=quality==='high'?'高清':'超清';
    qualityButton.setAttribute('aria-label',quality==='high'?'切换为超清画质':'切换为高清画质');
    qualityButton.setAttribute('aria-pressed',String(quality==='ultra'));
  }
  function fallback() {
    failed = true; ready = false; cancelAnimationFrame(running); running = 0;
    if(expanded)expand(false);
    scene.classList.remove('is-ready'); canvas.hidden = true;
    document.querySelectorAll('.orbit-controls button, #motion-toggle').forEach(button => { button.disabled = true; });
    hint.textContent = '此设备暂不支持 3D，显示静态封面';
    toggle.querySelector('.motion-label').textContent = '静态画面';
  }
  state();
  let gl;
  try { gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'high-performance' }); } catch {}
  if (!gl) { fallback(); return; }
  const maxRenderSize=Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
  const halfFloat=gl.getExtension('OES_texture_half_float');
  const gradientSampling=!!(gl.getExtension('OES_standard_derivatives')&&gl.getExtension('EXT_shader_texture_lod'));
  const renderType=halfFloat && gl.getExtension('OES_texture_half_float_linear') && gl.getExtension('EXT_color_buffer_half_float') ? halfFloat.HALF_FLOAT_OES : gl.UNSIGNED_BYTE;
  const vertex = `attribute vec2 aPosition; varying vec2 vUv;
    void main(){ vUv=aPosition*.5+.5; gl_Position=vec4(aPosition,0.,1.); }`;
  const fragment = `${gradientSampling?'#extension GL_OES_standard_derivatives : enable\n#extension GL_EXT_shader_texture_lod : enable\n':''}precision highp float;
    varying vec2 vUv;
    uniform vec2 uSize, uCenter;
    uniform vec3 uEye, uRight, uUp;
    uniform sampler2D uPlasma,uFilaments;
    uniform float uTime;
    const float PI=3.14159265359;
    float flowSample(sampler2D tex,vec2 uv,float lod){
      ${gradientSampling?`vec2 dx=dFdx(uv),dy=dFdy(uv);dx.x-=floor(dx.x+.5);dy.x-=floor(dy.x+.5);
      vec4 value=texture2DGradEXT(tex,uv,dx*exp2(lod),dy*exp2(lod));return value.r*value.a;`:`vec4 value=texture2D(tex,uv,lod);return value.r*value.a;`}
    }
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float smoothNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*f*(f*(f*6.-15.)+10.);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
    float discHeight(vec3 p){
      // The gas displacement is at most .065. Far from its plane neither a
      // crossing nor slab contribution can occur within our bounded step.
      if(abs(p.y)>2.)return 0.;
      float r=length(p.xz),angle=atan(p.z,p.x+.00001);
      // Keep the physical disc steady. Animation advects the plasma, not the plane.
      return smoothstep(3.4,10.,r)*(.05*sin(angle*5.+r*.8)+.015*sin(angle*11.-r*1.5));
    }
    float erfApprox(float x){float x2=x*x;return sign(x)*sqrt(max(0.,1.-exp(-x2*(1.2732395+.147*x2)/(1.+.147*x2))));}
    vec3 stars(vec3 d){
      vec2 sky=vec2(atan(d.z,d.x)/(2.*PI)+.5,asin(clamp(d.y,-1.,1.))/PI+.5);
      vec2 grid=sky*vec2(850.,425.);vec2 cell=floor(grid),f=fract(grid)-.5;
      float n=hash(cell);vec2 offset=vec2(hash(cell+9.2),hash(cell-5.3))*.55-.275;
      float core=exp(-dot(f-offset,f-offset)*150.);
      float glow=exp(-dot(f-offset,f-offset)*22.);
      return mix(vec3(.42,.52,.69),vec3(.95,.72,.44),hash(cell+4.))
        *(core+glow*.07)*step(.991,n)*(.18+hash(cell+1.)*.9);
    }
    vec4 matter(vec3 p,vec3 ray,float lod){
      float r=length(p.xz);
      float inner=smoothstep(2.95,3.38,r);
      float outer=1.-smoothstep(7.,12.8,r);
      float radial=(r-2.9)/10.;
      float phi=atan(p.z,p.x+.000001)/(2.*PI);
      // The periodic flow field lives in disc coordinates, never screen coordinates.
      // Uniform orbit plus bounded local drift: radial gradients must not grow
      // with elapsed time, otherwise mip filtering progressively erases strands.
      // Wrapping only the uniform integer turn is seamless for every lookup.
      float shear=fract(uTime*.01)+.045*sin(uTime*.055-r*.72);
      vec2 circle=vec2(cos((phi+shear)*2.*PI),sin((phi+shear)*2.*PI));
      float warp=(smoothNoise(circle*8.+r*.57)-.5)*.027+(smoothNoise(circle*21.+r*1.2)-.5)*.004;
      vec2 uv=vec2(phi*2.+shear,radial+warp);
      float fine=flowSample(uFilaments,uv*vec2(1.,1.7)+vec2(.29,.17),lod+.7);
      // A mirrored angular lookup closes the generated turbulence without a seam.
      vec2 turbulenceUV=vec2(1.-abs(fract(uv.x*2.)*2.-1.),uv.y);
      float turbulence=flowSample(uPlasma,turbulenceUV,lod);
      float strands=flowSample(uFilaments,uv,lod);
      float field=strands*(.7+turbulence*3.5)+fine*.12;
      float energy=(field*field*9.+field*.5+turbulence*turbulence*.9)*inner*outer;
      float heat=pow(3.15/max(r,3.15),1.2);
      vec3 ember=vec3(1.15,.25,.045);
      vec3 gold=vec3(2.2,1.04,.36);
      vec3 white=vec3(3.5,2.5,1.5);
      vec3 tint=mix(ember,gold,sqrt(heat));
      tint=mix(tint,white,pow(heat,3.)*.65);
      vec3 velocity=vec3(-p.z,0.,p.x)/max(r,.00001);
      float beaming=pow(clamp(1.-dot(-ray,velocity)*.46,.35,1.5),2.);
      return vec4(tint*energy*pow(heat,.8)*beaming,clamp(field*1.2,0.,.65)*inner*outer);
    }
    void main(){
      vec3 forward=normalize(-uEye);
      float edgeOn=1.-smoothstep(.02,.09,abs(forward.y));
      vec2 screen=(vUv-uCenter)*vec2(uSize.x/uSize.y,1.);
      screen*=max(1.,uSize.y/uSize.x);
      vec3 ray=normalize(forward+screen.x*uRight*.92+screen.y*uUp*.92);
      vec3 p=uEye;
      float impact=length(cross(p,ray));
      float h2=impact*impact;
      vec3 light=vec3(0.);float transmission=1.;bool escaped=false;
      vec3 hit0=vec3(3.,0,0),hit1=hit0,hit2=hit0;
      vec3 dir0=ray,dir1=ray,dir2=ray,volumePosition=vec3(0.);
      float hits=0.,volumeWeight=0.;
      if(impact>16.){gl_FragColor=vec4(log(1.+stars(ray))/log(33.),1.);return;}
      // Explicit UV gradients already include distance and render resolution.
      float lod=${gradientSampling?'0.':'clamp(log2(length(uEye)/24.)+log2(1600./uSize.y),0.,2.)'};
      float r=length(p);
      float r2=r*r;
      vec3 acceleration=(-1.5*h2/(r2*r2*r))*p;
      float planeDistance=p.y-discHeight(p);
      for(int i=0;i<420;i++){
        if(r<1.015)break;
        if(r>46.){escaped=true;break;}
        float stepLength=clamp((r-1.)*.075,.025,1.25);
        float cylindrical=length(p.xz);
        float nearDisc=1.-smoothstep(.08,.8,abs(planeDistance));
        float radialBand=smoothstep(2.8,3.1,cylindrical)*(1.-smoothstep(12.8,13.5,cylindrical));
        stepLength=mix(stepLength,min(stepLength,.18),nearDisc*radialBand);
        vec3 next=p+ray*stepLength+.5*acceleration*stepLength*stepLength;
        float nextRadius=length(next);
        float safeRadius=max(nextRadius,.8),safeRadius2=safeRadius*safeRadius;
        vec3 nextAcceleration=(-1.5*h2/(safeRadius2*safeRadius2*safeRadius))*next;
        vec3 nextRay=ray+.5*(acceleration+nextAcceleration)*stepLength;
        float nextPlaneDistance=next.y-discHeight(next);
        if(planeDistance*nextPlaneDistance<=0. && abs(planeDistance-nextPlaneDistance)>.000001){
          vec3 hit=mix(p,next,clamp(planeDistance/(planeDistance-nextPlaneDistance),0.,1.));
          float discRadius=length(hit.xz);
          if(discRadius>2.95 && discRadius<12.8){
            if(hits<.5){hit0=hit;dir0=normalize(ray);}
            else if(hits<1.5){hit1=hit;dir1=normalize(ray);}
            else if(hits<2.5){hit2=hit;dir2=normalize(ray);}
            hits+=1.;
          }
        }
        // A thin, continuous gas volume gives the edge-on disc physical thickness.
        // Midpoint integration and a smoothly varying step avoid marching bands.
        if(edgeOn>0.){
        vec3 middle=(p+next)*.5;float cr=length(middle.xz);
        if(cr>2.95 && cr<12.8 && abs(middle.y)<.5){
          float height=.014+.0025*(cr-3.);
          // Integrate across the thin slab instead of sampling a single midpoint.
          // This keeps the grazing line continuous when it is thinner than a step.
          float span=abs(nextPlaneDistance-planeDistance);
          float vertical=span>.00001?abs(erfApprox(nextPlaneDistance/height)-erfApprox(planeDistance/height))*.8862269*height/span:exp(-pow(planeDistance/height,2.));
          if(vertical>.015){
            float amount=vertical*stepLength;
            volumeWeight+=amount;volumePosition+=middle*amount;
          }
        }
        }
        p=next;ray=nextRay;
        // Reuse Verlet endpoint values; the capture guard exits before r < 1.015.
        r=nextRadius;acceleration=nextAcceleration;planeDistance=nextPlaneDistance;
      }
      // Reveal existing gravitationally bent star images without changing the disc.
      // Keep the emphasis local and smooth so distant stars stay quiet.
      float lensEmphasis=1.+.55*exp(-pow((impact-4.2)/2.2,2.));
      if(escaped) light+=stars(normalize(ray))*lensEmphasis;
      // Critical impact parameter supplies a subpixel, warm-white photon rim.
      float ringWidth=max(.009,length(uEye)*1.1/uSize.y);
      float critical=exp(-pow((impact-2.598)/ringWidth,2.));
      light+=vec3(4.2,2.8,1.65)*critical;
      // Shade after tracing so texture gradients are evaluated coherently.
      vec4 gas0=matter(hit0,dir0,lod),gas1=matter(hit1,dir1,lod),gas2=matter(hit2,dir2,lod);
      float present0=step(.5,hits),present1=step(1.5,hits),present2=step(2.5,hits);
      light=light*(1.-gas2.a*present2)+gas2.rgb*present2*.35;
      light=light*(1.-gas1.a*present1)+gas1.rgb*present1*.62;
      light=light*(1.-gas0.a*present0)+gas0.rgb*present0;
      // Camera-uniform branch: derivatives remain coherent for this material.
      if(edgeOn>0.){
        vec3 volumePoint=volumeWeight>.00001?volumePosition/volumeWeight:vec3(3.1,0,0);
        vec4 haze=matter(volumePoint,normalize(ray),lod+2.);
        light+=haze.rgb*min(volumeWeight*.024,.18)*edgeOn;
      }
      gl_FragColor=vec4(log(1.+min(light,vec3(32.)))/log(33.),1.);
    }`;
  function compile(type, source) {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const error = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw Error(error); }
    return shader;
  }
  const blurFragment = `precision highp float;
    varying vec2 vUv;uniform sampler2D uSource;uniform vec2 uStep,uTexel;uniform float uExtract;
    vec3 sourceLight(vec2 p){return exp(texture2D(uSource,p).rgb*log(33.))-1.;}
    vec3 sampleLight(vec2 p){
      if(uExtract<.5)return sourceLight(p);
      // Four bilinear samples cover a 4x4 source footprint before quarter-size
      // bloom. Without this 2D prefilter a thin rim turns into a dotted halo.
      vec3 c=(sourceLight(p+uTexel*vec2(-1.,-1.))+sourceLight(p+uTexel*vec2(1.,-1.))
        +sourceLight(p+uTexel*vec2(-1.,1.))+sourceLight(p+uTexel*vec2(1.,1.)))*.25;
      return max(c-vec3(1.1),vec3(0));
    }
    void main(){vec3 c=sampleLight(vUv)*.227027;
      c+=(sampleLight(vUv+uStep*1.384615)+sampleLight(vUv-uStep*1.384615))*.316216;
      c+=(sampleLight(vUv+uStep*3.230769)+sampleLight(vUv-uStep*3.230769))*.070270;
      gl_FragColor=vec4(log(1.+c)/log(33.),1.);}`;
  const compositeFragment = `precision highp float;
    varying vec2 vUv;uniform sampler2D uScene;uniform sampler2D uBloom;
    vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
    void main(){vec3 scene=exp(texture2D(uScene,vUv).rgb*log(33.))-1.;
      vec3 glow=exp(texture2D(uBloom,vUv).rgb*log(33.))-1.;
      vec3 color=pow(aces(scene*.76+glow*.42),vec3(1./2.2));
      color*=1.-.35*dot(vUv-.5,vUv-.5);gl_FragColor=vec4(color,1.);}`;
  let program, blurProgram, compositeProgram, sizeUniform, eyeUniform, rightUniform, upUniform, timeUniform, centerUniform, plasmaUniform, filamentsUniform;
  let sourceUniform, stepUniform, texelUniform, extractUniform, sceneUniform, bloomUniform;
  let sceneTarget, bloomA, bloomB, plasmaTexture,filamentsTexture;
  function link(fragmentSource){
    const result=gl.createProgram(),vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragmentSource);
    gl.attachShader(result,vs);gl.attachShader(result,fs);gl.bindAttribLocation(result,0,'aPosition');gl.linkProgram(result);
    gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(result,gl.LINK_STATUS))throw Error('WebGL link failed');return result;
  }
  function target(){
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const framebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    return {texture,framebuffer,width:0,height:0};
  }
  function resizeTarget(t,width,height){
    if(t.width===width&&t.height===height)return;
    t.width=width;t.height=height;gl.bindTexture(gl.TEXTURE_2D,t.texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,renderType,null);
    gl.bindFramebuffer(gl.FRAMEBUFFER,t.framebuffer);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Render target unavailable');
  }
  try {
    program=link(fragment);blurProgram=link(blurFragment);compositeProgram=link(compositeFragment);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    sizeUniform=gl.getUniformLocation(program,'uSize');eyeUniform=gl.getUniformLocation(program,'uEye');rightUniform=gl.getUniformLocation(program,'uRight');upUniform=gl.getUniformLocation(program,'uUp');timeUniform=gl.getUniformLocation(program,'uTime');centerUniform=gl.getUniformLocation(program,'uCenter');plasmaUniform=gl.getUniformLocation(program,'uPlasma');
    sourceUniform=gl.getUniformLocation(blurProgram,'uSource');stepUniform=gl.getUniformLocation(blurProgram,'uStep');texelUniform=gl.getUniformLocation(blurProgram,'uTexel');extractUniform=gl.getUniformLocation(blurProgram,'uExtract');
    sceneUniform=gl.getUniformLocation(compositeProgram,'uScene');bloomUniform=gl.getUniformLocation(compositeProgram,'uBloom');
    sceneTarget=target();bloomA=target();bloomB=target();
    plasmaTexture=gl.createTexture();filamentsTexture=gl.createTexture();filamentsUniform=gl.getUniformLocation(program,'uFilaments');
  } catch(error) { console.warn('3D scene unavailable:',error.message); fallback(); return; }
  function draw() {
    if (!ready || failed) return;
    const rect=scene.getBoundingClientRect();
    // Fixed, display-aware quality: native pixels in high, 1.5x native in ultra.
    // Do not trace 3x CSS pixels on every display, or change quality while dragging.
    const budget=quality==='ultra'?8294400:3686400;
    const nativeRatio=Math.max(1,window.devicePixelRatio||1);
    const requestedRatio=quality==='ultra'?Math.min(3,nativeRatio*1.5):Math.min(2,nativeRatio);
    const ratio=Math.min(requestedRatio,Math.sqrt(budget/Math.max(rect.width*rect.height,1)),maxRenderSize/Math.max(rect.width,rect.height));
    const width=Math.max(1,Math.round(rect.width*ratio)),height=Math.max(1,Math.round(rect.height*ratio));
    try {
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
      gl.activeTexture(gl.TEXTURE0);
      resizeTarget(sceneTarget,width,height);resizeTarget(bloomA,Math.max(1,width>>2),Math.max(1,height>>2));resizeTarget(bloomB,bloomA.width,bloomA.height);
      gl.useProgram(program);gl.bindFramebuffer(gl.FRAMEBUFFER,sceneTarget.framebuffer);gl.viewport(0,0,width,height);
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,plasmaTexture);gl.uniform1i(plasmaUniform,2);
      gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,filamentsTexture);gl.uniform1i(filamentsUniform,3);
      gl.uniform2f(sizeUniform,width,height);
      gl.uniform3fv(eyeUniform,qRotate(camera.rotation,[0,0,camera.distance]));
      gl.uniform3fv(rightUniform,qRotate(camera.rotation,[1,0,0]));
      gl.uniform3fv(upUniform,qRotate(camera.rotation,[0,1,0]));
      qualityButton.title=`${width} × ${height} · 点击切换画质`;
      const small=rect.width<700;
      const travel=expanded?0:clamp(scrollY/Math.max(hero.offsetHeight*.8,1),0,1);
      const centerX=expanded?.5:(small?.5:.67-travel*.06);
      const centerY=expanded?.5:(small?1-Math.min(270,rect.height*.37)/rect.height:.50);
      gl.uniform2f(centerUniform,centerX,centerY);
      gl.uniform1f(timeUniform,elapsed);gl.drawArrays(gl.TRIANGLES,0,6);
      gl.activeTexture(gl.TEXTURE0);gl.useProgram(blurProgram);gl.uniform1i(sourceUniform,0);gl.viewport(0,0,bloomA.width,bloomA.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER,bloomA.framebuffer);gl.bindTexture(gl.TEXTURE_2D,sceneTarget.texture);
      gl.uniform2f(stepUniform,1.8/bloomA.width,0);gl.uniform2f(texelUniform,1/width,1/height);gl.uniform1f(extractUniform,1);gl.drawArrays(gl.TRIANGLES,0,6);
      gl.bindFramebuffer(gl.FRAMEBUFFER,bloomB.framebuffer);gl.bindTexture(gl.TEXTURE_2D,bloomA.texture);
      gl.uniform2f(stepUniform,0,1.8/bloomA.height);gl.uniform1f(extractUniform,0);gl.drawArrays(gl.TRIANGLES,0,6);
      gl.useProgram(compositeProgram);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,width,height);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,sceneTarget.texture);gl.uniform1i(sceneUniform,0);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,bloomB.texture);gl.uniform1i(bloomUniform,1);gl.drawArrays(gl.TRIANGLES,0,6);
    } catch {fallback();return;}
    scene.classList.add('is-ready');
  }
  function tick(time) {
    running=0;
    if(!ready||failed||!pageActive||document.hidden||projectDialog?.open){last=0;return;}
    // Animation time is independent of render cadence, so quieter backgrounds
    // keep the same flow speed. Pausing/hiding resets the clock, not the image.
    if(!paused&&last)elapsed+=Math.max(0,time-last)/1000;
    last=paused?0:time;
    const interval=1000/(document.body.classList.contains('past-hero')&&!expanded?8:30);
    if((dirty||!paused)&&time-lastDrawAt>=interval-.5){
      dirty=false;lastDrawAt=time;draw();
    }
    schedule();
  }
  function schedule(){
    if(!running&&ready&&!failed&&pageActive&&!document.hidden&&!projectDialog?.open&&(dirty||!paused))running=requestAnimationFrame(tick);
  }
  function resume(){cancelAnimationFrame(running);running=0;last=0;schedule();}
  // Every repaint shares the same cadence, including paused dragging and resize.
  function requestDraw(){dirty=true;schedule();}
  function change(){camera.rotation=qNormalize(camera.rotation);camera.distance=clamp(camera.distance,11,34);state();requestDraw();}
  function trackball(x,y){
    const rect=canvas.getBoundingClientRect(),scale=Math.min(rect.width,rect.height)*.48;
    const cx=expanded?.5:(rect.width<700?.5:.67),cy=expanded?.5:(rect.width<700?Math.min(270,rect.height*.37)/rect.height:.5);
    const px=(x-rect.left-rect.width*cx)/scale,py=(rect.top+rect.height*cy-y)/scale;
    const d=px*px+py*py,z=d<.5?Math.sqrt(1.-d):.5/Math.sqrt(d),n=Math.hypot(px,py,z);
    return [px/n,py/n,z/n];
  }
  function orbit(from,to){
    const a=trackball(...from),b=trackball(...to);
    const cross=[b[1]*a[2]-b[2]*a[1],b[2]*a[0]-b[0]*a[2],b[0]*a[1]-b[1]*a[0]];
    camera.rotation=qMultiply(camera.rotation,qNormalize([...cross,1+b[0]*a[0]+b[1]*a[1]+b[2]*a[2]]));
  }
  function endPointer(event){pointers.delete(event.pointerId);if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);pinchDistance=0;pinchAngle=null;canvas.classList.toggle('is-dragging',pointers.size>0);}
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    canvas.setPointerCapture(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});canvas.classList.add('is-dragging');canvas.focus({preventScroll:true});
  });
  canvas.addEventListener('pointermove',event=>{
    if(!pointers.has(event.pointerId))return;
    const old=pointers.get(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size===2){const [a,b]=[...pointers.values()];const distance=Math.hypot(a.x-b.x,a.y-b.y),angle=Math.atan2(a.y-b.y,a.x-b.x);if(pinchDistance)camera.distance*=pinchDistance/Math.max(distance,1);if(pinchAngle!==null)camera.rotation=qMultiply(camera.rotation,qAxis(0,0,1,angle-pinchAngle));pinchDistance=distance;pinchAngle=angle;}
    else orbit([old.x,old.y],[event.clientX,event.clientY]);
    change();
  });
  ['pointerup','pointercancel','lostpointercapture'].forEach(name=>canvas.addEventListener(name,endPointer));
  canvas.addEventListener('wheel',event=>{if(!expanded)return;event.preventDefault();camera.distance*=Math.exp(clamp(event.deltaY,-120,120)*.0015);change();},{passive:false});
  canvas.addEventListener('keydown',event=>{
    const turn=(axis,angle)=>{camera.rotation=qMultiply(camera.rotation,qAxis(...axis,angle));};
    const actions={ArrowLeft:()=>turn(event.shiftKey?[0,0,1]:[0,1,0],.12),ArrowRight:()=>turn(event.shiftKey?[0,0,1]:[0,1,0],-.12),ArrowUp:()=>turn([1,0,0],-.12),ArrowDown:()=>turn([1,0,0],.12),'+':()=>camera.distance-=1,'=':()=>camera.distance-=1,'-':()=>camera.distance+=1,Home:()=>camera={rotation:[...defaults.rotation],distance:defaults.distance}};
    if(actions[event.key]){event.preventDefault();actions[event.key]();change();}
  });
  document.querySelector('#orbit-reset').addEventListener('click',()=>{camera={rotation:[...defaults.rotation],distance:defaults.distance};change();});
  document.querySelector('#orbit-top').addEventListener('click',()=>{camera.rotation=qView(.45,1.40);change();});
  document.querySelector('#orbit-side').addEventListener('click',()=>{camera.rotation=qView(.45,.001);change();});
  qualityButton.addEventListener('click',()=>{quality=quality==='high'?'ultra':'high';try{localStorage.setItem('noxevyr-quality',quality);}catch{}state();requestDraw();});
  document.querySelector('#orbit-in').addEventListener('click',()=>{camera.distance-=2;change();});
  document.querySelector('#orbit-out').addEventListener('click',()=>{camera.distance+=2;change();});
  function expand(value){
    expanded=value;hero.classList.toggle('is-exploring',value);document.documentElement.classList.toggle('exploring-hole',value);
    explore.textContent=value?'退出探索 ↙':'展开探索 ↗';explore.setAttribute('aria-expanded',String(value));
    hint.textContent=value?'自由旋转 · 边缘拖动倾斜 · ESC 返回':'拖动环绕 · 边缘拖动倾斜';
    if(value){savedScroll=scrollY;document.querySelectorAll('body > :not(main):not(.hero-scene):not(.cosmic-veil), main > :not(#home)').forEach(el=>{if(!el.inert){el.inert=true;el.dataset.orbitInert='true';}});canvas.focus({preventScroll:true});}
    else {document.querySelectorAll('[data-orbit-inert]').forEach(el=>{el.inert=false;delete el.dataset.orbitInert;});window.scrollTo({top:savedScroll,behavior:'instant'});explore.focus({preventScroll:true});}
    resume();requestDraw();
  }
  explore.addEventListener('click',()=>expand(!expanded));
  // History navigation can open a project while exploration has made the page inert.
  document.addEventListener('portfolio:project-opening',()=>{if(expanded)expand(false);});
  // The modal obscures the scene. Suspend rendering without changing the user's pause setting.
  if(projectDialog)new MutationObserver(()=>{resume();requestDraw();}).observe(projectDialog,{attributes:true,attributeFilter:['open']});
  document.addEventListener('keydown',event=>{
    if(expanded&&event.key==='Escape'){event.preventDefault();expand(false);}
    if(expanded&&event.key==='Tab'){
      const stops=[canvas,...hero.querySelectorAll('.orbit-controls button'),toggle];
      const index=stops.indexOf(document.activeElement);
      if(event.shiftKey&&index===0){event.preventDefault();stops.at(-1).focus();}
      else if(!event.shiftKey&&index===stops.length-1){event.preventDefault();canvas.focus();}
    }
  });
  toggle.addEventListener('click',()=>{paused=!paused;try{localStorage.setItem('noxevyr-motion',paused?'paused':'running');}catch{}state();resume();});
  reduced.addEventListener('change',event=>{paused=event.matches;state();resume();});
  document.addEventListener('visibilitychange',resume);
  let scrollFrame=0;
  function scrollScene(){
    scrollFrame=0;
    const progress=clamp(scrollY/Math.max(hero.offsetHeight*.7,1),0,1);
    document.body.style.setProperty('--cosmic-dim',String(progress*.64));
    document.body.classList.toggle('past-hero',progress>.8);
    if(paused)requestDraw();
  }
  addEventListener('scroll',()=>{if(!scrollFrame)scrollFrame=requestAnimationFrame(scrollScene);},{passive:true});
  scrollScene();
  if('ResizeObserver' in window)new ResizeObserver(requestDraw).observe(scene);else addEventListener('resize',requestDraw);
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();if(expanded)expand(false);fallback();});
  addEventListener('pagehide',()=>{pageActive=false;resume();});addEventListener('pageshow',()=>{pageActive=true;resume();requestDraw();});
  function loadTexture(path,texture,unit){return new Promise((resolve,reject)=>{
    const flowImage=new Image();
    flowImage.onload=()=>{
    try{
      // Normalize image dimensions for portable WebGL1 mipmapped material sampling.
      const source=document.createElement('canvas');
      const flow=path.endsWith('plasma-flow.png');
      source.width=Math.min(flow?4096:2048,maxRenderSize);source.height=source.width/2;
      source.getContext('2d').drawImage(flowImage,0,0,source.width,source.height);
      gl.activeTexture(unit);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
      const aniso=gl.getExtension('EXT_texture_filter_anisotropic');if(aniso)gl.texParameterf(gl.TEXTURE_2D,aniso.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(16,gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      resolve();
    }catch(error){reject(error);}
  };
    flowImage.onerror=reject;flowImage.src=path+buildQuery;
  });}
  Promise.all([loadTexture('assets/plasma-turbulence.png',plasmaTexture,gl.TEXTURE2),loadTexture('assets/plasma-flow.png',filamentsTexture,gl.TEXTURE3)])
    .then(()=>{if(failed)return;ready=true;requestDraw();}).catch(fallback);
})();
