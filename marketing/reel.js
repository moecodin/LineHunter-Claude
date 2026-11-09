// LineHunter marketing: reel maker. Plays a script of scenes on the real site (phone size), records each one sharp at 1080x1920,
// puts our captions on top, adds a title card and an end card, and cuts it all into one 9:16 MP4 (no music: add it in the app).
//
//   node marketing/reel.js                                     the "tour" script (marketing/reel/tour.json)
//   node marketing/reel.js --script=spotlight --player="Jalen Brunson" --stat=ast
//   node marketing/reel.js --demo                              the local demo slate (?demo=1) where a page has it
//   node marketing/reel.js --keep                              keep the per-scene clips (marketing/out/reel-parts/)
// Output: marketing/out/reel-<script>-<date>.mp4 + a cover image (the title card) next to it. Needs ffmpeg.
//
// A script is a JSON list of scenes (see marketing/reel/README.md for every option):
//   { "card": "title", "kicker": "...", "title": "...", "hero": "...", "wall": "HUNT", "sec": 2.2 }
//   { "url": "top-hit-rates.html", "caption": ["Every prop.", "One list."], "actions": [ { "do": "scroll", "by": 600 } ] }
//   { "card": "end", "sec": 3 }
// Placeholders in any text or url: {player} {first} {last} {playerId} {stat} {STAT} {date} {oppId}
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process"), fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, ".."), PORT = 8912, BASE = `http://127.0.0.1:${PORT}`;
const args = process.argv.slice(2), arg = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3).replace(/^["']|["']$/g, "") : ""; };
const SCRIPT = arg("script") || "tour", DEMO = args.includes("--demo"), KEEP = args.includes("--keep"), STAT = (arg("stat") || "pts").toLowerCase(), PLAYER = arg("player");
const OUTDIR = path.join(__dirname, "out"), PARTS = path.join(OUTDIR, "reel-parts");
const W = 1080, H = 1920, VIEW = { width: 405, height: 720 }, DPR = W / 405; // 405 x 720 CSS px at 2.667x = exactly 1080 x 1920
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const UA_FETCH = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const norm = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
const ff = (a) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a], { stdio: ["ignore", "ignore", "inherit"] });
const ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30"];
const HEADSHOTS = new Map();
let V = { stat: STAT, STAT: STAT.toUpperCase(), date: new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/New_York" }) };
const fill = (s) => String(s == null ? "" : s).replace(/\{(\w+)\}/g, (m, k) => (V[k] != null ? V[k] : m));

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, userAgent: UA, colorScheme: "dark" });
  await ctx.addInitScript(() => { try { localStorage.setItem("lh-theme", "dark"); localStorage.setItem("lh-mode", "lines"); localStorage.setItem("lh-deck-hint", "1"); localStorage.setItem("lh-swipe-hint", "1"); } catch (e) { /* ok */ } });
  // Headshots: cdn.nba.com breaks the connection for automated Chromium, so they are fetched here and handed to the page.
  await ctx.route(/cdn\.nba\.com\/headshots\//, async (route) => {
    const u = route.request().url();
    try { if (!HEADSHOTS.has(u)) HEADSHOTS.set(u, fetch(u, { headers: { "User-Agent": UA_FETCH } }).then(async (r) => ({ status: r.status, body: Buffer.from(await r.arrayBuffer()) })));
      const h = await HEADSHOTS.get(u); await route.fulfill({ status: h.status, contentType: "image/png", body: h.body }); } catch (e) { await route.abort(); }
  });
  const page = await ctx.newPage();
  await page.addStyleTag({ content: "" }).catch(() => {});
  return { ctx, page };
}
const settle = (p, ms = 2200) => p.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {}).then(() => p.waitForTimeout(ms));
const hideChrome = (p) => p.addStyleTag({ content: "#lhHuntsAdded,.lh-toast{display:none!important}*{caret-color:transparent!important}html{scroll-behavior:auto!important}" });

