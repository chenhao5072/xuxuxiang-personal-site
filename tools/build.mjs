import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, 'public');
const sourceFiles = [
  'index.html',
  'styles.css',
  'app.js',
  'guestbook.js',
  'birthday.css',
  'birthday.js',
  '404.html',
  'favicon.svg',
  'social-preview.jpg',
  'robots.txt',
  'sitemap.xml',
  '_headers',
];

// Only this project's generated public directory can be replaced by the build.
if (path.dirname(output) !== root || path.basename(output) !== 'public') {
  throw new Error('Invalid build destination.');
}
const outputInfo = await fs.lstat(output).catch(error => {
  if (error.code !== 'ENOENT') throw error;
});
if (outputInfo && (!outputInfo.isDirectory() || outputInfo.isSymbolicLink()
    || path.dirname(await fs.realpath(output)) !== await fs.realpath(root))) {
  throw new Error('The public output must be a real directory inside this project.');
}

const pageSources = await Promise.all(
  ['index.html', '404.html', 'styles.css', 'app.js', 'birthday.css', 'birthday.js'].map((file) => fs.readFile(path.join(root, file), 'utf8')),
);
const assets = new Set();
for (const source of pageSources) {
  for (const match of source.matchAll(/(?:["'(]|\s)(\/assets\/[a-zA-Z0-9._/-]+)/g)) {
    const relative = match[1].slice(1);
    const approvedPhoto = /^assets\/photo-\d{2}(?:-clean|-thumb)?\.webp$/.test(relative) && !/photo-10(?:[.-])/.test(relative);
    if (!approvedPhoto && relative !== 'assets/wechat-qr.png') {
      throw new Error(`Asset is not approved for public delivery: ${relative}`);
    }
    assets.add(relative);
  }
}
if (assets.size === 0) throw new Error('No public photos were found in the page sources.');

const files = [...sourceFiles, ...assets];
// Validate every source before changing the previous successful build.
await Promise.all(files.map((file) => fs.access(path.join(root, file))));
const assetVersions = Object.fromEntries(await Promise.all(
  ['styles.css', 'app.js', 'guestbook.js', 'birthday.css', 'birthday.js'].map(async (file) => [
    file,
    createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex').slice(0, 12),
  ]),
));
console.log(`Building static site into ${output}`);
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(path.join(output, 'assets'), { recursive: true });
let totalBytes = 0;
for (const file of files) {
  const source = path.join(root, file);
  const target = path.join(output, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (file === 'index.html') {
    const html = (await fs.readFile(source, 'utf8')).replace(
      /((?:href|src)=["']\/)(styles\.css|app\.js|guestbook\.js|birthday\.css|birthday\.js)(?:\?[^"']*)?(["'])/g,
      (_, prefix, asset, quote) => `${prefix}${asset}?v=${assetVersions[asset]}${quote}`,
    );
    await fs.writeFile(target, html, 'utf8');
  } else {
    await fs.copyFile(source, target);
  }
  totalBytes += (await fs.stat(target)).size;
}
console.log(`Built ${files.length} files, including ${[...assets].filter(file => file.startsWith('assets/photo-')).length} photos and ${[...assets].filter(file => file === 'assets/wechat-qr.png').length} QR asset (${(totalBytes / 1024 / 1024).toFixed(2)} MiB).`);
console.log('Source photos, unused assets, tooling, and credentials are excluded.');
