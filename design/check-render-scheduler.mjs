// Offline regression test: run the actual browser script with a deterministic RAF clock.
// This checks CPU-side scheduling and submitted uniforms, not shader compilation or pixels.
// Run from any directory: node design/check-render-scheduler.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/blackhole.js', import.meta.url), 'utf8');
const RAF_MS = 1000 / 120;

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
    emit(type, event = {}) {
      event.preventDefault ??= () => {};
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

function element(attributeChanged = () => {}) {
  const classes = new Set();
  const children = new Map();
  const attributes = new Map();
  const captures = new Set();
  return {
    ...eventTarget(),
    width: 0, height: 0, offsetHeight: 900, hidden: false, inert: false, disabled: false, dataset: {},
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
      toggle(name, force = !classes.has(name)) {
        if (force) classes.add(name); else classes.delete(name);
        return force;
      },
    },
    style: { setProperty() {} },
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute(name, value) {
      attributes.set(name, String(value));
      attributeChanged(this, name);
    },
    removeAttribute(name) {
      if (attributes.delete(name)) attributeChanged(this, name);
    },
    get open() { return attributes.has('open'); },
    set open(value) {
      if (value) this.setAttribute('open', ''); else this.removeAttribute('open');
    },
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, element());
      return children.get(selector);
    },
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    focus() {},
    setPointerCapture: id => captures.add(id),
    hasPointerCapture: id => captures.has(id),
    releasePointerCapture: id => captures.delete(id),
  };
}

