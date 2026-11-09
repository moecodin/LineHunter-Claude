const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  for (const f of ["a-night-poster", "b-paper-scoreboard"]) {
    await p.goto("file://" + __dirname + "/" + f + ".html"); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(800);
    await p.locator("#card").screenshot({ path: __dirname + "/" + f + ".png" });
  }
  await b.close();
})();
