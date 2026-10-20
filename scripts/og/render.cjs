// Redraws public/og.png from og.html. Needs Playwright (not a project dependency).
const path = require('path');
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
  await p.goto('file://' + path.join(__dirname, 'og.html'));
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  await p.locator('.og').screenshot({ path: path.join(__dirname, '../../public/og.png') });
  await b.close();
})();
