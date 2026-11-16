import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:4192';
const out = 'output/playwright';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch();
const matrix = [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'small-mobile', width: 320, height: 800 }
];
const verified = [];
try {
  for (const { name, width, height } of matrix) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: width === 1440 ? 1.25 : 1, reducedMotion: 'reduce', isMobile: width < 500, hasTouch: width < 500 });
    const failed = [];
    page.on('pageerror', (error) => failed.push(error.message));
    page.on('response', (response) => {
      if (response.url().startsWith(base) && response.status() >= 400) failed.push(response.status() + ' ' + new URL(response.url()).pathname);
    });
    assert.equal((await page.goto(base, { waitUntil: 'networkidle' })).status(), 200);
    assert.equal(await page.title(), '冬日手记 · 许旭祥');
    assert.match(await page.locator('h1').textContent(), /冬日漫长，也有暖光/);
    assert.doesNotMatch(await page.locator('body').innerText(), /生日|生辰|寿星|敬邀赴宴/);
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.waitForFunction(() => document.querySelector('.winter-window-photo img')?.naturalWidth === 2200);
    const metrics = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, title: document.querySelector('h1').getBoundingClientRect().toJSON() }));
    assert.ok(metrics.scrollWidth <= metrics.viewport + 1, `${name} overflow ${metrics.scrollWidth} vs ${metrics.viewport}`);
    assert.ok(metrics.title.left >= 0 && metrics.title.right <= width, `${name}: title does not fit`);
    if (name !== 'small-mobile') await page.screenshot({ path: out + '/' + name + '-opening.png' });
    const portrait = page.locator('.winter-still-photo img');
    await portrait.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('.winter-still-photo img')?.naturalWidth === 1650);
    const play = page.locator('[data-loop]');
    await page.waitForFunction(() => document.querySelector('[data-loop] img')?.naturalWidth === 307);
    assert.equal(await play.getAttribute('aria-pressed'), 'false');
    assert.match(await play.locator('img').getAttribute('src'), /poster\.webp$/);
    if (name === 'desktop') await page.locator('#winter-film').screenshot({ path: out + '/desktop-film.png' });
    await play.click();
    assert.equal(await play.getAttribute('aria-pressed'), 'true');
    await page.waitForFunction(() => {
      const image = document.querySelector('[data-loop] img');
      return image.complete && image.naturalWidth === 307 && image.currentSrc.endsWith('/winter-loop.gif');
    });
    await play.click();
    assert.equal(await play.getAttribute('aria-pressed'), 'false');
    await portrait.click();
    assert.equal(await page.locator('.photo-dialog').evaluate(node => node.open), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.photo-dialog').evaluate(node => node.open), false);
    await page.locator('[data-wechat-qr]').click();
    assert.equal(await page.locator('#wechat-dialog').evaluate(node => node.open), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#wechat-dialog').evaluate(node => node.open), false);
    assert.equal((await page.request.get(base + '/api/guestbook')).status(), 200);
    await page.evaluate(async () => {
      const images = [...document.images].filter(img => img.closest('main'));
      for (const img of images) { img.loading = 'eager'; await img.decode(); }
      window.scrollTo(0, 0);
    });
    if (name === 'desktop') await page.screenshot({ path: out + '/desktop-full.png', fullPage: true });
    if (name === 'mobile') await page.screenshot({ path: out + '/mobile-full.png', fullPage: true });
    assert.deepEqual(failed, [], `Browser errors at ${name}`);
    verified.push({ viewport: name, width, checks: ['heading, integer layout width', 'WebP images', 'GIF click and stop', 'photo dialog', 'WeChat QR', 'sandboxed guestbook GET'] });
    await page.close();
  }
  await fs.writeFile(out + '/check-report.json', JSON.stringify(verified, null, 2) + '\n');
  console.log('Passed desktop and mobile browser checks; no production configuration or data used.');
} finally {
  await browser.close();
}
