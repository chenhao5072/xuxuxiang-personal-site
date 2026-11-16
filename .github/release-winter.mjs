import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {appendFile, readFile} from 'node:fs/promises';
import {setTimeout as pause} from 'node:timers/promises';

const {APPROVED_SHA, PREVIOUS_MAIN, GITHUB_REPOSITORY, GITHUB_REF, GITHUB_STEP_SUMMARY, CLOUDFLARE_API_TOKEN, GH_TOKEN} = process.env;
const parsedConfig = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const name = 'xuxuxiang-personal';
const account = '37733a50f189ab433e11474d6931373b';
const dbId = '21a3a6b9-e33c-495b-b1bd-997f64d5b383';
const origin = 'https://xuxuxiang.fun';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
assert.equal(GITHUB_REPOSITORY, 'chenhao5072/xuxuxiang-personal-site');
assert.equal(GITHUB_REF, 'refs/heads/release/winter-2026');
assert.match(APPROVED_SHA, /^[0-9a-f]{40}$/);
assert.ok(CLOUDFLARE_API_TOKEN && GH_TOKEN, 'Missing release credentials');
assert.equal(parsedConfig.name, name);
assert.equal(parsedConfig.account_id, account);
assert.equal(parsedConfig.main, 'worker/index.js');
assert.equal(parsedConfig.d1_databases?.find((entry) => entry.binding === 'GUESTBOOK_DB')?.database_id, dbId);
assert.deepEqual(parsedConfig.routes, [
  {pattern: 'xuxuxiang.fun', custom_domain: true},
  {pattern: 'www.xuxuxiang.fun', custom_domain: true}
]);
const expectedTitle = (await readFile('public/index.html', 'utf8')).match(/<title>(.*?)<\/title>/u)?.[1];
assert.equal(expectedTitle, '冬日手记 · 许旭祥');

async function cf(path, body) {
  const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + account + '/workers/scripts/' + name + path, {
    method: body ? 'POST' : 'GET',
    headers: {Authorization: 'Bearer ' + CLOUDFLARE_API_TOKEN, 'Content-Type': 'application/json'},
    ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(20000)
  });
  const data = await response.json();
  if (!response.ok || data.success !== true) {
    throw Error('Cloudflare ' + path + ': HTTP ' + response.status + ' ' + data.errors?.map(e => e.code + ' ' + e.message).join(', '));
  }
  return data.result;
}

async function checkRefs() {
  for (const [ref, wanted] of [['preview/winter-2026', APPROVED_SHA], ['main', PREVIOUS_MAIN]]) {
    const response = await fetch('https://api.github.com/repos/' + GITHUB_REPOSITORY + '/git/ref/heads/' + ref, {
      headers: {Authorization:'Bearer '+ GH_TOKEN, Accept:'application/vnd.github+json'},
      signal: AbortSignal.timeout(12000)
    });
    assert.equal(response.status, 200, 'Unable to verify GitHub branch ' + ref);
    assert.equal((await response.json()).object?.sha, wanted, 'Unexpected change to ' + ref);
  }
}
const active = async () => (await cf('/deployments?per_page=5')).deployments[0];
const is100 = (deployment, version) => deployment?.versions?.length === 1 &&
  deployment.versions[0].version_id === version && deployment.versions[0].percentage === 100;
async function guestbook() {
  const response = await fetch(origin + '/api/guestbook', {
    headers: {'Cache-Control':'no-cache'}, signal: AbortSignal.timeout(15000)
  });
  assert.equal(response.status, 200, 'Guestbook GET unavailable');
  const value = await response.json();
  assert.ok(Array.isArray(value.messages) && Number.isSafeInteger(value.total) && value.total >= 0
    && typeof value.token === 'string' && value.token.length > 20, 'Guestbook response invalid');
  return value.total;
}
function bindingMap(version) {
  const source = version.resources?.bindings;
  const entries = Array.isArray(source) ? source : Object.entries(source || {}).map(([name, binding]) => ({name, ...binding}));
  return new Map(entries.map(binding => [binding.name, binding]));
}
const cfSummary = async (message) => {
  console.log(message);
  if (GITHUB_STEP_SUMMARY) await appendFile(GITHUB_STEP_SUMMARY, message + '\n');
};


