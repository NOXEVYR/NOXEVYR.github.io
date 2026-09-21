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
    width: 0, height: 0, offsetHeight: 900, hidden: false, inert: false, dataset: {},
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
} = {}) {
  const nodes = new Map();
  const pending = new Map();
  const images = [];
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
  const outsideElements = [node('#project-dialog'), element()];
  const gl = {};
  const constants = `MAX_TEXTURE_SIZE MAX_RENDERBUFFER_SIZE UNSIGNED_BYTE VERTEX_SHADER
    FRAGMENT_SHADER COMPILE_STATUS LINK_STATUS FRAMEBUFFER_COMPLETE TEXTURE_2D
    TEXTURE_MIN_FILTER TEXTURE_MAG_FILTER LINEAR TEXTURE_WRAP_S TEXTURE_WRAP_T
    CLAMP_TO_EDGE FRAMEBUFFER COLOR_ATTACHMENT0 RGBA ARRAY_BUFFER STATIC_DRAW FLOAT
    TEXTURE0 TEXTURE1 TEXTURE2 TEXTURE3 TRIANGLES UNPACK_COLORSPACE_CONVERSION_WEBGL
    NONE UNPACK_PREMULTIPLY_ALPHA_WEBGL REPEAT LINEAR_MIPMAP_LINEAR`.split(/\s+/);
  constants.forEach((name, index) => { gl[name] = index + 1; });
  const noops = `shaderSource compileShader deleteShader attachShader bindAttribLocation
    linkProgram bindTexture texParameteri bindFramebuffer framebufferTexture2D texImage2D
    bindBuffer bufferData enableVertexAttribArray vertexAttribPointer activeTexture
    useProgram viewport uniform1i uniform2f pixelStorei generateMipmap`.split(/\s+/);
  noops.forEach(name => { gl[name] = () => {}; });
  ['createShader', 'createProgram', 'createTexture', 'createFramebuffer', 'createBuffer']
    .forEach(name => { gl[name] = () => ({}); });
  Object.assign(gl, {
    getParameter: () => 4096,
    getExtension: () => null,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    checkFramebufferStatus: () => gl.FRAMEBUFFER_COMPLETE,
    getUniformLocation: (_program, name) => name,
    uniform1f: (name, value) => uniforms.set(name, value),
    uniform3fv: (name, value) => uniforms.set(name, Array.from(value)),
    drawArrays() {
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
  node('#blackhole-canvas').getContext = () => gl;
  const document = {
    ...eventTarget(), hidden,
    body: element(), documentElement: element(),
    currentScript: { src: 'https://example.test/blackhole.js?test=1' },
    querySelector: node,
    querySelectorAll(selector) {
      if (selector === 'body > :not(main):not(.hero-scene):not(.cosmic-veil), main > :not(#home)') return outsideElements;
      if (selector === '[data-orbit-inert]') return outsideElements.filter(el => el.dataset.orbitInert);
      return [];
    },
    createElement: () => ({ getContext: () => ({ drawImage() {} }) }),
  };
  const reduced = { ...eventTarget(), matches: paused };
  const context = {
    ...eventTarget(), document, URL, Promise, Float32Array, MutationObserver,
    console: { warn: (...args) => { throw new Error(args.join(' ')); } },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    matchMedia: () => reduced,
    scrollY: pastHero ? 900 : 0,
    devicePixelRatio: dpr,
    scrollTo() {},
    Image: class { constructor() { images.push(this); } },
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
  assert.equal(node('#blackhole-canvas').hidden, false, 'WebGL setup must succeed');

  return {
    document, context, frames, node,
    get pending() { return pending.size; },
    get now() { return now; },
    get requests() { return rafRequests; },
    async load(index) {
      assert.ok(images[index], `texture ${index} was requested`);
      images[index].onload();
      // Flush Promise.all plus the script's texture-ready continuation.
      await Promise.resolve();
      await Promise.resolve();
    },
    advance(milliseconds = RAF_MS) {
      now += milliseconds;
      const callbacks = [...pending.entries()];
      for (const [id, callback] of callbacks) {
        if (!pending.delete(id)) continue;
        callback(now);
      }
      assert.equal(node('#blackhole-canvas').hidden, false, 'draw must not enter fallback');
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

console.log('All render scheduler regressions passed.');
