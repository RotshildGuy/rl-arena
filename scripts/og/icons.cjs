// Renders public/icon-*.png from public/icon.svg. Needs Playwright (not a project dependency).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const pub = path.join(__dirname, '../../public');
(async () => {
  const b = await chromium.launch();
  const svg = fs.readFileSync(path.join(pub, 'icon.svg'), 'utf8');
  const page = path.join(__dirname, '.icon.tmp.html');
  for (const size of [180, 192, 512]) {
    fs.writeFileSync(
      page,
      `<html><head><style>@font-face{font-family:Heebo;font-weight:100 900;src:url('../../public/fonts/heebo-latin.woff2')}` +
        `html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`,
    );
    const p = await (await b.newContext({ viewport: { width: size, height: size } })).newPage();
    await p.goto('file://' + page);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(pub, `icon-${size}.png`) });
  }
  fs.unlinkSync(page);
  await b.close();
})();
