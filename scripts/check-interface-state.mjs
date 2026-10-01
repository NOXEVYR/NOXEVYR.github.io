// DOM-only behavior checks. No browser, canvas, network or GPU is started.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/horizon.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/horizon.html', import.meta.url), 'utf8');

function harness(catalog) {
  let document;
  class Element {
    constructor() {
      this.listeners = new Map(); this.attrs = new Map(); this.children = new Map();
      this.hidden = true; this.disabled = false; this.dataset = {}; this.style = {};
      this.isConnected = true; this.textContent = ''; this.native = false;
      this.classList = {contains: () => false};
    }
    addEventListener(type, callback) {
      const callbacks = this.listeners.get(type) || [];
      callbacks.push(callback); this.listeners.set(type, callbacks);
    }
    fire(type, extras = {}) {
      const event = {target: this, clientX: 200, clientY: 200, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() {}, ...extras};
      for (const callback of this.listeners.get(type) || []) callback(event);
      return event;
    }
    setAttribute(name, value) { this.attrs.set(name, String(value)); }
    getAttribute(name) { return this.attrs.get(name) ?? null; }
    querySelector(selector) {
      if (!this.children.has(selector)) this.children.set(selector, new Element());
      return this.children.get(selector);
    }
    querySelectorAll() { return this.items || []; }
    closest(selector) {
      if (selector === '[data-page-action]') return this.dataset.pageAction ? this : null;
      if (selector === 'a, img, picture, video, audio, input, textarea, select') return this.native ? this : null;
      return null;
    }
    append(child) { this.appended = child; }
    contains(target) { return this === target || (this.items || []).includes(target); }
    getBoundingClientRect() { return {left: 0, top: 0, width: 220, height: 260}; }
    focus() { document.activeElement = this; }
    click() { this.fire('click'); }
  }
  document = new Element(); document.body = new Element(); document.activeElement = document.body;
  const icon = new Element(); icon.dataset.icon = 'example'; icon.src = 'built-icon.png';
  document.querySelectorAll = () => [icon];
  const pageMenu = document.querySelector('#page-context-menu');
  pageMenu.items = ['refresh', 'top', 'quality', 'motion', 'reset'].map(action => {
    const item = pageMenu.querySelector(`[data-page-action="${action}"]`);
    item.dataset.pageAction = action;
    return item;
  });
  const dialog = document.querySelector('#project-dialog'); dialog.open = false;
  const window = new Element(); window.PORTFOLIO = catalog; window.matchMedia = () => new Element();
  window.getSelection = () => ({toString: () => ''}); window.scrollTo = () => {};
  let reloads = 0; window.location = {reload() { reloads++; }};
  const context = {window, document, Element, innerWidth: 390, innerHeight: 844,
    MutationObserver: class { observe() {} }};
  vm.runInNewContext(source, context, {filename: 'horizon.js'});
  return {window, document, pageMenu, icon, Element, reloads: () => reloads};
}

let cases = 0;
for (const catalog of [undefined, null, {}, {projects: {}}, {projects: [null]}, {projects: []}]) {
  const h = harness(catalog);
  assert.equal(h.icon.src, 'built-icon.png', 'missing data must keep the build-time icon');
  h.document.querySelector('#menu-toggle').click();
  assert.equal(h.document.querySelector('#mobile-menu').hidden, false, 'navigation works without catalog');
  const event = h.document.fire('contextmenu', {target: new h.Element()});
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.pageMenu.hidden, false, 'themed page menu must still initialize');
  h.pageMenu.fire('click', {target: h.pageMenu.items[0]});
  assert.equal(h.reloads(), 1, 'refresh works without catalog');
  cases++;
}
{
  const h = harness({projects: [{id: 'example', icon: 'current-icon.png'}]});
  assert.equal(h.icon.src, 'current-icon.png');
  const link = new h.Element(); link.native = true;
  assert.equal(h.document.fire('contextmenu', {target: link}).defaultPrevented, false);
  assert.equal(h.document.fire('contextmenu', {target: new h.Element(), shiftKey: true}).defaultPrevented, false);
  h.window.getSelection = () => ({toString: () => 'selected text'});
  assert.equal(h.document.fire('contextmenu', {target: new h.Element()}).defaultPrevented, false);
  h.pageMenu.fire('click', {target: h.pageMenu.items[4]});
  assert.equal(h.document.querySelector('#render-details').open, true, 'menu reset reveals its control before focusing');
  assert.equal(h.document.activeElement, h.document.querySelector('#orbit-reset'));
  cases++;
}
assert.ok(html.indexOf('class="skip-link"') < html.indexOf('id="blackhole-canvas"'), 'skip link precedes interactive scene');
assert.ok(html.includes('id="collection-toolbar" class="collection-toolbar" hidden'), 'unenhanced filters stay hidden');
const details = html.match(/<details\b[^>]*id="render-details"[\s\S]*?<\/details>/)?.[0];
assert.ok(details?.includes('id="quality-metrics"'));
assert.ok(!details.includes('id="quality-reset"') && !details.includes('id="explore-hole"') && !details.includes('id="scene-retry"'), 'recovery and exit stay outside collapsed details');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'template IDs are unique');
console.log(`Passed ${cases} interface state cases plus focus, fallback and recovery-control structure checks (DOM mocks only).`);