function harness({
  paused = false, pastHero = false, hidden = false, dialogOpen = false,
  dpr = 1, sceneWidth = 1280, sceneHeight = 720, quality = 'high',
  halfFloat = false, framebufferFailure = null, gradientSampling = false,
  shaderFailure = null, contextAvailable = true, allowFallback = false,
  deviceMemory, hardwareConcurrency, coarse = false, saveData = false,
  renderer = null, maxRenderSize = 4096, gpuDuration = null, gpuDisjoint = false,
} = {}) {
  const nodes = new Map();
  const pending = new Map();
  const images = [];
  const textureRequests = [];
  const textureUploads = [];
  const scratchCanvases = [];
  const contextRequests = [];
  const resources = { texture: [], framebuffer: [], program: [], buffer: [] };
  const deleted = { texture: [], framebuffer: [], program: [], buffer: [] };
  const targetAllocations = [];
  const renderPasses = [];
  const compiledShaders = [];
  const warnings = [];
  const frames = [];
  const uniforms = new Map();
  const storage = new Map();
  if (quality !== null && quality !== undefined) storage.set('noxevyr-quality', quality);
  const mutationObservers = new Set();
  let now = 1000;
  let nextId = 0;
  let drawCalls = 0;
  let rafRequests = 0;
  let peakRenderCallbacks = 0;
  let reloads = 0;
  let boundTexture = null;
  let boundFramebuffer = null;
  let halfFloatChecks = 0;
  let peakLiveTextures = 0;
  let layoutReads = 0;
  let gpuTimings = 0;
  const HALF_FLOAT = 36193;
  // Native MutationObserver delivers attribute changes at the microtask checkpoint.
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Map();
      this.records = [];
      this.queued = false;
      mutationObservers.add(this);
    }
    observe(target, options) { this.targets.set(target, options); }
    disconnect() { this.targets.clear(); this.records = []; }
    takeRecords() { const records = this.records; this.records = []; return records; }
    attributeChanged(target, attributeName) {
      const options = this.targets.get(target);
      if (!options?.attributes || (options.attributeFilter && !options.attributeFilter.includes(attributeName))) return;
      this.records.push({ type: 'attributes', target, attributeName });
      if (this.queued) return;
      this.queued = true;
      queueMicrotask(() => {
        this.queued = false;
        const records = this.takeRecords();
        if (records.length) this.callback(records, this);
      });
    }
  }
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, element((target, name) => {
      for (const observer of mutationObservers) observer.attributeChanged(target, name);
    }));
    return nodes.get(selector);
  };
  for (const selector of ['#blackhole-canvas', '.hero-scene']) {
    node(selector).getBoundingClientRect = () => {layoutReads++;return { left: 0, top: 0, width: sceneWidth, height: sceneHeight };};
  }
  node('#project-dialog').open = dialogOpen;
  node('#scene-retry').hidden = true;
  const orbitControls = ['#orbit-reset', '#orbit-top', '#orbit-side', '#orbit-in', '#orbit-out',
    '#render-quality', '#explore-hole'].map(node);
  const controls = [...orbitControls, node('#motion-toggle')];
  const outsideElements = [node('#project-dialog'), element()];
  const gl = {};
  const constants = `MAX_TEXTURE_SIZE MAX_RENDERBUFFER_SIZE UNSIGNED_BYTE VERTEX_SHADER
    FRAGMENT_SHADER COMPILE_STATUS LINK_STATUS FRAMEBUFFER_COMPLETE FRAMEBUFFER_INCOMPLETE_ATTACHMENT TEXTURE_2D
    TEXTURE_MIN_FILTER TEXTURE_MAG_FILTER LINEAR TEXTURE_WRAP_S TEXTURE_WRAP_T
    CLAMP_TO_EDGE FRAMEBUFFER COLOR_ATTACHMENT0 RGBA ARRAY_BUFFER STATIC_DRAW FLOAT
    TEXTURE0 TEXTURE1 TEXTURE2 TEXTURE3 TRIANGLES UNPACK_COLORSPACE_CONVERSION_WEBGL
    NONE UNPACK_PREMULTIPLY_ALPHA_WEBGL REPEAT LINEAR_MIPMAP_LINEAR`.split(/\s+/);
  constants.forEach((name, index) => { gl[name] = index + 1; });
  const noops = `shaderSource compileShader deleteShader deleteProgram attachShader bindAttribLocation
    linkProgram bindTexture texParameteri bindFramebuffer framebufferTexture2D texImage2D
    bindBuffer bufferData enableVertexAttribArray vertexAttribPointer activeTexture
    useProgram viewport uniform1i uniform2f pixelStorei generateMipmap`.split(/\s+/);
  noops.forEach(name => { gl[name] = () => {}; });
  ['createShader', 'createProgram', 'createTexture', 'createFramebuffer', 'createBuffer']
    .forEach(name => { gl[name] = () => ({}); });
  for (const [kind, suffix] of [['texture', 'Texture'], ['framebuffer', 'Framebuffer'],
    ['program', 'Program'], ['buffer', 'Buffer']]) {
    gl[`create${suffix}`] = () => {
      const resource = { kind, id: resources[kind].length + 1 };
      resources[kind].push(resource);
      if (kind === 'texture') peakLiveTextures = Math.max(peakLiveTextures,
        resources.texture.filter(texture => !texture.deleted).length);
      return resource;
    };
    gl[`delete${suffix}`] = resource => {
      if (!resource || resource.deleted) return;
      resource.deleted = true;
      deleted[kind].push(resource);
    };
  }
  Object.assign(gl, {
    getParameter: parameter => parameter === 0x9246 ? renderer : parameter === 0x8FBB ? gpuDisjoint : maxRenderSize,
    getExtension(name) {
      if (gpuDuration !== null && name === 'EXT_disjoint_timer_query') return {
        GPU_DISJOINT_EXT: 0x8FBB, QUERY_RESULT_AVAILABLE_EXT: 1, QUERY_RESULT_EXT: 2, TIME_ELAPSED_EXT: 3,
        createQueryEXT: () => ({}), deleteQueryEXT() {}, beginQueryEXT() {}, endQueryEXT() {},
        getQueryObjectEXT(_query, parameter) {if(parameter===1)return true;gpuTimings++;return (typeof gpuDuration==='function'?gpuDuration(node('#blackhole-canvas').width):gpuDuration)*1e6;},
      };
      if (renderer && name === 'WEBGL_debug_renderer_info') return { UNMASKED_RENDERER_WEBGL: 0x9246 };
      if (halfFloat && name === 'OES_texture_half_float') return { HALF_FLOAT_OES: HALF_FLOAT };
      if (halfFloat && ['OES_texture_half_float_linear', 'EXT_color_buffer_half_float'].includes(name)) return {};
      if (gradientSampling && ['OES_standard_derivatives', 'EXT_shader_texture_lod'].includes(name)) return {};
      return null;
    },
    createShader: type => ({ type }),
    shaderSource: (shader, shaderSource) => { shader.source = shaderSource; },
    compileShader: shader => compiledShaders.push(shader),
    getShaderParameter: shader => shader.type !== gl.FRAGMENT_SHADER || !(shaderFailure === 'all'
      || (shaderFailure === 'gradient' && shader.source.includes('texture2DGradEXT'))),
    getShaderInfoLog: () => 'Simulated shader compilation failure',
    getProgramParameter: () => true,
    bindTexture: (_target, texture) => { boundTexture = texture; },
    bindFramebuffer: (_target, framebuffer) => { boundFramebuffer = framebuffer; },
    framebufferTexture2D: (_target, _attachment, _textureTarget, texture) => {
      boundFramebuffer.texture = texture;
      if (texture) texture.isTarget = true;
    },
    texImage2D(...args) {
      if (args.length === 6) {
        const input = args[5];
        textureUploads.push({ texture: boundTexture, source: input,
          width: input.naturalWidth || input.width, height: input.naturalHeight || input.height,
          fromImage: images.includes(input), url: input.src });
        return;
      }
      if (args.length !== 9) throw Error(`Unexpected texImage2D signature: ${args.length}`);
      Object.assign(boundTexture, { width: args[3], height: args[4], type: args[7] });
      if (boundTexture.isTarget) targetAllocations.push({ texture: boundTexture, width: args[3], height: args[4], type: args[7] });
    },
    checkFramebufferStatus() {
      const type = boundFramebuffer.texture.type;
      if (type === HALF_FLOAT) halfFloatChecks++;
      // Fail the second half-float target so recovery must also reallocate the first.
      const incomplete = framebufferFailure === 'all'
        || (framebufferFailure === 'half-float' && type === HALF_FLOAT && halfFloatChecks >= 2);
      return incomplete ? gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT : gl.FRAMEBUFFER_COMPLETE;
    },
    getUniformLocation: (_program, name) => name,
    uniform1f: (name, value) => uniforms.set(name, value),
    uniform3fv: (name, value) => uniforms.set(name, Array.from(value)),
    drawArrays() {
      renderPasses.push({ framebuffer: boundFramebuffer, type: boundFramebuffer?.texture.type });
      drawCalls++;
      // Each submitted image contains scene, horizontal bloom, vertical bloom, composite.
      if (drawCalls % 4 === 0) frames.push({
        at: now,
        width: node('#blackhole-canvas').width,
        height: node('#blackhole-canvas').height,
        time: uniforms.get('uTime'),
        eye: uniforms.get('uEye'),
        right: uniforms.get('uRight'),
        up: uniforms.get('uUp'),
      });
    },
  });
  node('#blackhole-canvas').getContext = (type, attributes) => {
    contextRequests.push({ type, attributes });
    return contextAvailable ? gl : null;
  };
  const document = {
    ...eventTarget(), hidden,
    body: element(), documentElement: element(),
    currentScript: { src: 'https://example.test/blackhole.js?test=1' },
    querySelector: node,
    querySelectorAll(selector) {
      if (selector === 'body > :not(main):not(.hero-scene):not(.cosmic-veil), main > :not(#home)') return outsideElements;
      if (selector === '[data-orbit-inert]') return outsideElements.filter(el => el.dataset.orbitInert);
      if (selector === '.orbit-controls button, .orbit-controls select, #motion-toggle') return [...controls, node('#scene-retry')];
      if (selector === '.orbit-controls button, .orbit-controls select') return [...orbitControls, node('#scene-retry')];
      return [];
    },
    createElement: () => {
      const scratch = { width: 0, height: 0, getContext: () => ({ drawImage() {} }) };
      scratchCanvases.push(scratch);
      return scratch;
    },
  };
  const reduced = { ...eventTarget(), matches: paused };
  const context = {
    ...eventTarget(), document, URL, Promise, Float32Array, MutationObserver, performance: {now: () => now},
    console: { warn: (...args) => warnings.push(args) },
    location: { reload: () => { reloads++; } },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    matchMedia: query => query.includes('prefers-reduced-motion') ? reduced : { ...eventTarget(), matches: coarse },
    navigator: { deviceMemory, hardwareConcurrency, connection: { saveData } },
    scrollY: pastHero ? 900 : 0,
    devicePixelRatio: dpr,
    scrollTo() {},
    Image: class {
      constructor() { images.push(this); this.removed = []; }
      get src() { return this.url; }
      set src(value) {
        this.url = value;
        const dimensions = value.includes('flow-standard') ? [2048, 1024]
          : value.includes('turbulence-standard') ? [1024, 512]
          : value.includes('plasma-flow') ? [4096, 2048] : [1774, 887];
        [this.width, this.height] = [this.naturalWidth, this.naturalHeight] = dimensions;
        textureRequests.push({ image: this, url: value });
      }
      removeAttribute(name) { this.removed.push(name); if (name === 'src') this.url = ''; }
    },
    requestAnimationFrame(callback) {
      const id = ++nextId;
      pending.set(id, callback);
      rafRequests++;
      const rendering = [...pending.values()].filter(fn => fn.name === 'tick').length;
      peakRenderCallbacks = Math.max(peakRenderCallbacks, rendering);
      return id;
    },
    cancelAnimationFrame: id => pending.delete(id),
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'public/blackhole.js' });
  if (!allowFallback) assert.equal(node('#blackhole-canvas').hidden, false, 'WebGL setup must succeed');

  async function settle() {
    // Include retry chains, Promise.all, and the terminal success/fallback handler.
    for (let i = 0; i < 16; i++) await Promise.resolve();
  }

  return {
    document, context, frames, node, controls, orbitControls, textureRequests, targetAllocations,
    textureUploads, scratchCanvases, contextRequests, resources, deleted, images, settle,
    renderPasses, compiledShaders, warnings, gl,
    get pending() { return pending.size; },
    get now() { return now; },
    get requests() { return rafRequests; },
    get reloads() { return reloads; },
    get peakLiveTextures() { return peakLiveTextures; },
    get layoutReads() { return layoutReads; },
    get gpuTimings() { return gpuTimings; },
    setGpuDuration(value) { gpuDuration=value; },
    async selectQuality(value) { node('#render-quality').value=value;node('#render-quality').emit('change');await settle(); },
    scroll(value) { context.scrollY=value;context.emit('scroll'); },
    async load(index) {
      assert.ok(images[index], `texture ${index} was requested`);
      images[index].onload();
      await settle();
    },
    async loadRequest(index) {
      assert.ok(textureRequests[index], `texture request ${index} exists`);
      textureRequests[index].image.onload();
      await settle();
    },
    async failRequest(index) {
      assert.ok(textureRequests[index], `texture request ${index} exists`);
      textureRequests[index].image.onerror(new Error('Simulated texture network failure'));
      await settle();
    },
    advance(milliseconds = RAF_MS) {
      now += milliseconds;
      const callbacks = [...pending.entries()];
      for (const [id, callback] of callbacks) {
        if (!pending.delete(id)) continue;
        callback(now);
      }
      if (!allowFallback) assert.equal(node('#blackhole-canvas').hidden, false, 'draw must not enter fallback');
      assert.equal(drawCalls, frames.length * 4, 'every image has all four render passes');
      assert.ok(peakRenderCallbacks <= 1, 'only one render RAF may be pending');
    },
    run(count) { for (let i = 0; i < count; i++) this.advance(); },
    key(key) { node('#blackhole-canvas').emit('keydown', { key, shiftKey: false }); },
    setHidden(value) { document.hidden = value; document.emit('visibilitychange'); },
    async setDialogOpen(value) {
      node('#project-dialog').open = value;
      await Promise.resolve();
    },
  };
}

