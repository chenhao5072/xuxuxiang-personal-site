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

await checkRefs();
const previous = await active();
const oldId = previous?.versions?.[0]?.version_id;
assert.ok(uuid.test(previous?.id || '') && uuid.test(oldId || '') && is100(previous, oldId), 'Unexpected active production deployment');
const oldDetails = await cf('/versions/' + oldId);
const oldBindings = bindingMap(oldDetails);
const previousGuestbookTotal = await guestbook();
assert.equal(oldBindings.get('GUESTBOOK_DB')?.type, 'd1', 'Original guestbook binding not found');
assert.equal(oldBindings.get('GUESTBOOK_SECRET')?.type, 'secret_text', 'Original guestbook secret binding not found');
await cfSummary('Rollback version: ' + oldId);

const result = spawnSync('./node_modules/.bin/wrangler', [
  'versions', 'upload', '--config', 'wrangler.jsonc', '--keep-vars',
  '--tag', 'git-' + APPROVED_SHA.slice(0,12), '--message', 'GitHub source ' + APPROVED_SHA
], {encoding:'utf8', timeout:120000, maxBuffer:4*1024*1024});
const log = ((result.stdout || '') + '\n' + (result.stderr || '')).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
console.log(log);
assert.equal(result.status, 0, 'Inactive Workers version upload did not complete');
const id = log.match(/Version ID:\s*([a-f0-9-]{36})/i)?.[1] || '';
assert.ok(uuid.test(id) && id !== oldId, 'No new version ID returned by Wrangler');

const next = await cf('/versions/' + id);
const bindings = bindingMap(next);
const nextDb = bindings.get('GUESTBOOK_DB');
assert.equal(nextDb?.type, 'd1', 'Candidate lost its production database binding');
assert.equal(bindings.get('GUESTBOOK_SECRET')?.type, 'secret_text', 'Candidate lost its production secret binding');
assert.equal(nextDb.id ?? nextDb.database_id ?? dbId, dbId, 'Candidate points at different D1 storage');
assert.ok(next.resources?.script?.handlers?.includes('fetch'), 'Candidate has no web handler');
await checkRefs();
assert.equal((await active()).id, previous.id, 'Another Cloudflare deployment occurred; leave its traffic untouched');

const promotion = {strategy:'percentage', versions:[{version_id:id, percentage:100}], annotations:{'workers/message':'Approved GitHub source '+APPROVED_SHA}};
let newDeployment;
try {
  newDeployment = await cf('/deployments', promotion);
  assert.ok(uuid.test(newDeployment.id) && is100(newDeployment,id), 'Cloudflare did not activate the requested version');
  let success = false, detail = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await pause(3500 * attempt);
    try {
      const live = await active();
      assert.equal(live.id, newDeployment.id, 'Active deployment changed');
      const canonical = await fetch(origin + '/', {headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)});
      const title = (await canonical.text()).match(/<title>(.*?)<\/title>/u)?.[1];
      assert.equal(canonical.status, 200);
      assert.equal(title, expectedTitle);
      assert.ok(await guestbook() >= previousGuestbookTotal, 'The existing guestbook must remain accessible');
      const audit = spawnSync('npm',['run','verify:live'], {encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
      if (audit.status !== 0) {
        detail = (audit.stderr || audit.stdout || '').slice(-1500);
        throw Error('Full static-content readback did not pass');
      }
      const report = JSON.parse(await readFile('output/verification/online-readback.json','utf8'));
      assert.equal(report.title, expectedTitle);
      assert.ok(report.assets.length > 20 && report.assets.every(asset => asset.matchesBuild));
      await cfSummary('Readback passed: ' + report.assets.length + ' exact static-file checks, the canonical and www hosts, redirects, 404 and the production guestbook GET.');
      success = true;
      break;
    } catch (error) {
      console.log('Readback attempt ' + (attempt + 1) + ': ' + error.message);
    }
  }
  assert.ok(success,'Production readback did not pass after retries. ' + detail);
  await cfSummary('Cloudflare deployment: ' + newDeployment.id + '\nWorker version: ' + id + '\nApproved GitHub commit: ' + APPROVED_SHA);
} catch (error) {
  const traffic = await active();
  if (is100(traffic,id) && (!newDeployment || traffic.id === newDeployment.id)
      && traffic.annotations?.['workers/message'] === promotion.annotations['workers/message']) {
    await cf('/deployments', {strategy:'percentage',versions:[{version_id:oldId,percentage:100}],annotations:{'workers/message':'Safe rollback for GitHub '+APPROVED_SHA}});
    assert.ok(is100(await active(),oldId), 'Could not confirm rollback');
    await cfSummary('Automated rollback restored ' + oldId);
  }
  throw error;
}
