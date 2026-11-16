import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const origin = 'https://xuxuxiang.fun';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const entries = await fs.readdir(publicDir, {recursive: true, withFileTypes: true});
const files = entries.filter(entry => entry.isFile() && !entry.name.startsWith('_'))
  .map(entry => path.relative(publicDir, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/'));
const checks = await Promise.all(files.map(async file => {
  const url = origin + '/' + file;
  const response = await fetch(url, {signal: AbortSignal.timeout(20000)});
  const bytes = Buffer.from(await response.arrayBuffer());
  const expectedStatus = 200;
  return {file, status: response.status, expectedStatus, matchesBuild: hash(bytes) === hash(await fs.readFile(path.join(publicDir, file))), contentType: response.headers.get('content-type')};
}));
const endpoints = await Promise.all([
  origin + '/', 'https://www.xuxuxiang.fun/',
  'http://xuxuxiang.fun/', origin + '/does-not-exist',
].map(async url => {
  const response = await fetch(url, {redirect: 'manual', signal: AbortSignal.timeout(20000)});
  return {url, status: response.status, location: response.headers.get('location')};
}));
const homeResponse = await fetch(origin, {signal: AbortSignal.timeout(20000)});
const home = await homeResponse.text();
const report = {
  checkedAt: new Date().toISOString(), origin,
  title: home.match(/<title>(.*?)<\/title>/)?.[1],
  photoCount: files.filter(file => file.startsWith('assets/photo-')).length,
  qrCount: files.filter(file => file === 'assets/wechat-qr.png').length,
  contentSecurityPolicy: homeResponse.headers.get('content-security-policy'),
  endpoints, assets: checks,
};
const evidenceDir = path.join(root, 'output', 'verification');
await fs.mkdir(evidenceDir, {recursive: true});
await fs.writeFile(path.join(evidenceDir, 'online-readback.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (checks.some(check => check.status !== check.expectedStatus || !check.matchesBuild)
    || endpoints[0].status !== 200 || endpoints[1].status !== 200
    || ![301, 302, 307, 308].includes(endpoints[2].status)
    || endpoints[2].location !== origin + '/' || endpoints[3].status !== 404) process.exitCode = 1;
