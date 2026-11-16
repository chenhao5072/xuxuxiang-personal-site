import {test, beforeEach, afterEach, mock} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import worker from '../worker/index.js';

let database, env, clock;
const origin = 'https://xuxuxiang.fun';
function prepare(sql, values = []) {
  return {
    bind(...args) { return prepare(sql, args); },
    async first(column) {
      const row = execute(sql, values)[0] || null;
      return column ? row?.[column] ?? null : row;
    },
  };
}
function execute(sql, values) {
  const numbered = [...sql.matchAll(/\?(\d+)/g)];
  const args = numbered.length ? numbered.map(match => values[Number(match[1])-1]) : values;
  const statement = database.prepare(sql.replace(/\?\d+/g, '?'));
  if (/^\s*SELECT/i.test(sql) || /RETURNING/i.test(sql)) return statement.all(...args);
  statement.run(...args);
  return [];
}
beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec(fs.readFileSync(new URL('../migrations/0001_guestbook.sql', import.meta.url), 'utf8'));
  clock = Date.parse('2026-10-15T06:00:00Z');
  mock.method(Date, 'now', () => clock);
  env = {
    GUESTBOOK_SECRET: 'local-tests-only-not-a-production-secret',
    GUESTBOOK_DB: {
      prepare,
      async batch(statements) {
        database.exec('BEGIN');
        try {
          const results = [];
          for (const statement of statements) {
            // GET uses plain SELECT statements. Capture results through the shared adapter.
            results.push({results: await statement.rows()});
          }
          database.exec('COMMIT');
          return results;
        } catch (error) { database.exec('ROLLBACK'); throw error; }
      },
    },
  };
  env.GUESTBOOK_DB.prepare = (sql, values = []) => ({...prepare(sql, values), rows: async () => execute(sql, values)});
});
afterEach(() => { mock.restoreAll(); database.close(); });
const request = (method = 'GET', body, ip = '192.0.2.1', extra = {}) => new Request(origin + '/api/guestbook', {
  method,
  headers: {'Origin': origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...extra},
  ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
});
async function load(ip) { const response = await worker.fetch(request('GET', undefined, ip), env); assert.equal(response.status, 200); return response.json(); }
async function payload(overrides = {}, ip) { return {name: '朋友', message: '认真生活，也记得快乐。', website: '', token: (await load(ip)).token, submissionId: crypto.randomUUID(), ...overrides}; }
const post = (body, ip, headers) => worker.fetch(request('POST', body, ip, headers), env);
const rowCount = () => database.prepare('SELECT COUNT(*) AS n FROM guestbook_messages').get().n;

test('empty state and cross-visitor persistent readback expose only public fields', async () => {
  assert.deepEqual((await load()).messages, []);
  const response = await post(await payload({message: '<script>alert(1)</script> 只是一段文字。'}));
  assert.equal(response.status, 201);
  const content = await load('198.51.100.7');
  assert.equal(content.total, 1);
  assert.deepEqual(Object.keys(content.messages[0]).sort(), ['createdAt', 'id', 'message', 'name']);
  assert.equal(content.messages[0].message, '<script>alert(1)</script> 只是一段文字。');
});
test('concurrent idempotent retries save only once', async () => {
  const body = await payload();
  const responses = await Promise.all([post(body), post(body)]);
  assert.ok(responses.every(response => [200,201].includes(response.status)));
  assert.equal(rowCount(), 1);
  assert.equal((await post({...body, message: '不同的内容'})).status, 409);
});
test('simultaneous distinct submissions from the same visitor cannot bypass cooldown', async () => {
  const body = await payload();
  const responses = await Promise.all(Array.from({length: 12}, (_, i) => post({...body, submissionId: crypto.randomUUID(), message: '留言' + i})));
  assert.equal(responses.filter(response => response.status === 201).length, 1);
  assert.equal(rowCount(), 1);
  assert.ok(responses.filter(response => response.status === 429).every(response => Number(response.headers.get('Retry-After')) > 0));
});
test('origin, signed token, identity, expiry, honeypot, body limits fail before insert', async () => {
  const body = await payload();
  assert.equal((await post(body, undefined, {Origin: 'https://elsewhere.example'})).status, 403);
  assert.equal((await post({...body, token: body.token + 'x'})).status, 403);
  assert.equal((await post(body, '192.0.2.2')).status, 403);
  assert.equal((await post({...body, website: 'bot'})).status, 400);
  assert.equal((await post({...body, message: 'a'.repeat(5000)})).status, 413);
  clock += 3600001;
  const expired = await post(body);
  assert.equal(expired.status, 403);
  assert.equal((await expired.json()).code, 'TOKEN_EXPIRED');
  assert.equal(rowCount(), 0);
});
test('unicode length limits and anonymous nickname are consistent with the database', async () => {
  const invalid = await post(await payload({message: '🙂'.repeat(201)}));
  assert.equal(invalid.status, 400);
  const response = await post(await payload({name: ' ', message: '🙂'.repeat(200)}));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).message.name, '路过的朋友');
});
test('hourly limits and duplicate text apply after short cooldown', async () => {
  for (let i=0; i<5; i++) {
    assert.equal((await post(await payload({message: '不同的留言 ' + i}))).status, 201);
    clock += 61000;
  }
  assert.equal((await post(await payload({message: '第六条'}))).status, 429);
  clock += 3600000;
  assert.equal((await post(await payload({message: '不同的留言 0'}))).status, 429);
});
test('hidden messages stay private, and total storage cap rejects further writes', async () => {
  const body = await payload();
  assert.equal((await post(body)).status, 201);
  database.exec('UPDATE guestbook_messages SET hidden=1');
  assert.equal((await load()).total, 0);
  assert.equal((await post(body)).status, 409);
  database.exec('UPDATE guestbook_stats SET total=5000');
  const result = await post(await payload({}, '192.0.2.2'), '192.0.2.2');
  assert.equal(result.status, 503);
  assert.equal((await result.json()).code, 'BOOK_FULL');
});
test('recent list is capped at 30, sorted newest first, and site-wide daily writes are bounded', async () => {
  const insert = database.prepare('INSERT INTO guestbook_messages(id,submission_id,name,message,created_at,ip_hash,content_hash) VALUES(?,?,?,?,?,?,?)');
  for (let i=0; i<200; i++) insert.run('fixture-' + i, crypto.randomUUID(), '朋友', '留言 ' + i, clock-i, 'fixture-ip-' + i, 'content-' + i);
  const snapshot = await load();
  assert.equal(snapshot.messages.length, 30);
  assert.equal(snapshot.total, 200);
  assert.equal(snapshot.messages[0].id, 'fixture-0');
  assert.equal((await post(await payload())).status, 429);
  assert.equal(rowCount(), 200);
});