// These UUIDs came from the first run of this exact approved commit.
const oldId = '6f3e8fe4-f242-4f4b-9da3-ad134d296412';
const id = 'b5a0942c-fa42-442c-96ee-aa974c3f412d';
const cli = (args, timeout = 90000) => spawnSync('./node_modules/.bin/wrangler', args, {
  encoding:'utf8', timeout, maxBuffer:4*1024*1024
});
const safeOut = (result) => ((result.stdout || '') + '\n' + (result.stderr || '')).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');

await checkRefs();
let previous = await active();
const safeToContinue = is100(previous, oldId) || is100(previous, id);
await cfSummary('Active before retry: ' + previous?.id + ' ' + JSON.stringify(previous?.versions));
assert.ok(safeToContinue, 'A different deployment is active; leaving it untouched');
const [oldDetails, next, previousGuestbookTotal] = await Promise.all([
  cf('/versions/' + oldId), cf('/versions/' + id), guestbook()
]);
for (const details of [oldDetails, next]) {
  const bindings = bindingMap(details);
  assert.equal(bindings.get('GUESTBOOK_DB')?.type, 'd1', 'Guestbook binding not found');
  assert.equal(bindings.get('GUESTBOOK_SECRET')?.type, 'secret_text', 'Guestbook secret binding not found');
  const db = bindings.get('GUESTBOOK_DB');
  assert.equal(db.id ?? db.database_id ?? dbId, dbId);
  assert.ok(details.resources?.script?.handlers?.includes('fetch'));
}

let observed;
try {
  if (is100(previous, oldId)) {
    await checkRefs();
    assert.equal((await active()).id, previous.id, 'Another deployment occurred; do not overwrite it');
    const run = cli(['versions','deploy',id + '@100%', '--yes', '--config','wrangler.jsonc', '--message','Approved GitHub source ' + APPROVED_SHA]);
    console.log(safeOut(run));
    if (run.status !== 0) {
      const readAfter = await active();
      assert.ok(is100(readAfter, id), 'Wrangler promotion failed and candidate is not active');
    }
  }
  let confirmed = false, details = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await pause(3500 * attempt);
    try {
      const actual = await active();
      assert.ok(is100(actual,id),'Cloudflare deployment readback has not reached the new version: '+JSON.stringify(actual?.versions));
      if (observed) assert.equal(actual.id, observed.id, 'Active deployment trace changed during verification');
      observed = actual;
      const canonical = await fetch(origin + '/', {headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)});
      const title = (await canonical.text()).match(/<title>(.*?)<\/title>/u)?.[1];
      assert.equal(canonical.status,200);
      assert.equal(title, expectedTitle);
      assert.ok(await guestbook() >= previousGuestbookTotal, 'Existing guestbook must remain accessible');
      const audit = spawnSync('npm',['run','verify:live'], {encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
      if (audit.status !== 0) {
        details = (audit.stderr || audit.stdout || '').slice(-2500);
        throw Error('Full static-content readback did not pass');
      }
      const report = JSON.parse(await readFile('output/verification/online-readback.json','utf8'));
      assert.equal(report.title, expectedTitle);
      assert.ok(report.assets.length > 20 && report.assets.every(asset => asset.matchesBuild));
      await cfSummary('Readback passed: ' + report.assets.length + ' exact static-file checks, the canonical and www hosts, redirect, 404 and production guestbook GET.');
      confirmed = true;
      break;
    } catch (error) { console.log('Readback attempt ' + (attempt + 1) + ': ' + error.message); }
  }
  assert.ok(confirmed, 'Production readback did not pass. ' + details);
  await cfSummary('Cloudflare deployment: ' + observed.id + '\nWorker version: ' + id + '\nRollback version: ' + oldId + '\nApproved GitHub commit: ' + APPROVED_SHA);
} catch (error) {
  const traffic = await active();
  if (observed && traffic?.id === observed.id && is100(traffic,id)) {
    const back = cli(['versions','deploy',oldId + '@100%', '--yes','--config','wrangler.jsonc','--message','Safe rollback of GitHub source '+APPROVED_SHA]);
    console.log(safeOut(back));
    await pause(2000);
    assert.ok(is100(await active(),oldId), 'Could not confirm automatic rollback; inspect Cloudflare immediately');
    await cfSummary('Automated rollback restored ' + oldId);
  }
  throw error;
}
