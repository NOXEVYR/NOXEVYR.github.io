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
} = {}) {
  const nodes = new Map();
  const pending = new Map();
  const images = [];
  const textureRequests = [];
  const targetAllocations = [];
  const renderPasses = [];
  const compiledShaders = [];
  const warnings = [];
  const frames = [];
  const uniforms = new Map();
  const storage = new Map();
  storage.set('noxevyr-quality', quality);
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
    node(selector).getBoundingClientRect = () => ({ left: 0, top: 0, width: sceneWidth, height: sceneHeight });
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
  Object.assign(gl, {
    getParameter: () => 4096,
    getExtension(name) {
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
    framebufferTexture2D: (_target, _attachment, _textureTarget, texture) => { boundFramebuffer.texture = texture; },
    texImage2D(...args) {
      if (args.length !== 9) return;
      Object.assign(boundTexture, { width: args[3], height: args[4], type: args[7] });
      targetAllocations.push({ texture: boundTexture, width: args[3], height: args[4], type: args[7] });
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
  node('#blackhole-canvas').getContext = () => contextAvailable ? gl : null;
  const document = {
    ...eventTarget(), hidden,
    body: element(), documentElement: element(),
    currentScript: { src: 'https://example.test/blackhole.js?test=1' },
    querySelector: node,
    querySelectorAll(selector) {
      if (selector === 'body > :not(main):not(.hero-scene):not(.cosmic-veil), main > :not(#home)') return outsideElements;
      if (selector === '[data-orbit-inert]') return outsideElements.filter(el => el.dataset.orbitInert);
      if (selector === '.orbit-controls button, #motion-toggle') return [...controls, node('#scene-retry')];
      if (selector === '.orbit-controls button') return [...orbitControls, node('#scene-retry')];
      return [];
    },
    createElement: () => ({ getContext: () => ({ drawImage() {} }) }),
  };
  const reduced = { ...eventTarget(), matches: paused };
  const context = {
    ...eventTarget(), document, URL, Promise, Float32Array, MutationObserver,
    console: { warn: (...args) => warnings.push(args) },
    location: { reload: () => { reloads++; } },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    matchMedia: () => reduced,
    scrollY: pastHero ? 900 : 0,
    devicePixelRatio: dpr,
    scrollTo() {},
    Image: class {
      constructor() { images.push(this); }
      get src() { return this.url; }
      set src(value) { this.url = value; textureRequests.push({ image: this, url: value }); }
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
  }

  return {
    document, context, frames, node, controls, orbitControls, textureRequests, targetAllocations,
    renderPasses, compiledShaders, warnings, gl,
    get pending() { return pending.size; },
    get now() { return now; },
    get requests() { return rafRequests; },
    get reloads() { return reloads; },
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
  await h.load(0);
  assert.equal(h.pending, 0, 'both textures are required');
  await h.load(1);
  assert.equal(h.frames.length, 0, 'texture completion must not draw synchronously');
  assert.equal(h.pending, 1);
  h.advance();
  assert.equal(h.frames.length, 1);
});

for (const [pastHero, fps] of [[false, 30], [true, 8]]) {
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

await test('DPR 1.5 uses 1920 × 1080 high and 2880 × 1620 ultra, including toggles', async () => {
  const h = await loaded({ dpr: 1.5 });
  h.run(13);
  resolution(h.frames, 1920, 1080);
  for (const [quality, width, height] of [['ultra', 2880, 1620], ['high', 1920, 1080]]) {
    const before = h.frames.length;
    h.node('#render-quality').emit('click');
    assert.equal(h.frames.length, before, 'quality change must use the shared scheduler');
    h.run(13);
    resolution(h.frames.slice(before), width, height);
    assert.equal(h.context.localStorage.getItem('noxevyr-quality'), quality);
  }
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
  assert.equal(h.textureRequests.length, 2);
  await h.failRequest(0);
  assert.equal(h.textureRequests.length, 3, 'only the failed texture gets one retry');
  assert.equal(new URL(h.textureRequests[2].url, 'https://example.test').pathname,
    new URL(h.textureRequests[0].url, 'https://example.test').pathname);
  assert.equal(h.node('#blackhole-canvas').hidden, false, 'first network failure must not enter fallback');
  await h.loadRequest(2);
  await h.loadRequest(1);
  assert.equal(h.frames.length, 0, 'retry completion still uses RAF');
  h.advance();
  assert.equal(h.frames.length, 1);
  assert.ok(h.controls.every(control => !control.disabled));
});

await test('two texture network failures stop cleanly and leave manual retry available', async () => {
  const h = harness({ allowFallback: true });
  await h.failRequest(0);
  await h.failRequest(2);
  assert.equal(h.textureRequests.length, 3, 'automatic texture retry is bounded to one');
  fallbackState(h, 'texture');
  await h.loadRequest(1);
  h.run(120);
  assert.equal(h.frames.length, 0, 'late success of another texture cannot revive a failed scene');
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

console.log('All render scheduler regressions passed.');
