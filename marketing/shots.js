// LineHunter marketing: screenshot kit. Opens the real site and saves clean screenshots of every main feature, phone and desktop.
//   node marketing/shots.js            tonight's real data (needs games that haven't started for The Board / Today)
//   node marketing/shots.js --demo     the local demo slate (?demo=1) where a page supports it, for nights with no games left
//   node marketing/shots.js --light    light theme instead of dark          --only=board,player   just those shots
//   node marketing/shots.js --player="Jalen Brunson" --stat=ast    the player page, Matchup Analyzer, game page and the opened
//       Board row are about that player (his next game), with that prop tab (pts / reb / ast / 3pm / pra; default pts)
// Output: studio/photos/shots/<name>.png + shots.json (gitignored). On localhost the Studio lists them in its photo picker
// ("App · The Board (phone)"), so they can go straight into a promo card. Starts its own server (marketing/serve.js) on 8910.
const { chromium } = require("playwright");
const { spawn } = require("child_process"), fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, ".."), OUT = path.join(ROOT, "studio/photos/shots"), PORT = 8910, BASE = `http://127.0.0.1:${PORT}`;
const args = process.argv.slice(2), DEMO = args.includes("--demo"), LIGHT = args.includes("--light");
const ONLY = (args.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const arg = (name) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3).replace(/^["']|["']$/g, "") : ""; };
const PLAYER = arg("player"), STAT = (arg("stat") || "pts").toLowerCase();
const norm = (s) => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
// --player: look the player up and find his next game, so every player shot uses him.
async function pickPlayer() {
  const words = norm(PLAYER).split(" "), longest = words.reduce((a, b) => (b.length > a.length ? b : a), "");
  const res = await fetch(`${BASE}/api/bdl/v1/players/active?search=${encodeURIComponent(longest)}&per_page=50`).then((r) => r.json());
  const p = (res.data || []).find((x) => words.every((w) => norm(`${x.first_name} ${x.last_name}`).includes(w)));
  if (!p) throw new Error(`No active player matches "${PLAYER}".`);
  const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const games = await fetch(`${BASE}/api/bdl/v1/games?team_ids[]=${p.team.id}&start_date=${day(0)}&end_date=${day(10)}&per_page=25`).then((r) => r.json());
  const next = (games.data || []).filter((g) => g.status !== "Final").sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
  const opp = next ? (next.home_team.id === p.team.id ? next.visitor_team : next.home_team) : null;
  console.log(`Player: ${p.first_name} ${p.last_name} (${p.team.abbreviation})` + (next ? `, next game ${String(next.date).slice(0, 10)} vs ${opp.abbreviation}` : ", no upcoming game"));
  return { name: `${p.first_name} ${p.last_name}`, last: p.last_name, urls: {
    player: `player.html?id=${p.id}&prop=${STAT}`,
    matchup: `matchup.html?player=${p.id}${opp ? `&opp=${opp.id}` : ""}&stat=${STAT}`,
    game: next ? `game.html?id=${next.id}&player=${p.id}&prop=${STAT}` : null } };
}
let CHOSEN = null;
const HEADSHOTS = new Map();
// A regular Chrome user agent: the NBA headshot server (cdn.nba.com) drops requests from "HeadlessChrome", so without it every
// player shows his initials instead of his photo.
const UA_PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const UA_DESK = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA_PHONE };
const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, userAgent: UA_DESK };
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
  { name: "today", label: "Today", url: () => demo("schedule.html"), sizes: ["phone", "desktop"], after: async (p) => { if (!CHOSEN) await findIds(p); } },
  { name: "deck", label: "Top picks deck", url: () => demo("schedule.html"), sizes: ["phone"], go: async (p) => { await p.locator("#storyDeck").scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(1200); } },
  { name: "board", label: "The Board", url: () => demo("top-hit-rates.html"), sizes: ["phone", "desktop"] },
  { name: "board-open", label: "The Board, row open", url: () => demo("top-hit-rates.html"), sizes: ["phone", "desktop"],
    go: async (p) => { // --player: his row if he's on tonight's Board (and the stat tab, if there is one), else the top row
      if (CHOSEN) { const tab = p.locator(`#boardTabs [data-bd-tab="${STAT}"]`).first(); if (await tab.count()) { await tab.click().catch(() => {}); await p.waitForTimeout(1500); } }
      let h = CHOSEN ? p.locator("[data-bd-head]", { hasText: CHOSEN.last }).first() : p.locator("[data-bd-head]").first();
      if (CHOSEN && !(await h.count())) { console.log(`  ${CHOSEN.name} is not on tonight's Board; opening the top row`); h = p.locator("[data-bd-head]").first(); }
      if (await h.count()) { await h.click(); await p.waitForTimeout(2500); await h.scrollIntoViewIfNeeded(); await p.evaluate(() => scrollBy(0, -90)); } },
    after: async (p) => { if (CHOSEN) return; const keep = found; await findIds(p); found = { game: found.game || keep.game, player: found.player || keep.player, matchup: found.matchup || keep.matchup }; } },
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
  if (PLAYER) { try { CHOSEN = await pickPlayer(); found = { ...CHOSEN.urls }; } catch (e) { console.log(e.message); server.kill(); process.exit(1); } }
  const browser = await chromium.launch(), list = [], skipped = [];
  try {
    for (const s of SHOTS) {
      if (ONLY.length && !ONLY.includes(s.name)) continue;
      for (const size of s.sizes) {
        const url = typeof s.url === "function" ? s.url() : s.url;
        if (!url) { skipped.push(`${s.name} (${size}): no link found tonight`); continue; }
        const ctx = await browser.newContext({ ...(size === "phone" ? PHONE : DESK), colorScheme: LIGHT ? "light" : "dark" });
        await ctx.addInitScript(([light, research]) => { try { localStorage.setItem("lh-theme", light ? "light" : "dark"); localStorage.setItem("lh-mode", research ? "research" : "lines"); localStorage.setItem("lh-deck-hint", "1"); localStorage.setItem("lh-swipe-hint", "1"); } catch (e) { /* ok */ } }, [LIGHT, !!s.research]);
        // Headshots: cdn.nba.com breaks the connection for automated Chromium (HTTP/2 error), so the kit downloads each photo
        // itself (plain HTTPS with a normal user agent) and hands it to the page. Cached for the run.
        await ctx.route(/cdn\.nba\.com\/headshots\//, async (route) => {
          const u = route.request().url();
          try {
            if (!HEADSHOTS.has(u)) HEADSHOTS.set(u, fetch(u, { headers: { "User-Agent": UA_DESK } }).then(async (r) => ({ status: r.status, body: Buffer.from(await r.arrayBuffer()) })));
            const h = await HEADSHOTS.get(u); await route.fulfill({ status: h.status, contentType: "image/png", body: h.body });
          } catch (e) { await route.abort(); }
        });
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
