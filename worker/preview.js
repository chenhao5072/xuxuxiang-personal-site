// This entry point is used only by wrangler.preview.jsonc. It never reaches production data.
const cookieName = '__Host-winter-review';
const pathPrefix = '/__winter-review/';
const isolatedHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
};
const gateHeaders = {
  ...isolatedHeaders,
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
};
const gatePage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>冬日手记 · 审阅专用</title>
<style>html{min-height:100%;background:#dfe7e5;color:#233535;font:16px/1.6 system-ui,sans-serif}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(ellipse at 79% 58%,#f6dbba 0,transparent 62%)}main{width:min(380px,calc(100% - 52px));padding:clamp(18px,5vw,32px);box-sizing:border-box;background:#fffaf0;box-shadow:0 12px 45px #28444324}small{color:#805537;letter-spacing:.15em}h1{font:700 33px/1.3 serif;margin:12px 0}p{font-size:14px}label{display:block;font-size:13px}input,button{box-sizing:border-box;width:100%;font:inherit;padding:9px;border:1px solid #84928a;border-radius:4px;margin:4px 0}button{background:#263d3d;color:#fffaf0;cursor:pointer}#review-status:empty{display:none}</style>
<script src="/__winter-review/access.js" defer></script></head><body><main><small>WINTER NOTES / PRIVATE REVIEW</small><h1>冬日手记</h1><p>这是供确认设计的候选页。原网站和正式留言不受影响。</p><form id="review-form"><label for="review-key">预览钥匙</label><input id="review-key" type="password" maxlength="43" autocomplete="off" required><button type="submit">打开预览</button></form><p id="review-status" role="status"></p></main></body></html>`;
const gateScript = `(() => {
  const form = document.querySelector('#review-form');
  const keyField = document.querySelector('#review-key');
  const status = document.querySelector('#review-status');
  async function unlock(key) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(key)) { status.textContent = '预览钥匙不正确。'; return; }
    form.querySelector('button').disabled = true;
    status.textContent = '正在打开候选页…';
    try {
      const response = await fetch('/__winter-review/access', { method: 'POST', headers: { 'X-Preview-Key': key }, credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) { status.textContent = '钥匙无效或已过期，请索取新的预览链接。'; return; }
      location.replace('/');
    } catch { status.textContent = '无法打开预览，请重试。'; }
    finally { form.querySelector('button').disabled = false; }
  }
  form.addEventListener('submit', event => { event.preventDefault(); unlock(keyField.value.trim()); });
  const key = new URLSearchParams(location.hash.slice(1)).get('review');
  if (key) { history.replaceState(null, '', location.pathname); unlock(key); }
})();`;
const unauthorized = () => new Response('Private preview', {status:401,headers:isolatedHeaders});
async function keyMatches(candidate, env) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(candidate) || !/^[a-f0-9]{64}$/.test(env.REVIEW_SHA256 || '') || !(Date.now() < Number(env.REVIEW_EXPIRES))) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(candidate)));
  let delta = 0;
  for (let i = 0; i < digest.length; i++) delta |= digest[i] ^ Number.parseInt(env.REVIEW_SHA256.slice(i * 2, i * 2 + 2), 16);
  return delta === 0;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === pathPrefix + 'access.js' && request.method === 'GET') return new Response(gateScript, {headers:{...gateHeaders,'Content-Type':'text/javascript; charset=UTF-8'}});
    if (url.pathname === pathPrefix + 'access') {
      if (request.method !== 'POST' || request.headers.get('Origin') !== url.origin) return unauthorized();
      const key = request.headers.get('X-Preview-Key') || '';
      if (!await keyMatches(key, env)) return unauthorized();
      const maxAge = Math.max(1, Math.min(86400, Math.floor((Number(env.REVIEW_EXPIRES) - Date.now()) / 1000)));
      return new Response(null, {status:204,headers:{...isolatedHeaders,'Set-Cookie':cookieName+'='+key+'; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age='+maxAge}});
    }
    const key = (request.headers.get('Cookie') || '').split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || '';
    if (!await keyMatches(key, env)) {
      if (url.pathname === '/' && request.method === 'GET') return new Response(gatePage, {status:200,headers:{...gateHeaders,'Content-Type':'text/html; charset=UTF-8'}});
      return unauthorized();
    }
    if (url.pathname === '/api/guestbook') {
      // Deliberately empty and read-only: never bind to the production D1 database.
      return request.method === 'GET'
        ? Response.json({messages:[],total:0,token:''},{headers:isolatedHeaders})
        : Response.json({error:'预览不提交留言。'},{status:405,headers:{...isolatedHeaders,Allow:'GET'}});
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, {status:405, headers:{...isolatedHeaders,Allow:'GET, HEAD'}});
    const headers = new Headers(request.headers);
    headers.delete('Cookie');
    const asset = await env.ASSETS.fetch(new Request(url, {method:request.method,headers}));
    const protectedAsset = new Response(asset.body, asset);
    for (const [header, value] of Object.entries(isolatedHeaders)) protectedAsset.headers.set(header, value);
    return protectedAsset;
  },
};