async function loaded(options) {
  const h = harness(options);
  await h.load(0);
  await h.load(1);
  return h;
}

function cadence(frames, fps) {
  assert.ok(frames.length > 1, 'must produce multiple images to measure cadence');
  for (let i = 1; i < frames.length; i++) {
    const gap = frames[i].at - frames[i - 1].at;
    assert.ok(gap >= 1000 / fps - 0.501, `${fps} fps cap violated by ${gap} ms gap`);
  }
}

function almostEqual(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} versus ${expected}`);
}

function resolution(frames, width, height) {
  assert.ok(frames.length > 0, 'must draw at least one image to check resolution');
  const mismatch = frames.find(frame => frame.width !== width || frame.height !== height);
  assert.equal(mismatch, undefined, mismatch
    ? `expected ${width} × ${height}, got ${mismatch.width} × ${mismatch.height} at ${mismatch.at} ms`
    : 'every submitted image uses the requested resolution');
}

function fallbackState(h, reason) {
  assert.equal(h.node('#blackhole-canvas').hidden, true, 'failed rendering shows the static cover');
  assert.equal(h.node('.hero-scene').classList.contains('is-ready'), false);
  assert.equal(h.node('.hero-scene').dataset.failure, reason, 'failure reason identifies the recovery path');
  assert.ok(h.controls.every(control => control.disabled), 'unavailable 3D controls stay disabled');
  assert.ok(h.orbitControls.every(control => control.hidden), 'unavailable orbit buttons must not crowd the mobile fallback');
  assert.equal(h.node('#orbit-readout').hidden, true, 'fallback hides the irrelevant camera readout');
  assert.equal(h.node('#orbit-hint').hidden, false, 'failure guidance stays visible');
  assert.ok(h.node('#orbit-hint').textContent.length > 0);
  assert.equal(h.node('#motion-toggle').hidden, false);
  assert.equal(h.node('#motion-toggle').querySelector('.motion-label').textContent, '静态画面');
  if (reason === 'context') assert.match(h.node('#orbit-hint').textContent, /浏览器未能启动 3D/);
  assert.equal(h.node('#scene-retry').hidden, false, 'fallback offers a visible retry');
  assert.equal(h.node('#scene-retry').disabled, false, 'retry remains usable');
  assert.equal(h.pending, 0, 'fallback stops RAF scheduling');
}

async function test(name, callback) {
  await callback();
  console.log(`PASS ${name}`);
}

await test('texture completion submits its first image through RAF', async () => {
  const h = harness();
  assert.equal(h.pending, 0);
  assert.equal(h.textureRequests.length, 1, 'only the flow image starts decoding initially');
  assert.match(h.textureRequests[0].url, /plasma-flow\.png/);
  await h.load(0);
  assert.equal(h.pending, 0, 'both textures are required');
  assert.equal(h.textureRequests.length, 2, 'turbulence starts after flow upload finishes');
  assert.match(h.textureRequests[1].url, /plasma-turbulence\.png/);
  await h.load(1);
  assert.equal(h.frames.length, 0, 'texture completion must not draw synchronously');
  assert.equal(h.pending, 1);
  h.advance();
  assert.equal(h.frames.length, 1);
});

for (const [pastHero, fps] of [[false, 30]]) {
  await test(`120 Hz RAF is capped at ${fps} fps; elapsed follows wall time`, async () => {
    const h = await loaded({ pastHero });
    const firstTickAt = h.now + RAF_MS;
    h.run(240);
    cadence(h.frames, fps);
    assert.ok(h.frames.length >= fps * 2 - 1 && h.frames.length <= fps * 2,
      `expected about ${fps * 2} images over two seconds, got ${h.frames.length}`);
    for (const frame of h.frames) {
      almostEqual(frame.time, (frame.at - firstTickAt) / 1000, 'flow uses real elapsed time');
    }
  });
}

await test('paused scene remains idle without drawing or requesting RAF', async () => {
  const h = await loaded({ paused: true });
  h.advance();
  const requests = h.requests;
  assert.equal(h.frames.length, 1);
  assert.equal(h.pending, 0);
  h.run(240);
  assert.equal(h.frames.length, 1);
  assert.equal(h.requests, requests);
});

await test('paused keyboard bursts obey 30 fps and commit the final input', async () => {
  const h = await loaded({ paused: true });
  h.advance();
  const initialEye = h.frames[0].eye;
  for (let i = 0; i < 240; i++) { h.key('ArrowLeft'); h.advance(); }
  assert.notDeepEqual(h.frames.at(-1).eye, initialEye);
  const before = h.frames.length;
  h.key('Home');
  assert.equal(h.frames.length, before, 'input must not draw synchronously');
  h.run(12);
  assert.equal(h.frames.length, before + 1, 'final dirty image must be committed once');
  h.frames.at(-1).eye.forEach((value, index) => {
    almostEqual(value, initialEye[index], 'Home restores the final camera');
  });
  assert.ok(h.frames.every(frame => frame.time === 0), 'paused interaction cannot advance flow');
  cadence(h.frames, 30);
  assert.equal(h.pending, 0);
});

await test('paused dragging coalesces redraws while preserving the final camera', async () => {
  const h = await loaded({ paused: true });
  const reference = await loaded({ paused: true });
  h.advance(); reference.advance();
  const emitBoth = (type, event) => {
    h.node('#blackhole-canvas').emit(type, { ...event });
    reference.node('#blackhole-canvas').emit(type, { ...event });
  };
  emitBoth('pointerdown', { button: 0, pointerId: 1, clientX: 700, clientY: 300 });
  for (let i = 0; i < 240; i++) {
    emitBoth('pointermove', { pointerId: 1,
      clientX: 700 + Math.sin(i / 20) * 70, clientY: 300 + Math.cos(i / 25) * 50 });
    h.advance();
  }
  const before = h.frames.length;
  emitBoth('pointermove', { pointerId: 1, clientX: 790, clientY: 380 });
  emitBoth('pointerup', { pointerId: 1 });
  assert.equal(h.frames.length, before);
  // Same actual source and events, with only one final image, provide the camera oracle.
  reference.advance(100);
  h.run(12);
  assert.equal(h.frames.length, before + 1);
  for (const uniform of ['eye', 'right', 'up']) {
    assert.deepEqual(h.frames.at(-1)[uniform], reference.frames.at(-1)[uniform]);
  }
  cadence(h.frames, 30);
  assert.equal(h.pending, 0);
});

for (const lifecycle of ['document.hidden', 'pagehide']) {
  await test(`${lifecycle} prevents draws and resumes without a time jump`, async () => {
    const h = await loaded();
    h.run(13);
    const before = h.frames.length;
    const timeBefore = h.frames.at(-1).time;
    if (lifecycle === 'document.hidden') h.setHidden(true);
    else h.context.emit('pagehide');
    h.key('ArrowLeft');
    h.context.emit('resize');
    assert.equal(h.pending, 0, 'hidden invalidations must not schedule rendering');
    h.run(600);
    assert.equal(h.frames.length, before);
    if (lifecycle === 'document.hidden') h.setHidden(false);
    else h.context.emit('pageshow');
    h.advance();
    assert.equal(h.frames.length, before + 1, 'visible page must draw again');
    almostEqual(h.frames.at(-1).time, timeBefore, 'hidden duration is excluded');
    h.run(12);
    assert.ok(h.frames.at(-1).time > timeBefore, 'flow resumes after return');
  });
}

await test('textures loading in a hidden document wait for visibility', async () => {
  const h = await loaded({ hidden: true });
  assert.equal(h.pending, 0);
  h.run(120);
  assert.equal(h.frames.length, 0);
  h.setHidden(false);
  assert.equal(h.frames.length, 0);
  h.advance();
  assert.equal(h.frames.length, 1);
});

for (const userPaused of [false, true]) {
  await test(`project dialog suspends rendering and preserves ${userPaused ? 'user-paused' : 'running'} preference`, async () => {
    const h = await loaded();
    h.run(13);
    if (userPaused) h.node('#motion-toggle').emit('click');
    const before = h.frames.length;
    const previousFrame = h.frames.at(-1);
    const savedPreference = h.context.localStorage.getItem('noxevyr-motion');
    assert.equal(h.node('#motion-toggle').getAttribute('aria-pressed'), String(userPaused));
    await h.setDialogOpen(true);
    assert.equal(h.pending, 0, 'opening dialog cancels the outstanding render RAF');
    const requests = h.requests;
    h.key('ArrowLeft');
    h.context.emit('resize');
    assert.equal(h.pending, 0, 'dirty input under the dialog must not request RAF');
    h.run(600);
    assert.equal(h.frames.length, before, 'covered canvas must not draw');
    assert.equal(h.requests, requests, 'covered canvas must not keep an idle RAF loop');
    assert.equal(h.node('#motion-toggle').getAttribute('aria-pressed'), String(userPaused));
    assert.equal(h.context.localStorage.getItem('noxevyr-motion'), savedPreference);

    await h.setDialogOpen(false);
    assert.equal(h.frames.length, before, 'closing dialog must use the shared scheduler');
    assert.equal(h.pending, 1, 'closing dialog schedules a repaint');
    h.advance();
    assert.equal(h.frames.length, before + 1);
    almostEqual(h.frames.at(-1).time, previousFrame.time, 'dialog duration is excluded');
    assert.notDeepEqual(h.frames.at(-1).eye, previousFrame.eye, 'covered dirty state is committed on return');
    const requestsAfterFirstFrame = h.requests;
    h.run(120);
    if (userPaused) {
      assert.equal(h.frames.length, before + 1, 'user pause is preserved after closing');
      assert.equal(h.pending, 0);
      assert.equal(h.requests, requestsAfterFirstFrame);
    } else {
      assert.ok(h.frames.length > before + 1, 'running animation resumes after closing');
      assert.ok(h.frames.at(-1).time > previousFrame.time);
    }
    assert.equal(h.node('#motion-toggle').getAttribute('aria-pressed'), String(userPaused));
    assert.equal(h.context.localStorage.getItem('noxevyr-motion'), savedPreference);
  });
}

await test('textures completing behind an already-open dialog wait for it to close', async () => {
  const h = await loaded({ dialogOpen: true });
  assert.equal(h.pending, 0, 'ready textures must not bypass dialog suspension');
  const requests = h.requests;
  h.run(120);
  assert.equal(h.frames.length, 0);
  assert.equal(h.requests, requests);
  await h.setDialogOpen(false);
  assert.equal(h.frames.length, 0);
  h.advance();
  assert.equal(h.frames.length, 1);
  almostEqual(h.frames[0].time, 0, 'initial covered duration does not advance flow');
});

await test('project-opening exits exploration and releases dialog inert state before opening', async () => {
  const h = await loaded();
  h.advance();
  h.node('#explore-hole').emit('click');
  assert.equal(h.node('.hero').classList.contains('is-exploring'), true);
  assert.equal(h.document.documentElement.classList.contains('exploring-hole'), true);
  assert.equal(h.node('#project-dialog').inert, true, 'exploration protects background content');
  h.document.emit('portfolio:project-opening');
  assert.equal(h.node('#project-dialog').open, false, 'pre-opening event precedes native showModal');
  assert.equal(h.node('.hero').classList.contains('is-exploring'), false);
  assert.equal(h.document.documentElement.classList.contains('exploring-hole'), false);
  assert.equal(h.node('#project-dialog').inert, false, 'dialog must be interactive before showModal');
  assert.equal(h.node('#project-dialog').dataset.orbitInert, undefined);
  await h.setDialogOpen(true);
  assert.equal(h.pending, 0);
  const before = h.frames.length;
  h.run(120);
  assert.equal(h.frames.length, before);
});

await test('DPR 1.5 retains high and ultra resolution and switches between them without material loads', async () => {
  const h = await loaded({ dpr: 1.5 });
  h.run(13);
  resolution(h.frames, 1920, 1080);
  const before = h.frames.length;
  const textureCount = h.resources.texture.length;
  await h.selectQuality('ultra');
  await h.settle();
  assert.equal(h.frames.length, before, 'quality change must use the shared scheduler');
  h.run(13);
  resolution(h.frames.slice(before), 2880, 1620);
  assert.equal(h.context.localStorage.getItem('noxevyr-quality'), 'ultra');
  assert.equal(h.textureRequests.length, 2, 'high and ultra share the uploaded materials');
  assert.equal(h.resources.texture.length, textureCount, 'resolution changes allocate no new material handles');
  const restored = await loaded({ dpr: 1.5, quality: 'ultra' });
  restored.advance();
  resolution(restored.frames, 2880, 1620);
});

for (const [quality, width, height] of [['high', 1920, 1080], ['ultra', 2880, 1620]]) {
  await test(`${quality} resolution remains stable through three minutes and continuous dragging`, async () => {
    const h = await loaded({ dpr: 1.5, quality });
    h.run(120 * 180);
    assert.ok(h.frames.at(-1).time > 179, 'simulate sustained animation, not only an initial image');
    const canvas = h.node('#blackhole-canvas');
    canvas.emit('pointerdown', { button: 0, pointerId: 1, clientX: 700, clientY: 300 });
    for (let i = 0; i < 240; i++) {
      canvas.emit('pointermove', { pointerId: 1,
        clientX: 700 + Math.sin(i / 20) * 70, clientY: 300 + Math.cos(i / 25) * 50 });
      h.advance();
    }
    canvas.emit('pointerup', { pointerId: 1 });
    h.run(12);
    assert.notDeepEqual(h.frames.at(-1).eye, h.frames[0].eye, 'dragging changes the actual camera');
    resolution(h.frames, width, height);
    assert.equal(h.context.localStorage.getItem('noxevyr-quality'), quality);
  });
}

await test('large displays retain the high and ultra pixel budgets', async () => {
  for (const [quality, width, height, budget] of [
    ['high', 2560, 1440, 3686400],
    ['ultra', 3840, 2160, 8294400],
  ]) {
    const h = await loaded({ dpr: 2, sceneWidth: 3840, sceneHeight: 2160, quality });
    h.run(13);
    resolution(h.frames, width, height);
    assert.ok(h.frames.every(frame => frame.width * frame.height <= budget),
      `${quality} must stay within its ${budget}-pixel render budget`);
  }
});

await test('loading controls become available only after the first complete render', async () => {
  const h = harness();
  assert.ok(h.controls.every(control => control.disabled), 'controls must be unavailable while textures load');
  assert.match(h.node('#orbit-hint').textContent, /正在加载 3D 场景/);
  await h.load(0);
  await h.load(1);
  assert.ok(h.controls.every(control => control.disabled), 'texture completion alone cannot enable controls');
  h.advance();
  assert.equal(h.frames.length, 1);
  assert.ok(h.controls.every(control => !control.disabled));
  assert.equal(h.node('#scene-retry').hidden, true);
  assert.equal(h.node('#scene-retry').disabled, true, 'successful rendering disables the unused retry action');
});

await test('one texture network failure retries the same resource and recovers', async () => {
  const h = harness();
  assert.equal(h.textureRequests.length, 1);
  await h.failRequest(0);
  assert.equal(h.textureRequests.length, 2, 'only the failed texture gets one retry');
  assert.equal(new URL(h.textureRequests[1].url, 'https://example.test').pathname,
    new URL(h.textureRequests[0].url, 'https://example.test').pathname);
  assert.equal(h.node('#blackhole-canvas').hidden, false, 'first network failure must not enter fallback');
  await h.loadRequest(1);
  assert.equal(h.textureRequests.length, 3, 'second material waits for the successful retry');
  await h.loadRequest(2);
  assert.equal(h.frames.length, 0, 'retry completion still uses RAF');
  h.advance();
  assert.equal(h.frames.length, 1);
  assert.ok(h.controls.every(control => !control.disabled));
});

await test('two texture network failures stop cleanly and leave manual retry available', async () => {
  const h = harness({ allowFallback: true });
  await h.failRequest(0);
  await h.failRequest(1);
  assert.equal(h.textureRequests.length, 2, 'automatic texture retry is bounded to one');
  fallbackState(h, 'texture');
  assert.equal(h.images[0].onload, null, 'failed loads release their completion handler');
  assert.equal(h.images[0].onerror, null, 'failed loads release their error handler');
  h.run(120);
  assert.equal(h.frames.length, 0, 'failed serial loading cannot revive or request the next texture');
  fallbackState(h, 'texture');
  h.node('#scene-retry').emit('click');
  assert.equal(h.reloads, 1, 'manual retry reloads the page');
});

await test('working half-float framebuffers retain all four render passes', async () => {
  const h = await loaded({ halfFloat: true });
  h.advance();
  assert.equal(h.frames.length, 1);
  assert.equal(h.renderPasses.length, 4);
  assert.ok(h.renderPasses.filter(pass => pass.framebuffer).every(pass => pass.type === 36193));
});

await test('an incomplete half-float bloom target reallocates every target as RGBA8', async () => {
  const h = await loaded({ halfFloat: true, framebufferFailure: 'half-float' });
  h.run(13);
  assert.ok(h.frames.length > 0, 'RGBA8 recovery produces complete images');
  assert.ok(h.targetAllocations.some(target => target.type === 36193), 'half-float was attempted first');
  const rgba8 = h.targetAllocations.filter(target => target.type === h.gl.UNSIGNED_BYTE);
  assert.equal(new Set(rgba8.map(target => target.texture)).size, 3, 'all three targets must be reallocated');
  assert.ok(rgba8.some(target => target.texture === h.targetAllocations[0].texture),
    'the previously complete scene target is reallocated as well');
  assert.ok(h.renderPasses.filter(pass => pass.framebuffer).every(pass => pass.type === h.gl.UNSIGNED_BYTE));
  assert.ok(h.controls.every(control => !control.disabled));
});

await test('failure of both half-float and RGBA8 enters fallback without a render loop', async () => {
  const h = await loaded({ halfFloat: true, framebufferFailure: 'all', allowFallback: true });
  h.advance();
  fallbackState(h, 'render');
  assert.equal(h.frames.length, 0);
  assert.ok(h.targetAllocations.some(target => target.type === 36193));
  assert.ok(h.targetAllocations.some(target => target.type === h.gl.UNSIGNED_BYTE));
  const requests = h.requests;
  h.run(120);
  assert.equal(h.requests, requests);
  assert.equal(h.frames.length, 0);
});

await test('gradient shader compilation failure retries implicit sampling at high precision', async () => {
  const h = await loaded({ gradientSampling: true, shaderFailure: 'gradient' });
  const sceneShaders = h.compiledShaders.filter(shader => shader.source.includes('uniform vec3 uEye'));
  assert.equal(sceneShaders.length, 2, 'the scene shader gets exactly one compatibility retry');
  assert.ok(sceneShaders[0].source.includes('texture2DGradEXT'));
  assert.ok(!sceneShaders[1].source.includes('texture2DGradEXT'));
  assert.match(sceneShaders[1].source, /precision highp float/);
  assert.match(sceneShaders[1].source, /texture2D\(tex,uv,lod\)/);
  h.advance();
  assert.equal(h.frames.length, 1);
});

for (const [failure, reason, options] of [
  ['unavailable WebGL context', 'context', { contextAvailable: false }],
  ['both shader variants failing', 'shader', { gradientSampling: true, shaderFailure: 'all' }],
]) {
  await test(`${failure} provides a usable manual retry`, async () => {
    const h = harness({ ...options, allowFallback: true });
    fallbackState(h, reason);
    assert.equal(h.textureRequests.length, 0, 'initialization failure stops before texture downloads');
    h.node('#scene-retry').emit('click');
    assert.equal(h.reloads, 1);
  });
}

await test('context loss after rendering exposes retry and stops further drawing', async () => {
  const h = await loaded({ allowFallback: true });
  h.run(13);
  const before = h.frames.length;
  h.node('#blackhole-canvas').emit('webglcontextlost');
  fallbackState(h, 'lost');
  h.run(120);
  assert.equal(h.frames.length, before);
  h.node('#scene-retry').emit('click');
  assert.equal(h.reloads, 1);
});

await test('WebGL omits unused depth, stencil and preserved drawing buffers', async () => {
  const h = await loaded();
  const { type, attributes } = h.contextRequests[0];
  assert.equal(type, 'webgl');
  for (const name of ['depth', 'stencil', 'preserveDrawingBuffer', 'antialias']) {
    assert.equal(attributes[name], false, `${name} must not allocate an unnecessary buffer`);
  }
});

await test('automatic quality starts eco on both integrated and discrete devices; old manual preferences survive', async () => {
  for (const renderer of [null, 'AMD Radeon(TM) Graphics', 'Intel Iris Xe', 'NVIDIA GeForce RTX 5070 Ti']) {
    const h = await loaded({ quality: null, dpr: 1.5, renderer, deviceMemory: 16, hardwareConcurrency: 16, maxRenderSize: 16384 });
    h.advance();
    assert.equal(h.node('#render-quality').value, 'auto');
    assert.match(h.node('#quality-status').textContent, /自动·节能/);
    assert.match(h.textureRequests[0].url, /flow-standard/);
    resolution(h.frames, 1280, 720);
  }
  const invalid = await loaded({ quality: 'obsolete-quality-name' });
  assert.equal(invalid.node('#render-quality').value, 'auto');
  for (const [quality,width,height] of [['eco',1280,720],['standard',1600,900],['high',1920,1080],['ultra',2880,1620],['cinematic',3840,2160]]) {
    const h = await loaded({ quality, coarse: true, deviceMemory: 2, dpr: 1.5 });
    h.advance();
    assert.equal(h.node('#render-quality').value, quality);
    assert.equal(h.context.localStorage.getItem('noxevyr-quality'), quality);
    resolution(h.frames,width,height);
  }
});

for (const [pastHero, fps] of [[false, 24]]) {
  await test(`standard quality preserves half-float dark detail, its 1.44M pixel budget and ${fps} fps cadence`, async () => {
    const h = await loaded({ quality: 'standard', halfFloat: true, dpr: 2, pastHero });
    const firstTickAt = h.now + RAF_MS;
    h.run(240);
    resolution(h.frames, 1600, 900);
    cadence(h.frames, fps);
    assert.ok(h.frames.length >= fps * 2 - 1 && h.frames.length <= fps * 2);
    assert.ok(h.renderPasses.filter(pass => pass.framebuffer).every(pass => pass.type === 36193),
      'standard lowers resolution and material size without quantizing away faint streams');
    assert.ok(h.frames.every(frame => frame.width * frame.height <= 1440000));
    for (const frame of h.frames) almostEqual(frame.time, (frame.at - firstTickAt) / 1000, 'standard follows wall time');
  });
}

await test('standard caps DPR at 1.5 even when its pixel budget has headroom', async () => {
  const h = await loaded({ quality: 'standard', dpr: 3, sceneWidth: 640, sceneHeight: 360 });
  h.advance();
  resolution(h.frames, 960, 540);
  assert.ok(h.renderPasses.filter(pass => pass.framebuffer).every(pass => pass.type === h.gl.UNSIGNED_BYTE),
    'RGBA8 remains available when half-float support is absent');
});

await test('serial material loading uploads matching Images directly and releases decoded-image references', async () => {
  for (const quality of ['standard', 'high']) {
    const h = harness({ quality });
    assert.equal(h.images.length, 1, 'only one decoder is active');
    assert.match(h.textureRequests[0].url, quality === 'standard' ? /flow-standard\.png/ : /plasma-flow\.png/);
    await h.load(0);
    assert.equal(h.images.length, 2);
    assert.equal(h.images[0].onload, null);
    assert.equal(h.images[0].onerror, null);
    assert.ok(h.images[0].removed.includes('src'));
    assert.equal(h.textureUploads[0].fromImage, true, 'POT flow texture needs no staging canvas');
    assert.equal(h.scratchCanvases.length, 0, 'flow upload should avoid a redundant 32 MiB canvas');
    await h.load(1);
    assert.ok(h.images.every(image => image.onload === null && image.onerror === null && image.removed.includes('src')));
    assert.equal(h.textureUploads.length, 2);
    assert.deepEqual(h.textureUploads.map(upload => [upload.width, upload.height]),
      quality === 'standard' ? [[2048, 1024], [1024, 512]] : [[4096, 2048], [2048, 1024]]);
    if (quality === 'standard') {
      assert.equal(h.scratchCanvases.length, 0, 'pre-sized standard textures avoid all staging canvases');
      assert.ok(h.textureUploads.every(upload => upload.fromImage));
    } else {
      assert.equal(h.scratchCanvases.length, 1, 'only the non-POT turbulence image needs normalization');
      assert.ok(h.scratchCanvases.every(scratch => scratch.width <= 1 && scratch.height <= 1), 'staging buffers are released');
    }
  }
});

await test('direct quality selection commits only completed material switches and reuses shared materials', async () => {
  const h = await loaded({ quality: null, dpr: 1.5 });
  h.advance();
  const firstMaterials = h.resources.texture.filter(texture => !texture.isTarget);
  await h.selectQuality('standard');
  await h.settle();
  assert.equal(h.context.localStorage.getItem('noxevyr-quality'), 'standard');
  assert.equal(h.textureRequests.length, 2, 'eco to standard shares the same uploaded materials');
  assert.equal(h.node('#render-quality').disabled, false);

  await h.selectQuality('high');
  await h.settle();
  assert.equal(h.node('#render-quality').disabled, true);
  assert.equal(h.context.localStorage.getItem('noxevyr-quality'), 'standard', 'pending mode is not persisted');
  assert.equal(h.textureRequests.length, 3, 'only replacement flow starts first');
  const during = h.frames.length;
  h.run(60);
  assert.ok(h.frames.length > during, 'previous materials continue rendering during downloads');
  resolution(h.frames.slice(during), 1600, 900);
  await h.selectQuality('cinematic');
  await h.settle();
  assert.equal(h.textureRequests.length, 3, 'even programmatic rapid clicks cannot enqueue duplicate material batches');
  assert.ok(firstMaterials.every(texture => !texture.deleted), 'old materials remain usable until replacement is complete');
  await h.loadRequest(2);
  assert.equal(h.textureRequests.length, 4);
  assert.equal(h.context.localStorage.getItem('noxevyr-quality'), 'standard');
  await h.loadRequest(3);
  assert.equal(h.context.localStorage.getItem('noxevyr-quality'), 'high');
  assert.equal(h.node('#render-quality').disabled, false);
  assert.ok(firstMaterials.every(texture => texture.deleted), 'successful switch deletes both previous material handles');
  const highFrom = h.frames.length;
  h.run(24);
  resolution(h.frames.slice(highFrom), 1920, 1080);

  await h.selectQuality('ultra');
  await h.settle();
  assert.equal(h.context.localStorage.getItem('noxevyr-quality'), 'ultra');
  assert.equal(h.textureRequests.length, 4, 'high to ultra does not decode images again');
  await h.selectQuality('auto');
  await h.settle();
  assert.equal(h.context.localStorage.getItem('noxevyr-quality'), 'ultra');
  assert.equal(h.textureRequests.length, 5);
  await h.loadRequest(4);
  await h.loadRequest(5);
  assert.equal(h.context.localStorage.getItem('noxevyr-quality'), 'auto');
  assert.equal(h.node('#render-quality').value, 'auto');
  assert.equal(h.resources.texture.filter(texture => !texture.deleted).length, 5, 'only three RT and two material textures remain live');
  assert.ok(h.peakLiveTextures <= 7, 'at most one previous and one replacement material pair coexist');
});

for (const paused of [true, false]) {
  await test(`asynchronous material switches preserve camera and ${paused ? 'paused' : 'running'} animation`, async () => {
    const h = await loaded({ quality: 'standard', paused });
    h.run(25);
    h.key('ArrowLeft');
    h.run(12);
    const previous = h.frames.at(-1);
    const preference = h.context.localStorage.getItem('noxevyr-motion');
    await h.selectQuality('high');
    await h.settle();
    h.run(120);
    await h.loadRequest(2);
    h.run(120);
    await h.loadRequest(3);
    h.run(12);
    const current = h.frames.at(-1);
    for (const uniform of ['eye', 'right', 'up']) assert.deepEqual(current[uniform], previous[uniform]);
    assert.equal(h.context.localStorage.getItem('noxevyr-motion'), preference);
    assert.equal(h.node('#motion-toggle').getAttribute('aria-pressed'), String(paused));
    if (paused) {
      almostEqual(current.time, previous.time, 'material downloads cannot unpause the scene');
      assert.equal(h.pending, 0);
    } else {
      assert.ok(current.time > previous.time + 1.8, 'animation continues while new materials download');
    }
  });
}

await test('standard to high reuses same-size render targets and preserves half-float precision', async () => {
  const h = await loaded({ quality: 'standard', halfFloat: true, sceneWidth: 640, sceneHeight: 360, dpr: 1 });
  h.advance();
  resolution(h.frames, 640, 360);
  const initialTargets = new Set(h.targetAllocations.filter(target => target.type === 36193).map(target => target.texture));
  assert.equal(initialTargets.size, 3);
  const allocationCount = h.targetAllocations.length;
  const targetHandles = h.resources.texture.filter(texture => texture.isTarget);
  await h.selectQuality('high');
  await h.settle();
  await h.loadRequest(2);
  await h.loadRequest(3);
  const from = h.renderPasses.length;
  h.run(12);
  resolution(h.frames, 640, 360);
  assert.ok(h.renderPasses.slice(from).filter(pass => pass.framebuffer).every(pass => pass.type === 36193));
  assert.equal(h.targetAllocations.length, allocationCount, 'same dimensions and format do not reallocate render targets');
  assert.deepEqual(h.resources.texture.filter(texture => texture.isTarget), targetHandles,
    'material changes do not create unnecessary render-target handles');
});

await test('failed quality download deletes staged textures and retains the previous working mode', async () => {
  const h = await loaded({ quality: 'standard', halfFloat: true });
  h.run(13);
  const oldMaterials = h.resources.texture.filter(texture => !texture.isTarget);
  const originalPreference = h.context.localStorage.getItem('noxevyr-quality');
  await h.selectQuality('high');
  await h.settle();
  await h.loadRequest(2);
  const stagedMaterials = h.resources.texture.filter(texture => !texture.isTarget && !oldMaterials.includes(texture));
  assert.equal(stagedMaterials.length, 2);
  await h.failRequest(3);
  await h.failRequest(4);
  assert.equal(h.context.localStorage.getItem('noxevyr-quality'), originalPreference);
  assert.equal(h.node('#render-quality').disabled, false);
  assert.equal(h.node('#blackhole-canvas').hidden, false, 'a replacement network failure must not discard working rendering');
  assert.equal(h.node('.hero-scene').dataset.failure, undefined);
  assert.ok(oldMaterials.every(texture => !texture.deleted));
  assert.ok(stagedMaterials.every(texture => texture.deleted));
  assert.ok(h.images.every(image => image.onload === null && image.onerror === null && image.removed.includes('src')));
  const from = h.frames.length;
  h.run(120);
  assert.ok(h.frames.length > from, 'old rendering continues after download failure');
  assert.equal(h.resources.texture.filter(texture => !texture.deleted).length, 5);
  await h.selectQuality('high');
  await h.settle();
  await h.loadRequest(5);
  await h.loadRequest(6);
  assert.equal(h.context.localStorage.getItem('noxevyr-quality'), 'high', 'a later retry can still succeed');
  assert.ok(h.peakLiveTextures <= 7, 'failed and successful retry batches cannot accumulate GPU handles');
});

await test('initialization failure releases allocated GPU resources and staging buffers', async () => {
  const h = harness({ quality: 'high', allowFallback: true });
  await h.loadRequest(0);
  await h.failRequest(1);
  await h.failRequest(2);
  fallbackState(h, 'texture');
  for (const kind of ['texture', 'framebuffer', 'program', 'buffer']) {
    assert.ok(h.resources[kind].every(resource => resource.deleted), `failed startup must delete all ${kind} resources`);
  }
  assert.ok(h.images.every(image => image.onload === null && image.onerror === null && image.removed.includes('src')));
  assert.ok(h.node('#blackhole-canvas').width <= 1 && h.node('#blackhole-canvas').height <= 1,
    'failed scenes do not retain a large drawing buffer');
});

await test('offscreen hero keeps its last image, cancels RAF and excludes frozen time on return', async () => {
  for(const paused of [false,true]){
    const h=await loaded({paused});h.run(24);
    h.scroll(900);h.advance();
    const before=h.frames.length,last=h.frames.at(-1);
    assert.equal(h.pending,0);
    const requests=h.requests;h.run(1200);
    assert.equal(h.frames.length,before,'reading projects must submit zero additional GPU frames');
    assert.equal(h.requests,requests,'frozen background must have no RAF polling loop');
    h.context.emit('resize');h.run(12);
    assert.equal(h.frames.length,before,'offscreen resize must defer drawing-buffer changes');
    h.scroll(0);h.run(12);
    assert.ok(h.frames.length>before,'returning to the hero restores the same scheduler');
    assert.ok(Math.abs(h.frames[before].time-last.time)<1/30+.001,'frozen time cannot jump the plasma animation');
    assert.equal(h.node('#motion-toggle').getAttribute('aria-pressed'),String(paused));
  }
});

await test('direct project entry draws a frozen background once and resumes after BFCache and return', async () => {
  const h=await loaded({pastHero:true});h.run(120);
  assert.equal(h.frames.length,1,'deep-link entry still has the complete 3D background');
  assert.equal(h.pending,0);
  h.context.emit('pagehide');h.run(120);h.context.emit('pageshow');h.run(120);
  assert.equal(h.frames.length,1,'BFCache restoration below the hero stays frozen');
  h.scroll(0);h.run(120);
  assert.ok(h.frames.length>1);
});

await test('eco preserves all passes at 20 FPS and uses 24 FPS during input', async () => {
  const h=await loaded({quality:'eco',dpr:2,halfFloat:true});h.run(240);
  resolution(h.frames,1280,720);cadence(h.frames,20);
  assert.equal(h.frames.length,40);
  assert.ok(h.renderPasses.filter(pass=>pass.framebuffer).every(pass=>pass.type===36193));
  const start=h.frames.length;
  for(let i=0;i<120;i++){h.key('ArrowLeft');h.advance();}
  cadence(h.frames.slice(start),24);
  assert.ok(h.frames.length-start>=23,'interaction temporarily increases responsiveness');
});

await test('auto responds only to sustained overload, recovers slowly and does not alter manual modes', async () => {
  for(const gpuDuration of [null,65]){
    const h=await loaded({quality:null,gpuDuration});h.advance();
    const overload=count=>{for(let i=0;i<count;i++)h.advance(160);};
    overload(12);resolution(h.frames,1280,720);
    assert.match(h.node('#quality-status').textContent,/20 FPS/,'short stalls do not change cadence');
    overload(12);resolution(h.frames,1280,720);
    assert.match(h.node('#quality-status').textContent,/16 FPS/,'first overload response preserves detail');
    overload(20);resolution(h.frames,1280,720);
    assert.match(h.node('#quality-status').textContent,/12 FPS/,'second overload response still preserves detail');
    overload(44);
    assert.ok(h.frames.at(-1).width<1280,'resolution falls only after reaching the minimum idle cadence');
    const low=h.frames.at(-1).width;assert.ok(low>=896,'automatic downscaling is bounded');
    if(gpuDuration!==null){assert.ok(h.gpuTimings>0);h.setGpuDuration(10);}
    h.run(120*10);
    assert.equal(h.frames.at(-1).width,low,'recovery waits longer than overload detection');
    h.run(120*24);
    assert.equal(h.frames.at(-1).width,1280,'sustained spare time restores the eco ceiling');
    assert.match(h.node('#quality-status').textContent,/12 FPS/,'resolution recovers before the idle frame cap');
    h.run(120*30);
    assert.match(h.node('#quality-status').textContent,/20 FPS/,'only sustained spare capacity restores higher idle cadence');
    await h.selectQuality('eco');
    if(gpuDuration!==null)h.setGpuDuration(100);
    const from=h.frames.length;
    for(let i=0;i<200;i++)h.advance(150);
    resolution(h.frames.slice(from),1280,720);
    assert.equal(h.node('#render-quality').value,'eco','manual choice stays explicit');
  }
});

await test('measured moderate GPU pressure preserves 85 percent resolution at 12 FPS without repeated quality changes', async () => {
  const h=await loaded({quality:null,gpuDuration:width=>80*(width/1280)**2});
  h.run(120*15);
  assert.equal(h.frames.at(-1).width,1088);
  assert.match(h.node('#quality-status').textContent,/12 FPS/);
  const start=h.frames.length;h.run(120*30);
  resolution(h.frames.slice(start),1088,612);cadence(h.frames.slice(start),12);
  assert.match(h.node('#quality-status').textContent,/12 FPS/,'moderate pressure cannot incorrectly recover a higher idle cap');
  const interactionStart=h.frames.length;
  for(let i=0;i<120;i++){h.key('ArrowLeft');h.advance();}
  assert.ok(h.frames.length-interactionStart>=23,'auto retains the 24 FPS interaction cap');
  resolution(h.frames.slice(interactionStart),1088,612);
});

await test('recovery predicts the next pixel and frame budgets instead of oscillating under constant GPU load', async () => {
  for(const [cost,width] of [[value=>66.25*(value/1280)**2,1088],[47.5,1280]]){
    const h=await loaded({quality:null,gpuDuration:cost});h.run(120*15);
    assert.equal(h.frames.at(-1).width,width);
    assert.match(h.node('#quality-status').textContent,/12 FPS/);
    const start=h.frames.length;h.run(120*180);
    resolution(h.frames.slice(start),width,width===1088?612:720);
    cadence(h.frames.slice(start),12);
    assert.match(h.node('#quality-status').textContent,/12 FPS/,'a constant workload cannot trigger repeated upward probes');
  }
});

await test('RAF fallback ignores its own FPS cap and needs genuine delivery headroom before recovery', async () => {
  const h=await loaded({quality:null});
  for(let i=0;i<80;i++)h.advance(100);
  assert.match(h.node('#quality-status').textContent,/12 FPS/);
  const start=h.frames.length;
  for(let i=0;i<1500;i++)h.advance(100);
  resolution(h.frames.slice(start),1280,720);
  assert.match(h.node('#quality-status').textContent,/12 FPS/,'constant 100ms callback delivery cannot recover a 16 FPS target');
  h.run(120*40);
  assert.match(h.node('#quality-status').textContent,/20 FPS/,'normally delivered RAF still recovers without a GPU extension');
});

await test('invalid GPU timings and hidden intervals cannot lower automatic resolution', async () => {
  const h=await loaded({quality:null,gpuDuration:200,gpuDisjoint:true});
  h.run(120*15);resolution(h.frames,1280,720);
  h.setHidden(true);h.advance(30000);h.setHidden(false);h.run(120*4);
  resolution(h.frames,1280,720);
});

await test('steady rendering caches layout and cinematic supersampling has a strict memory budget', async () => {
  const h=await loaded({quality:'cinematic',sceneWidth:3840,sceneHeight:2160,dpr:2,maxRenderSize:16384,halfFloat:true});
  h.advance();const reads=h.layoutReads;h.run(120*5);
  assert.equal(h.layoutReads,reads,'steady rendering must not read layout on each frame');
  assert.ok(h.frames.every(frame=>frame.width*frame.height<=11796480));
  assert.ok(h.frames[0].width>3840,'extreme tier can supersample beyond the ultra 4K ceiling');
  const allocatedBytes=h.targetAllocations.reduce((total,target)=>total+target.width*target.height*8,0);
  assert.ok(allocatedBytes<102*1024*1024,'three half-float targets stay below 102 MiB');
  h.context.emit('resize');h.run(12);assert.ok(h.layoutReads>reads,'resize invalidates cached layout');
});

await test('cinematic improves sampling over ultra even in a small DPR 2 viewport', async () => {
  const h=await loaded({quality:'ultra',sceneWidth:960,sceneHeight:540,dpr:2});
  h.advance();resolution(h.frames,2880,1620);
  const start=h.frames.length;await h.selectQuality('cinematic');h.run(12);
  resolution(h.frames.slice(start),3840,2160);
  assert.equal(h.textureRequests.length,2,'extra sampling reuses the original material pair');
});

console.log('All render scheduler regressions passed.');
