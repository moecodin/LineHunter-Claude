// LineHunter marketing: screenshot kit. Opens the real site and saves clean screenshots of every main feature, phone and desktop.
//   node marketing/shots.js            tonight's real data (needs games that haven't started for The Board / Today)
//   node marketing/shots.js --demo     the local demo slate (?demo=1) where a page supports it, for nights with no games left
//   node marketing/shots.js --light    light theme instead of dark          --only board,player   just those shots
// Output: studio/photos/shots/<name>.png + shots.json (gitignored). On localhost the Studio lists them in its photo picker
// ("App · The Board (phone)"), so they can go straight into a promo card. Starts its own server (marketing/serve.js) on 8910.
const { chromium } = require("playwright");
const { spawn } = require("child_process"), fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, ".."), OUT = path.join(ROOT, "studio/photos/shots"), PORT = 8910, BASE = `http://127.0.0.1:${PORT}`;
const args = process.argv.slice(2), DEMO = args.includes("--demo"), LIGHT = args.includes("--light");
const ONLY = (args.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const demo = (u) => (DEMO ? u + (u.includes("?") ? "&" : "?") + "demo=1" : u);
const settle = (p, ms = 2500) => p.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {}).then(() => p.waitForTimeout(ms));
const hideChrome = (p) => p.addStyleTag({ content: "#lhHuntsPill,#lhHuntsAdded,.lh-toast{display:none!important}*{caret-color:transparent!important}" });
// Links found on the Board / Today page, so player, game and matchup shots use tonight's real ids.
let found = {};
async function findIds(p) {
  found = await p.evaluate(() => {
    const href = (sel) => { const a = document.querySelector(sel); return a ? a.getAttribute("href") : null; };
    return { game: href("a[href*='game.html?id=']"), player: href("a[href*='player.html?id=']"), matchup: href("a[href*='matchup.html?player=']") };
  });
}
const SHOTS = [
  { name: "home", label: "Home", url: "index.html", sizes: ["phone", "desktop"] },
  { name: "today", label: "Today", url: () => demo("schedule.html"), sizes: ["phone", "desktop"], after: findIds },
  { name: "deck", label: "Top picks deck", url: () => demo("schedule.html"), sizes: ["phone"], go: async (p) => { await p.locator("#storyDeck").scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(1200); } },
  { name: "board", label: "The Board", url: () => demo("top-hit-rates.html"), sizes: ["phone", "desktop"] },
  { name: "board-open", label: "The Board, row open", url: () => demo("top-hit-rates.html"), sizes: ["phone", "desktop"],
    go: async (p) => { const h = p.locator("[data-bd-head]").first(); if (await h.count()) { await h.click(); await p.waitForTimeout(2500); await h.scrollIntoViewIfNeeded(); await p.evaluate(() => scrollBy(0, -90)); } },
    after: async (p) => { const keep = found; await findIds(p); found = { game: found.game || keep.game, player: found.player || keep.player, matchup: found.matchup || keep.matchup }; } },
  { name: "player", label: "Player page", url: () => found.player, sizes: ["phone", "desktop"] },
  { name: "game", label: "Game page", url: () => found.game, sizes: ["phone", "desktop"] },
  { name: "matchup", label: "Matchup Analyzer", url: () => found.matchup, sizes: ["phone", "desktop"] },
  { name: "hit-list", label: "Hit List", url: () => demo("hit-list.html"), sizes: ["phone", "desktop"] },
  { name: "hunts", label: "Hunts builder", url: () => demo("hunts.html"), sizes: ["phone", "desktop"],
    go: async (p) => { // a 3-leg slip from the first props in the picker, then the ticket
      for (let i = 0; i < 3; i++) { const b = p.locator("#hbpList [data-lh-hunt]:not(.is-in), #hbpList button:has-text('Add')").nth(i); if (await b.count()) { await b.click().catch(() => {}); await p.waitForTimeout(500); } }
      await p.evaluate(() => { const x = document.querySelector("#huntsPeek .is-open, #huntsPeek"); if (x) x.classList.remove("is-open"); });
      await p.waitForTimeout(800);
    }, cleanup: async (p) => p.evaluate(() => window.lhHunts && lhHunts.clear()) },
  { name: "standings", label: "Standings", url: "standings.html", sizes: ["desktop"] },
  { name: "research-board", label: "Research mode: Hot players", url: () => demo("top-hit-rates.html"), sizes: ["phone"], research: true },
];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn(process.execPath, [path.join(__dirname, "serve.js"), String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((r) => server.stdout.once("data", r));
  const browser = await chromium.launch(), list = [], skipped = [];
  try {
    for (const s of SHOTS) {
      if (ONLY.length && !ONLY.includes(s.name)) continue;
      for (const size of s.sizes) {
        const url = typeof s.url === "function" ? s.url() : s.url;
        if (!url) { skipped.push(`${s.name} (${size}): no link found tonight`); continue; }
        const ctx = await browser.newContext({ ...(size === "phone" ? PHONE : DESK), colorScheme: LIGHT ? "light" : "dark" });
        await ctx.addInitScript(([light, research]) => { try { localStorage.setItem("lh-theme", light ? "light" : "dark"); localStorage.setItem("lh-mode", research ? "research" : "lines"); localStorage.setItem("lh-deck-hint", "1"); localStorage.setItem("lh-swipe-hint", "1"); } catch (e) { /* ok */ } }, [LIGHT, !!s.research]);
        const p = await ctx.newPage();
        await p.goto(`${BASE}/${url.replace(/^\//, "")}`, { waitUntil: "domcontentloaded" });
        await settle(p); await hideChrome(p);
        if (s.go) await s.go(p);
        await p.waitForTimeout(600);
        const file = `${s.name}-${size}.png`;
        await p.screenshot({ path: path.join(OUT, file) });
        if (s.after) await s.after(p);
        if (s.cleanup) await s.cleanup(p);
        list.push({ player: `App · ${s.label} (${size})`, file, credit: "" });
        console.log("saved", file);
        await ctx.close();
      }
    }
  } finally { await browser.close(); server.kill(); }
  // Merge with earlier runs (an --only run keeps the other shots).
  let prev = []; try { prev = JSON.parse(fs.readFileSync(path.join(OUT, "shots.json"), "utf8")); } catch (e) { /* first run */ }
  const merged = [...prev.filter((x) => !list.some((y) => y.file === x.file)), ...list].sort((a, b) => a.file.localeCompare(b.file));
  fs.writeFileSync(path.join(OUT, "shots.json"), JSON.stringify(merged, null, 1));
  console.log(`${list.length} screenshot(s) in studio/photos/shots/` + (skipped.length ? `\nSkipped: ${skipped.join("; ")}` : ""));
})();
