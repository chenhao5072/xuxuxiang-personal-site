import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import preview from '../worker/preview.js';

const key = 'a'.repeat(43);
const href = 'https://test.example';
const env = {
  REVIEW_SHA256: createHash('sha256').update(key).digest('hex'),
  REVIEW_EXPIRES: Date.now() + 90000,
  ASSETS: { fetch: async (request) => {
    assert.equal(request.headers.get('Cookie'), null);
    return new Response('private candidate');
  }}
};
const request = (path, {authed, ...init} = {}) => new Request(href + path, {...init, headers:{...init.headers,...(authed ? {Cookie:'__Host-winter-review='+key} : {})}});
test('preview does not expose assets or data without a valid ticket', async () => {
  const root = await preview.fetch(request('/'),env);
  assert.match(await root.text(), /审阅专用/);
  assert.equal(root.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
  for (const path of ['/index.html','/assets/photo-17-clean.webp','/api/guestbook']) {
    assert.equal((await preview.fetch(request(path),env)).status,401);
  }
});
test('preview issues a secure, short-lived cookie only on same-origin requests', async () => {
  const path = '/__winter-review/access';
  const headers = {'X-Preview-Key':key,Origin:href};
  assert.equal((await preview.fetch(request(path,{method:'POST',headers:{...headers,Origin:'https://elsewhere.example'}}),env)).status,401);
  const auth = await preview.fetch(request(path,{method:'POST',headers}),env);
  assert.equal(auth.status,204);
  assert.match(auth.headers.get('Set-Cookie'), /Secure; HttpOnly; SameSite=Strict; Path=\//);
  assert.equal((await preview.fetch(request(path,{method:'POST',headers}),{...env,REVIEW_EXPIRES:0})).status,401);
});
test('signed in preview uses private assets and has no writable guestbook', async () => {
  const get = await preview.fetch(request('/index.html',{authed:true}),env);
  assert.equal(await get.text(),'private candidate');
  assert.equal(get.headers.get('Cache-Control'),'private, no-store');
  assert.deepEqual(await (await preview.fetch(request('/api/guestbook',{authed:true}),env)).json(),{messages:[],total:0,token:''});
  assert.equal((await preview.fetch(request('/api/guestbook',{authed:true,method:'POST'}),env)).status,405);
});