// ---------- who the player scenes are about ----------
async function pickPlayer(browser) {
  const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  let p;
  if (PLAYER) {
    const words = norm(PLAYER).split(" "), longest = words.reduce((a, b) => (b.length > a.length ? b : a), "");
    const res = await fetch(`${BASE}/api/bdl/v1/players/active?search=${encodeURIComponent(longest)}&per_page=50`).then((r) => r.json());
    p = (res.data || []).find((x) => words.every((w) => norm(`${x.first_name} ${x.last_name}`).includes(w)));
    if (!p) throw new Error(`No active player matches "${PLAYER}".`);
  } else { // the top row of tonight's Board
    const { ctx, page } = await newPage(browser);
    await page.goto(`${BASE}/top-hit-rates.html${DEMO ? "?demo=1" : ""}`); await settle(page);
    const head = page.locator("[data-bd-head]").first();
    if (await head.count()) { await head.click(); await page.waitForTimeout(1500); }
    const href = await page.evaluate(() => { const a = document.querySelector("a[href*='player.html?id=']"); return a && a.getAttribute("href"); });
    await ctx.close();
    const id = href && /id=(\d+)/.exec(href); if (!id) return null;
    p = (await fetch(`${BASE}/api/bdl/v1/players/${id[1]}`).then((r) => r.json())).data;
  }
  const games = await fetch(`${BASE}/api/bdl/v1/games?team_ids[]=${p.team.id}&start_date=${day(0)}&end_date=${day(10)}&per_page=25`).then((r) => r.json());
  const next = (games.data || []).filter((g) => g.status !== "Final").sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
  const opp = next ? (next.home_team.id === p.team.id ? next.visitor_team : next.home_team) : null;
  console.log(`Player: ${p.first_name} ${p.last_name} (${p.team.abbreviation})${next ? `, next game vs ${opp.abbreviation}` : ""}`);
  return { player: `${p.first_name} ${p.last_name}`, first: p.first_name, last: p.last_name, playerId: p.id, oppId: opp ? opp.id : "", gameId: next ? next.id : "" };
}

// ---------- actions ----------
const smoothScroll = (page, sel, by, ms, axis) => page.evaluate(([sel, by, ms, axis]) => new Promise((done) => {
  const el = sel ? document.querySelector(sel) : null, target = el || document.scrollingElement;
  const start = axis === "x" ? target.scrollLeft : target.scrollTop, t0 = performance.now(), ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  if (el && axis === "x") el.style.scrollSnapType = "none";
  const step = (now) => { const k = Math.min(1, (now - t0) / ms), v = start + by * ease(k); if (axis === "x") target.scrollLeft = v; else target.scrollTop = v; if (k < 1) requestAnimationFrame(step); else { if (el && axis === "x") el.style.scrollSnapType = ""; done(); } };
  requestAnimationFrame(step);
}), [sel || null, by, ms, axis]);
async function run(page, a) {
  const loc = (sel, text, nth) => { let l = page.locator(fill(sel)); if (text) l = l.filter({ hasText: fill(text) }); return l.nth(nth || 0); };
  switch (a.do) {
    case "wait": return page.waitForTimeout(a.ms || 800);
    case "scroll": return smoothScroll(page, a.in ? fill(a.in) : null, a.by || 500, a.ms || 1200, "y");
    case "swipeH": for (let i = 0; i < (a.times || 1); i++) { await smoothScroll(page, fill(a.sel), a.by || 300, a.ms || 700, "x"); await page.waitForTimeout(a.pause || 450); } return;
    case "scrollTo": { const l = loc(a.sel, a.text, a.nth); if (!(await l.count())) return; const y = await l.evaluate((el) => el.getBoundingClientRect().top + scrollY); const cur = await page.evaluate(() => scrollY); return smoothScroll(page, null, y - (a.offset || 70) - cur, a.ms || 1000, "y"); }
    case "tap": { let l = loc(a.sel, a.text, a.nth); if (!(await l.count()) && a.text) l = loc(a.sel, null, a.nth); if (!(await l.count())) return; await l.scrollIntoViewIfNeeded().catch(() => {}); return l.click({ timeout: 4000 }).catch(() => {}); }
    case "swipe": for (let i = 0; i < (a.times || 1); i++) { // drag a card (the Top picks deck) with the pointer
      const l = loc(a.sel, null, 0); const b = await l.boundingBox().catch(() => null); if (!b) return;
      const x = b.x + b.width / 2, y = b.y + b.height / 2; await page.mouse.move(x, y); await page.mouse.down();
      for (let s = 1; s <= 14; s++) { await page.mouse.move(x + (a.dx || -300) * (s / 14), y + 6 * (s / 14)); await page.waitForTimeout(16); }
      await page.mouse.up(); await page.waitForTimeout(a.pause || 750); } return;
    case "type": { const l = loc(a.sel); await l.click().catch(() => {}); return l.type(fill(a.text), { delay: a.delay || 90 }); }
    case "hunt": for (let i = 0; i < (a.n || 3); i++) { const b = page.locator("#hbpList .lh-hbp-add:not([disabled]):not(.is-in)").first(); if (!(await b.count())) return; await b.scrollIntoViewIfNeeded().catch(() => {}); await b.click().catch(() => {}); await page.waitForTimeout(a.pause || 700); } return;
    case "eval": return page.evaluate(a.js);
    default: console.log(`  unknown action "${a.do}" skipped`);
  }
}

