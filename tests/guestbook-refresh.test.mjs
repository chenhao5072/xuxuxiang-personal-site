import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const source = await readFile(new URL('../guestbook.js', import.meta.url), 'utf8');
const message = id => ({id, name: id, message: `留言 ${id}`, createdAt: '2026-10-15T00:00:00Z'});
const flush = async () => { for (let step = 0; step < 20; step++) await Promise.resolve(); };

function fixture() {
  let now = 100000;
  let nextTimer = 0;
  let feed = [message('a'), message('b')];
  let total = feed.length;
  const timers = new Map();
  const nodes = new Map();
  const requests = [];
  const documentEvents = new Map();
  const windowEvents = new Map();
  let nextRead;
  const events = () => ({
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    },
    listeners: new Map(),
    emit(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener(event); }
  });
  const node = selector => {
    if (nodes.has(selector)) return nodes.get(selector);
    const classes = new Set();
    const element = {
      ...events(), textContent: '', value: '', scrollTop: 0, hidden: false,
      attributes: new Map(),
      setAttribute(key, value) { this.attributes.set(key, value); },
      removeAttribute(key) { this.attributes.delete(key); },
      contains(other) { return other === this; }, focus() {},
      classList: {
        add(value) { classes.add(value); }, remove(value) { classes.delete(value); },
        contains(value) { return classes.has(value); },
        toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); }
      }
    };
    nodes.set(selector, element);
    return element;
  };
  const section = {querySelector: node};
  const addTimer = (callback, delay, interval = false) => {
    const id = ++nextTimer;
    timers.set(id, {callback, due: now + delay, delay, interval});
    return id;
  };
  const context = {
    document: {
      hidden: false, querySelector: () => section,
      addEventListener: (type, listener) => documentEvents.set(type, listener)
    },
    window: {
      matchMedia: () => ({matches: false, addEventListener() {}}),
      addEventListener: (type, listener) => windowEvents.set(type, listener),
      IntersectionObserver: true
    },
    navigator: {onLine: true},
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { this.callback([{isIntersecting: true}]); }
    },
    Date: class extends Date { static now() { return now; } },
    Intl, AbortController, crypto: webcrypto,
    setTimeout: (callback, delay) => addTimer(callback, delay),
    setInterval: (callback, delay) => addTimer(callback, delay, true),
    clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id),
    fetch: async (url, options) => {
      requests.push({url, options});
      if (options.method === 'POST') {
        const body = JSON.parse(options.body);
        const saved = {...message(body.submissionId), name: body.name, message: body.message};
        feed = [saved, ...feed];
        total++;
        return {ok: true, json: async () => ({message: saved, total})};
      }
      const result = nextRead ? await nextRead : {messages: feed.map(item => ({...item})), total, token: 'test-token'};
      nextRead = undefined;
      return {ok: true, json: async () => result};
    }
  };
  vm.runInNewContext(source, context);
  return {
    node, requests, context,
    setFeed(value, count = value.length) { feed = value; total = count; },
    deferRead(promise) { nextRead = promise; },
    windowEvent(type) { windowEvents.get(type)?.(); },
    visibility(hidden) { context.document.hidden = hidden; documentEvents.get('visibilitychange')?.(); },
    async advance(milliseconds) {
      const target = now + milliseconds;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.due <= target).sort((first, second) => first[1].due - second[1].due)[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.due;
        if (timer.interval) timer.due += timer.delay;
        else timers.delete(id);
        timer.callback();
        await flush();
      }
      now = target;
      await flush();
    }
  };
}

test('five-second polling and count updates do not restart seven-second rotation', async () => {
  const app = fixture();
  await flush();
  assert.equal(app.node('[data-guestbook-copy]').textContent, '留言 a');
  app.node('[data-guestbook-copy]').scrollTop = 42;
  app.setFeed([message('a'), message('b')], 8);
  await app.advance(5000);
  assert.equal(app.requests.length, 2);
  assert.equal(app.node('[data-guestbook-copy]').scrollTop, 42);
  assert.equal(app.node('[data-guestbook-total]').textContent, '已经留下 8 句问候');
  await app.advance(2000);
  assert.equal(app.node('[data-guestbook-copy]').textContent, '留言 b');
});

test('new arrivals appear promptly but preserve hovered reading and scroll position', async () => {
  const app = fixture();
  await flush();
  app.node('.guestbook-wall').emit('mouseenter');
  app.node('[data-guestbook-copy]').scrollTop = 88;
  app.setFeed([message('c'), message('a'), message('b')]);
  await app.advance(5000);
  assert.equal(app.node('[data-guestbook-copy]').textContent, '留言 a');
  assert.equal(app.node('[data-guestbook-copy]').scrollTop, 88);
  assert.equal(app.node('[data-guestbook-count]').textContent, '02 / 03');
  app.node('.guestbook-wall').emit('mouseleave');
  await app.advance(7000);
  assert.equal(app.node('[data-guestbook-copy]').textContent, '留言 b');
  app.setFeed([message('d'), message('c'), message('a'), message('b')]);
  await app.advance(3000);
  assert.equal(app.node('[data-guestbook-copy]').textContent, '留言 d');
});

test('tab return and network recovery refresh immediately without duplicate focus reads', async () => {
  const app = fixture();
  await flush();
  await app.advance(1000);
  app.visibility(true);
  await app.advance(5000);
  assert.equal(app.requests.length, 1);
  app.setFeed([message('c'), message('a'), message('b')]);
  app.visibility(false);
  app.windowEvent('focus');
  await flush();
  assert.equal(app.requests.length, 2);
  assert.equal(app.node('[data-guestbook-copy]').textContent, '留言 c');
  await app.advance(1000);
  app.setFeed([message('d'), message('c'), message('a'), message('b')]);
  app.windowEvent('online');
  await flush();
  assert.equal(app.requests.length, 3);
  assert.equal(app.node('[data-guestbook-copy]').textContent, '留言 d');
});

test('an older poll cannot overwrite a successfully submitted message', async () => {
  const app = fixture();
  await flush();
  let resolveRead;
  app.deferRead(new Promise(resolve => { resolveRead = resolve; }));
  await app.advance(5000);
  app.node('#guestbook-name').value = '新访客';
  app.node('#guestbook-text').value = '刚刚留下的问候';
  app.node('[data-guestbook-form]').emit('submit', {preventDefault() {}});
  await flush();
  assert.equal(app.node('[data-guestbook-copy]').textContent, '刚刚留下的问候');
  resolveRead({messages: [message('a'), message('b')], total: 2, token: 'old-token'});
  await flush();
  assert.equal(app.node('[data-guestbook-copy]').textContent, '刚刚留下的问候');
  assert.equal(app.node('[data-guestbook-total]').textContent, '已经留下 3 句问候');
});
