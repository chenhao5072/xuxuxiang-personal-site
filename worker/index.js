const encoder = new TextEncoder();
const TOKEN_LIFETIME = 60 * 60 * 1000;
const MAX_BODY_BYTES = 4096;
const HOSTS = new Set(['xuxuxiang.fun', 'www.xuxuxiang.fun', 'xuxuxiang-personal.chenhao5072-377.workers.dev', '127.0.0.1', 'localhost']);
const publicMessage = row => ({id: row.id, name: row.name, message: row.message, createdAt: new Date(row.created_at).toISOString()});
function json(data, status = 200, headers = {}) {
  return Response.json(data, {status, headers: {
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'same-origin',
    ...headers,
  }});
}
const fail = (message, code, status, headers) => json({error: message, code}, status, headers);
function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function decode64(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
async function signingKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
}
async function digest(key, value) {
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
async function makeToken(key, identity, origin, now) {
  const payload = base64url(encoder.encode(JSON.stringify({iat: now, nonce: crypto.randomUUID(), identity, origin})));
  return payload + '.' + await digest(key, payload);
}
async function checkToken(key, token, identity, origin, now) {
  try {
    if (typeof token !== 'string' || token.length > 1200) return false;
    const [payload, signature, extra] = token.split('.');
    if (extra !== undefined || !payload || !signature) return false;
    if (!await crypto.subtle.verify('HMAC', key, decode64(signature), encoder.encode(payload))) return false;
    const data = JSON.parse(new TextDecoder().decode(decode64(payload)));
    return Number.isSafeInteger(data.iat) && data.iat <= now + 5000 && now - data.iat <= TOKEN_LIFETIME
      && data.identity === identity && data.origin === origin;
  } catch { return false; }
}
async function readBody(request) {
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) throw new RangeError('Body too large');
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Empty body');
  const chunks = [];
  let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new RangeError('Body too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
}
const clean = value => value.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim();

export async function guestbook(request, env) {
  const url = new URL(request.url);
  if (!HOSTS.has(url.hostname)) return fail('无法访问此留言板。', 'BAD_HOST', 403);
  if (!['GET', 'POST'].includes(request.method)) return fail('不支持此操作。', 'METHOD_NOT_ALLOWED', 405, {Allow: 'GET, POST'});
  if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) return fail('请从网站页面提交留言。', 'BAD_ORIGIN', 403);
  if (!env.GUESTBOOK_DB || !env.GUESTBOOK_SECRET) return fail('留言板暂时休息一下，请稍后再来。', 'UNAVAILABLE', 503);
  const now = Date.now();
  const key = await signingKey(env.GUESTBOOK_SECRET);
  // Only an HMAC fingerprint is saved for rate limiting; raw IP addresses are never persisted.
  const identity = await digest(key, 'visitor:' + (request.headers.get('CF-Connecting-IP') || 'local'));
  if (request.method === 'GET') {
    const result = await env.GUESTBOOK_DB.batch([
      env.GUESTBOOK_DB.prepare('SELECT id,name,message,created_at FROM guestbook_messages WHERE hidden=0 ORDER BY created_at DESC,id DESC LIMIT 30'),
      env.GUESTBOOK_DB.prepare('SELECT visible_total AS total FROM guestbook_stats WHERE id=1'),
    ]);
    return json({messages: result[0].results.map(publicMessage), total: result[1].results[0].total, token: await makeToken(key, identity, url.origin, now)});
  }
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) return fail('请使用网页表单提交留言。', 'BAD_CONTENT_TYPE', 415);
  let body;
  try { body = await readBody(request); }
  catch (error) { return fail(error instanceof RangeError ? '留言内容过大。' : '留言格式不正确，请重新提交。', 'BAD_BODY', error instanceof RangeError ? 413 : 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('留言格式不正确。', 'BAD_BODY', 400);
  if (typeof body.website !== 'string' || body.website !== '') return fail('未能提交，请刷新页面后重试。', 'SPAM_REJECTED', 400);
  if (!await checkToken(key, body.token, identity, url.origin, now)) return fail('页面停留有点久了，正在刷新留言板，请再试一次。', 'TOKEN_EXPIRED', 403);
  if (typeof body.name !== 'string' || typeof body.message !== 'string') return fail('请填写有效的昵称和留言。', 'INVALID_MESSAGE', 400);
  const name = clean(body.name).replace(/\s+/g, ' ') || '路过的朋友';
  const message = clean(body.message).replace(/\r\n?/g, '\n');
  if ([...name].length > 20 || [...message].length < 1 || [...message].length > 200) return fail('昵称最多20字，留言请写1至200字。', 'INVALID_MESSAGE', 400);
  if (typeof body.submissionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.submissionId)) return fail('请刷新页面后重新提交。', 'INVALID_SUBMISSION', 400);
  if ((message.match(/https?:\/\//gi) || []).length > 2) return fail('留言里的链接有点多，请精简后再试。', 'SPAM_REJECTED', 400);
  const fingerprint = await digest(key, 'message:' + message);
  const existing = await env.GUESTBOOK_DB.prepare('SELECT * FROM guestbook_messages WHERE submission_id=?').bind(body.submissionId).first();
  if (existing) {
    if (existing.ip_hash !== identity || existing.name !== name || existing.message !== message || existing.hidden) return fail('这条提交已处理，请刷新后重新留言。', 'SUBMISSION_CONFLICT', 409);
    const total = await env.GUESTBOOK_DB.prepare('SELECT visible_total AS total FROM guestbook_stats WHERE id=1').first('total');
    return json({message: publicMessage(existing), total});
  }
  const dayStart = Math.floor(now / 86400000) * 86400000;
  const id = crypto.randomUUID();
  // A single conditional INSERT is atomic in SQLite: concurrent visitors cannot bypass the limits.
  const inserted = await env.GUESTBOOK_DB.prepare(`
    INSERT INTO guestbook_messages(id,submission_id,name,message,created_at,ip_hash,content_hash)
    SELECT ?1,?2,?3,?4,?5,?6,?7
    WHERE (SELECT total FROM guestbook_stats WHERE id=1) < 5000
      AND NOT EXISTS(SELECT 1 FROM guestbook_messages WHERE ip_hash=?6 AND created_at>?8)
      AND (SELECT COUNT(*) FROM guestbook_messages WHERE ip_hash=?6 AND created_at>?9) < 5
      AND (SELECT COUNT(*) FROM guestbook_messages WHERE created_at>=?10) < 200
      AND NOT EXISTS(SELECT 1 FROM guestbook_messages WHERE ip_hash=?6 AND content_hash=?7 AND created_at>?11)
    ON CONFLICT(submission_id) DO NOTHING
    RETURNING id,name,message,created_at
  `).bind(id,body.submissionId,name,message,now,identity,fingerprint,now-60000,now-3600000,dayStart,now-86400000).first();
  if (!inserted) {
    const raced = await env.GUESTBOOK_DB.prepare('SELECT * FROM guestbook_messages WHERE submission_id=?').bind(body.submissionId).first();
    if (raced && raced.ip_hash === identity && raced.name === name && raced.message === message && !raced.hidden) {
      const total = await env.GUESTBOOK_DB.prepare('SELECT visible_total AS total FROM guestbook_stats WHERE id=1').first('total');
      return json({message: publicMessage(raced), total});
    }
    if (raced) return fail('这条提交已处理，请刷新后重新留言。', 'SUBMISSION_CONFLICT', 409);
    const stats = await env.GUESTBOOK_DB.prepare('SELECT total FROM guestbook_stats WHERE id=1').first();
    if (stats.total >= 5000) return fail('留言册暂时写满了，谢谢你留下的心意。', 'BOOK_FULL', 503);
    const last = await env.GUESTBOOK_DB.prepare('SELECT created_at FROM guestbook_messages WHERE ip_hash=? ORDER BY created_at DESC LIMIT 1').bind(identity).first();
    const retryAfter = last && last.created_at > now-60000 ? Math.max(1, Math.ceil((last.created_at+60000-now)/1000)) : 3600;
    return fail('慢一点，一会儿再来留句话吧。', 'RATE_LIMITED', 429, {'Retry-After': String(retryAfter)});
  }
  const total = await env.GUESTBOOK_DB.prepare('SELECT visible_total AS total FROM guestbook_stats WHERE id=1').first('total');
  return json({message: publicMessage(inserted), total}, 201);
}

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api/guestbook') {
      try { return await guestbook(request, env); }
      catch { return fail('留言板暂时休息一下，内容仍保存在输入框里，请稍后重试。', 'UNAVAILABLE', 503); }
    }
    if (pathname.startsWith('/api/')) return fail('没有这个接口。', 'NOT_FOUND', 404);
    return env.ASSETS.fetch(request);
  },
};