// ---------- recording one page scene (Chrome's screencast at full device resolution) ----------
async function recordScene(browser, scene, i) {
  const { ctx, page } = await newPage(browser);
  let url = fill(scene.url); if (DEMO && !/demo=1/.test(url)) url += (url.includes("?") ? "&" : "?") + "demo=1";
  await page.goto(`${BASE}/${url}`); await settle(page, scene.settle || 2200); await hideChrome(page);
  for (const a of scene.before || []) await run(page, a); // set-up steps that aren't filmed
  const cdp = await ctx.newCDPSession(page), frames = [];
  cdp.on("Page.screencastFrame", async (f) => { frames.push({ data: f.data, t: f.metadata.timestamp }); cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await page.evaluate(() => { document.body.style.opacity = "0.999"; }); await page.waitForTimeout(80);
  const t0 = Date.now() / 1000;
  for (const a of scene.actions || []) await run(page, a);
  await page.waitForTimeout(scene.hold || 900);
  const t1 = Date.now() / 1000;
  await cdp.send("Page.stopScreencast").catch(() => {});
  if (scene.cleanup === "hunts") await page.evaluate(() => window.lhHunts && lhHunts.clear()).catch(() => {});
  await ctx.close();
  if (!frames.length) throw new Error(`Scene ${i + 1} recorded no frames`);
  // Frames come only when the screen changes: each one lasts until the next (the last until the end of the scene).
  const speed = scene.speed || 1; // "speed": 1.4 plays the scene 1.4x faster
  const dir = path.join(PARTS, `s${i}`); fs.mkdirSync(dir, { recursive: true });
  let list = "";
  frames.forEach((f, k) => {
    const file = `f${String(k).padStart(5, "0")}.jpg`; fs.writeFileSync(path.join(dir, file), Buffer.from(f.data, "base64"));
    const end = k + 1 < frames.length ? frames[k + 1].t : Math.max(f.t + 0.04, t1);
    list += `file '${file}'\nduration ${(Math.max(0.001, end - Math.max(f.t, k ? f.t : t0)) / speed).toFixed(4)}\n`;
  });
  list += `file 'f${String(frames.length - 1).padStart(5, "0")}.jpg'\n`;
  fs.writeFileSync(path.join(dir, "list.txt"), list);
  const raw = path.join(PARTS, `s${i}-raw.mp4`);
  ff(["-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"), "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x060a16,fps=30`, ...ENC, raw]);
  return { raw, sec: Math.max(0.5, (t1 - t0) / speed) };
}

// ---------- captions and cards, drawn as images in our fonts ----------
const CARD_CSS = `*{box-sizing:border-box;margin:0}body{width:${W}px;height:${H}px;font-family:Satoshi,sans-serif;color:#f2f0fa;background:transparent}
.h{font-family:'Clash Display';font-weight:700;letter-spacing:-.02em;line-height:.98}.h em{font-style:normal;color:#9a93ff}
.k{font-size:30px;letter-spacing:.2em;text-transform:uppercase;color:#93a1cb}
.bg{position:absolute;inset:0;background:#060a16}.glow{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 62%,rgba(154,147,255,.32),rgba(6,10,22,0) 62%)}
.logo{position:absolute;left:80px;top:150px;height:58px}.wall{position:absolute;left:50px;top:420px;font-family:'Bebas Neue';font-size:520px;line-height:.8;color:#9a93ff;opacity:.12;white-space:nowrap}
.note{position:absolute;left:80px;right:80px;bottom:150px;font-size:24px;line-height:1.5;color:#93a1cb}`;
async function renderPng(page, html, file, transparent) {
  await page.setContent(`<!doctype html><html><head><base href="${BASE}/"><link href="https://api.fontshare.com/v2/css?f[]=clash-display@600,700&display=swap" rel="stylesheet"><link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap" rel="stylesheet"><link href="https://api.fontshare.com/v2/css?f[]=bebas-neue@400&display=swap" rel="stylesheet"><style>${CARD_CSS}</style></head><body>${html}</body></html>`);
  // Wait for each font actually used (document.fonts.ready alone can resolve before the stylesheets have been read).
  await page.evaluate(async () => { await Promise.all(['700 100px "Clash Display"', '400 30px Satoshi', '400 100px "Bebas Neue"'].map((f) => document.fonts.load(f).catch(() => null))); await document.fonts.ready; }); await page.waitForTimeout(300);
  await page.screenshot({ path: file, omitBackground: !!transparent });
}
const NOTE = "Research tool. Based on past results, not guarantees. 21+. Gambling problem? Call 1-800-GAMBLER.";
const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const cardHtml = (c) => c.card === "end"
  ? `<div class="bg"></div><div class="glow"></div><img class="logo" src="assets/img/lh-lockup-on-dark.svg">
     <div style="position:absolute;left:80px;right:80px;top:560px;text-align:center"><div class="k">${esc(fill(c.kicker || "Every night, every game"))}</div>
     <div class="h" style="font-size:118px;margin-top:30px">${esc(fill(c.title || "Research the line."))}<br><em>${esc(fill(c.hero || "Then hunt it."))}</em></div>
     <div style="display:inline-block;margin-top:80px;border:5px solid #9a93ff;padding:30px 60px;font-family:'Clash Display';font-weight:600;font-size:60px">linehunterapp.com</div>
     <div style="margin-top:36px;font-size:36px;color:#93a1cb">${esc(fill(c.sub || "Free · no sign-up"))}</div></div><div class="note" style="text-align:center">${NOTE}</div>`
  : `<div class="bg"></div><div class="glow" style="background:radial-gradient(ellipse at 40% 45%,rgba(154,147,255,.3),rgba(6,10,22,0) 60%)"></div><img class="logo" src="assets/img/lh-lockup-on-dark.svg">
     ${c.wall ? `<div class="wall">${esc(fill(c.wall))}</div>` : ""}
     <div style="position:absolute;left:80px;right:80px;top:700px"><div class="k">${esc(fill(c.kicker || ""))}</div>
     <div class="h" style="font-size:${c.size || 132}px;margin-top:30px">${esc(fill(c.title || ""))}<br><em>${esc(fill(c.hero || ""))}</em></div>
     ${c.sub ? `<div style="margin-top:40px;font-size:40px;color:#c3cce9">${esc(fill(c.sub))}</div>` : ""}</div><div class="note">${NOTE}</div>`;
// Caption: a dark panel in the upper-middle (clear of Instagram's buttons on the right and its text at the bottom).
const captionHtml = (lines, pos) => `<div style="position:absolute;left:56px;max-width:860px;top:${pos === "top" ? 300 : 1180}px;background:rgba(6,10,22,.97);border-left:10px solid #9a93ff;padding:34px 44px 38px">
  <div class="h" style="font-size:78px">${esc(fill(lines[0] || ""))}${lines[1] ? `<br><em>${esc(fill(lines[1]))}</em>` : ""}</div></div>`;

(async () => {
  const scriptFile = path.join(__dirname, "reel", `${SCRIPT}.json`);
  if (!fs.existsSync(scriptFile)) { console.log(`No script "${SCRIPT}" (looked for marketing/reel/${SCRIPT}.json).`); process.exit(1); }
  const scenes = JSON.parse(fs.readFileSync(scriptFile, "utf8"));
  fs.rmSync(PARTS, { recursive: true, force: true }); fs.mkdirSync(PARTS, { recursive: true });
  const server = spawn(process.execPath, [path.join(__dirname, "serve.js"), String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((r) => server.stdout.once("data", r));
  const browser = await chromium.launch(), clips = [];
  let cover = null;
  try {
    if (scenes.some((s) => JSON.stringify(s).match(/\{(player|first|last|playerId|oppId|gameId)\}/))) {
      const who = await pickPlayer(browser); if (who) V = { ...V, ...who };
    }
    const drawer = await browser.newPage({ viewport: { width: W, height: H } });
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i], out = path.join(PARTS, `s${i}.mp4`);
      process.stdout.write(`Scene ${i + 1}/${scenes.length}: ${s.card ? s.card + " card" : fill(s.url)} … `);
      if (s.card) {
        const png = path.join(PARTS, `s${i}.png`); await renderPng(drawer, cardHtml(s), png, false);
        if (s.card === "title" && !cover) cover = png;
        const sec = s.sec || 2.5;
        ff(["-loop", "1", "-t", String(sec), "-i", png, "-vf", `scale=${W}:${H},zoompan=z='min(1.0+0.0006*on,1.04)':d=1:s=${W}x${H}:fps=30,fade=t=in:st=0:d=0.25`, ...ENC, out]);
      } else {
        const { raw, sec } = await recordScene(browser, s, i);
        if (s.caption && s.caption.length) {
          const png = path.join(PARTS, `s${i}-cap.png`); await renderPng(drawer, captionHtml(s.caption, s.captionAt), png, true);
          ff(["-i", raw, "-loop", "1", "-t", String(sec), "-i", png, "-filter_complex", "[1]format=rgba,fade=t=in:st=0.15:d=0.35:alpha=1[c];[0][c]overlay=0:0:shortest=1", ...ENC, out]);
        } else fs.renameSync(raw, out);
      }
      clips.push(out); console.log("done");
    }
    await drawer.close();
  } finally { await browser.close(); server.kill(); }
  const list = path.join(PARTS, "all.txt"); fs.writeFileSync(list, clips.map((c) => `file '${c}'`).join("\n"));
  const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }), name = `reel-${SCRIPT}-${stamp}`;
  ff(["-f", "concat", "-safe", "0", "-i", list, ...ENC, "-movflags", "+faststart", path.join(OUTDIR, `${name}.mp4`)]);
  if (cover) fs.copyFileSync(cover, path.join(OUTDIR, `${name}-cover.png`));
  const dur = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(OUTDIR, `${name}.mp4`)]).toString().trim();
  if (!KEEP) fs.rmSync(PARTS, { recursive: true, force: true });
  console.log(`\nReel: marketing/out/${name}.mp4 (${(+dur).toFixed(1)} s, 1080x1920)` + (cover ? `\nCover: marketing/out/${name}-cover.png` : ""));
})().catch((e) => { console.error(e.message || e); process.exit(1); });
