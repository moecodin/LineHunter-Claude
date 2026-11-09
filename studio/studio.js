// LineHunter Studio (hidden page, studio.html): turn tonight's slate into post-ready images.
//   1 Source  (Hit List cards, BBQ Chicken, Brick City, Streaks, The Board, one game's matchup, a single player card)
//   2 Rows    (tick, reorder, edit any text, add your own)
//   3 Design + size, 4 Photo (library / uploads, zoom, reframe, brightness, look, flip) + text, 5 Style (presets, fonts,
//   heading format, sizes, background, colors, show / hide), then on-card editing (select, drag, resize, recolor, hide,
//   double-click to retype), undo / redo, export (PNG / JPG / WebP, 1x / 2x, all 3 sizes) and a caption writer.
// The data is the slate js/components/top-hit-rates.js already builds (event "lh-top-slate"): no extra requests except
// BBQ Chicken's defenses (bbq.js). The designs live in studio/designs/ (see _shared.js), photos in studio/photos/.
// html2canvas can't draw blend modes, masks, object-position, flips or patterned backgrounds, so the photo (crop, flip,
// tint) and the background are drawn on canvases first; preview and export use the same pictures.

(function () {
"use strict";
// Everything lives inside this function so no name can collide with the site's shared scripts (WINDOWS, mix, esc ... exist there).

const SIZES = { post: { w: 1080, h: 1350, label: "Post 4:5" }, square: { w: 1080, h: 1080, label: "Square 1:1" }, story: { w: 1080, h: 1920, label: "Story 9:16" } };
const STUDIO_NOTE = "Based on past results, not guarantees. Please gamble responsibly. 21+.\nProblem gambling? Call 1-800-GAMBLER. linehunterapp.com";
const LOGO_DARK = "assets/img/lh-lockup-on-dark.svg", LOGO_LIGHT = "assets/img/lh-lockup-on-light.svg";
const STREAK_SOURCES = [
  { id: "s-nuggets", label: "30+ PTS", title: "30-point streaks", stat: "30+ PTS", pick: (p) => (p.nuggets && p.nuggets.count >= 2 ? p.nuggets.count : 0) },
  { id: "s-reb", label: "Rebounds", title: "Rebounds streaks", stat: "10+ REB", pick: (p) => p.streaks.reb },
  { id: "s-ast", label: "Assists", title: "Assists streaks", stat: "8+ AST", pick: (p) => p.streaks.ast },
  { id: "s-3pm", label: "3PM", title: "Threes streaks", stat: "3+ 3PM", pick: (p) => p.streaks.fg3m },
];
const WINDOWS = [5, 10, 20];
const MIN_GAMES = { 5: 5, 10: 8, 20: 12 };
const FOOT_STREAK = "Find your next streak free on LineHunter", FOOT_RESEARCH = "Free research every night on LineHunter";
const HEAD_FONTS = ["Clash Display", "General Sans", "Cabinet Grotesk", "Switzer", "Boska", "Zodiak", "Gambetta", "Bebas Neue", "Satoshi"];
const BODY_FONTS = ["Satoshi", "General Sans", "Switzer", "Cabinet Grotesk", "Zodiak"];
const LOCKED_ELS = new Set(["credit", "foot"]); // can't be hidden: the photo credit and the disclaimer
const EL_NAMES = { hero: "Big text", title: "Title", sub: "Subtitle", list: "Rows", foot: "Footer", logo: "Logo", site: "Website", photo: "Photo", credit: "Photo credit", kicker: "Top label", block: "Color block", name: "Player name", edge: "Edge text" };
const STYLE0 = () => ({ fontHead: "", fontBody: "", fw: "", ls: null, upper: false, hero: 100, title: 100, rows: 100, bg: "", colors: {}, off: {} });
const ADJ0 = () => ({ zoom: 100, fx: null, fy: null, bright: 100, mode: "", tint: 100, flip: false, fade: null, vignette: false });

const S = {
  slate: null, groups: [], res: null, localPhotos: [], source: null, rows: [], win: 10, players: [],
  design: "night-poster", designByKind: { list: "night-poster", player: "player-card" }, size: "post",
  photoId: "none", fields: {}, photos: [], uploads: [],
  style: STYLE0(), edits: {}, photoAdj: {},
  editing: false, sel: null, openRow: -1, fmt: "png", scale: 1, cap: { plat: "x", dirty: false },
};

// ---------- Small helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hexRgb = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); const n = m ? parseInt(m[1], 16) : 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbHex = (c) => "#" + c.map((x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full or blocked */ } } };
const designById = (id) => STUDIO_DESIGNS.find((d) => d.id === id);
const kindOf = () => (S.source && S.source.kind) || "list";
const designsForKind = (kind) => STUDIO_DESIGNS.filter((d) => (d.kinds || ["list"]).includes(kind));
const curDesign = () => designById(S.design);
function dateLabel(iso) { if (!iso) return ""; return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }); }
function tipLabel(tip) { if (!tip || !/T\d/.test(tip)) return ""; const d = new Date(tip); return isNaN(d) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
const STAT_CODE = (code) => String(code || "").toUpperCase();

// ---------- Lock ----------
async function sha(text) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
const WORDS = [["copper", "harbor", "velvet", "maple", "signal", "granite", "ember", "cobalt", "juniper", "saffron"], ["lantern", "orbit", "falcon", "meadow", "anchor", "quartz", "thunder", "willow", "compass", "marble"], ["drift", "spark", "trail", "summit", "echo", "bridge", "comet", "ridge", "harvest", "tide"]];
function newPassphrase() { const r = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n; return WORDS.map((a) => a[r(a.length)]).join("-") + "-" + (10 + r(90)); }
function setLocked(locked) { $("stLock").hidden = !locked; document.body.style.overflow = locked ? "hidden" : ""; }
async function unlock() {
  const typed = $("stPass").value.trim().toLowerCase();
  if (!typed) return;
  if ((await sha(typed)) === window.STUDIO_PASS_HASH) { try { localStorage.setItem("lh-studio-ok", window.STUDIO_PASS_HASH); } catch (e) { /* blocked */ } $("stErr").textContent = ""; setLocked(false); startStudio(); }
  else $("stErr").textContent = "That passphrase doesn't match.";
}
async function generatePass() {
  const p = newPassphrase(), h = await sha(p);
  $("stNewPass").textContent = p; $("stNewHash").textContent = `window.STUDIO_PASS_HASH = "${h}";`; $("stGenBox").hidden = false;
}

// ---------- Sources ----------
// The slate's prop rows, at a window: the side that hit more often, with its record. null when the sample is too small.
function propPick(row, n) {
  const w = row.w && row.w[n];
  if (!w || w.totalGames < Math.min(MIN_GAMES[n], n)) return null;
  const side = w.over.hits >= w.under.hits ? "over" : "under";
  return { row, side, hits: w[side].hits, total: w.totalGames, rate: w[side].hits / w.totalGames };
}
function propRow(p) {
  const r = p.row;
  return { full: r.name, n: shortName(r.name), t: r.team, stat: `${p.side === "over" ? "Over" : "Under"} ${r.line} ${STAT_CODE(r.code)}`, rec: `${p.hits}/${p.total}` };
}
function boardRows(n) {
  const best = {};
  (S.slate.rows || []).forEach((row) => { const p = propPick(row, n); if (p && (!best[row.playerId] || p.rate > best[row.playerId].rate || (p.rate === best[row.playerId].rate && p.total > best[row.playerId].total))) best[row.playerId] = p; });
  return Object.values(best).sort((a, b) => b.rate - a.rate || b.total - a.total).slice(0, 10).map(propRow);
}
function matchupRows(gameId, n) {
  return (S.slate.rows || []).filter((row) => String(row.gameId) === String(gameId)).map((row) => propPick(row, n)).filter(Boolean)
    .sort((a, b) => b.rate - a.rate || b.total - a.total).slice(0, 10).map(propRow);
}
function buildSources(slate) {
  const hit = [], streaks = [], props = [], games = [];
  HITLIST_CATEGORIES.filter((c) => !c.bbq && !c.brick).forEach((cat) => {
    const slip = buildSlip(cat, slate);
    if (!slip) return;
    hit.push({ id: "h-" + cat.key, kind: "list", label: cat.label, title: cat.label, hero: "100%", footer: FOOT_STREAK, rows: slip.map((p) => ({
      full: p.hunt ? p.hunt.player : p.name, n: p.hunt ? shortName(p.hunt.player) : p.name, t: p.hunt ? p.hunt.team : "", stat: p.text, rec: p.proof })) });
  });
  if (typeof brickPicks === "function") {
    const bricks = brickPicks(slate);
    if (bricks.length) hit.push({ id: "h-brick", kind: "list", label: "Brick City", title: "Brick City", hero: "Cold", sub: "cold shooters", footer: FOOT_RESEARCH,
      rows: bricks.map((b) => ({ full: b.player.name, n: shortName(b.player.name), t: b.player.team, stat: `${b.l5.toFixed(1)}% FG L5`, rec: `−${b.drop.toFixed(1)} FG%` })) });
  }
  const fan = slate.fan || [];
  STREAK_SOURCES.forEach((src) => {
    const rows = fan.map((p) => ({ p, n: src.pick(p) })).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 10)
      .map((x) => ({ full: x.p.name, n: shortName(x.p.name), t: x.p.team, stat: src.stat, rec: `${x.n} straight` }));
    if (rows.length) streaks.push({ id: src.id, kind: "list", label: src.label, title: src.title, hero: "100%", footer: FOOT_STREAK, rows });
  });
  if ((slate.rows || []).length) {
    props.push({ id: "board", kind: "list", label: "The Board", title: "Top hit rates", heroFn: (n) => `L${n}`, footer: FOOT_RESEARCH, windowed: true, build: (n) => boardRows(n) });
    const seen = new Map();
    slate.rows.forEach((r) => { if (r.gameLabel && !seen.has(r.gameId)) seen.set(r.gameId, r); });
    seen.forEach((r, gameId) => games.push({ id: "g-" + gameId, kind: "list", label: r.gameLabel, title: "Matchup trends", hero: r.gameLabel, sub: tipLabel(r.tip), footer: FOOT_RESEARCH,
      windowed: true, teams: r.gameLabel.split(" @ "), build: (n) => matchupRows(gameId, n) }));
  }
  S.players = (slate.rows || []).slice().sort((a, b) => a.name.localeCompare(b.name) || String(a.code).localeCompare(b.code));
  return [{ label: "Hit List cards", items: hit }, { label: "Streaks", items: streaks }, { label: "Props", items: props }, { label: "Matchups", items: games }].filter((g) => g.items.length);
}
// BBQ Chicken needs the league's defenses (one cached request), so it joins the Hit List group when that answer is in.
async function addBbqSource(slate) {
  if (typeof bbqPicksFor !== "function") return;
  let picks = [];
  try { picks = await bbqPicksFor(slate); } catch (e) { picks = []; }
  if (!picks.length || S.slate !== slate) return;
  const item = { id: "h-bbq", kind: "list", label: "BBQ Chicken", title: "BBQ Chicken", hero: "Easy", sub: "easiest matchups", footer: FOOT_RESEARCH,
    rows: picks.map((p) => ({ full: p.player.name, n: shortName(p.player.name), t: p.player.team, stat: `${p.player.matchup} · ${bbqOrdinal(p.rank)} most`, rec: `${formatStatValue(p.average)} ${p.stat.label}` })) };
  let group = S.groups.find((g) => g.label === "Hit List cards");
  if (!group) { group = { label: "Hit List cards", items: [] }; S.groups.unshift(group); }
  if (!group.items.some((i) => i.id === item.id)) group.items.push(item);
  renderControls();
}
// A single player + prop: the side that hit more often in the window, the games oldest first.
function playerSource(row) {
  return { id: `p-${row.gameId}-${row.playerId}-${row.code}-${row.line}`, kind: "player", label: row.name, row, windowed: true, footer: FOOT_RESEARCH };
}
function playerData(row, n) {
  const w = row.w && row.w[n] ? row.w[n] : { games: row.games || [], totalGames: (row.games || []).length, over: { hits: row.hits || 0 }, under: { hits: 0 } };
  const side = w.over.hits >= w.under.hits ? "over" : "under";
  const games = (w.games || []).slice().reverse().map((g) => ({ v: g.value, hit: g.overUnder === side, opp: `${g.homeAway === "away" ? "@" : ""}${g.opponent || ""}`, date: g.date }));
  const total = games.length, hits = games.filter((g) => g.hit).length, avg = total ? games.reduce((s, g) => s + g.v, 0) / total : 0;
  const parts = row.name.split(" ");
  return { first: parts[0], last: parts.slice(1).join(" "), team: row.team, code: STAT_CODE(row.code), line: row.line, side, games, hits, total, avg, win: n, matchup: row.matchup, tip: row.tip };
}
function sourceRows(item) { return item.build ? item.build(S.win) : item.rows || []; }
function chooseSource(item, keepFields) {
  const prevKind = kindOf();
  S.source = item; S.sel = null; S.openRow = -1;
  const date = dateLabel(S.slate && S.slate.date);
  if (item.kind === "player") {
    const p = playerData(item.row, S.win);
    S.rows = [];
    const fresh = { name: item.row.name, hero: `${p.hits}/${p.total}`, title: `${p.side === "over" ? "Over" : "Under"} ${p.line} ${p.code}`,
      subtitle: [item.row.matchup, date, tipLabel(item.row.tip)].filter(Boolean).join(" · "), footer: item.footer, kicker: "Tonight's research" };
    S.fields = keepFields ? { ...fresh, ...pick(S.fields, ["name", "subtitle", "footer"]) } : fresh;
  } else {
    S.rows = sourceRows(item).map((r, i) => ({ ...r, id: i, on: item.research || i < 7 }));
    const fresh = item.research ? resFields() : { hero: item.heroFn ? item.heroFn(S.win) : item.hero || "100%", title: item.title, subtitle: [date, item.sub].filter(Boolean).join(" · "), footer: item.footer || FOOT_STREAK, kicker: "Tonight's research" };
    S.fields = keepFields && !item.research ? { ...fresh, ...pick(S.fields, ["title", "subtitle", "footer", "kicker"]) } : fresh;
  }
  if (kindOf() !== prevKind || !designsForKind(kindOf()).some((d) => d.id === S.design)) {
    const want = S.designByKind[kindOf()];
    S.design = designsForKind(kindOf()).some((d) => d.id === want) ? want : designsForKind(kindOf())[0].id;
  }
  autoPhoto();
  S.cap.dirty = false;
  renderControls(); renderAll();
}
const pick = (o, keys) => keys.reduce((a, k) => { if (o && o[k] != null) a[k] = o[k]; return a; }, {});

// ---------- Research source: any player's numbers, no lines ----------
// One source ("Player stats") for research-mode posts: search any active player, pick the games (last game, L5 / L10 / L20, season),
// the stats on the card (in tap order) and the big number. Every row and field stays editable like any other source.
const RES_STATS = [
  { k: "pts", label: "Points", code: "PTS" }, { k: "reb", label: "Rebounds", code: "REB" }, { k: "ast", label: "Assists", code: "AST" },
  { k: "fg3m", label: "Threes made", code: "3PM" }, { k: "pra", label: "Pts + reb + ast", code: "PRA", sum: ["pts", "reb", "ast"] },
  { k: "stl", label: "Steals", code: "STL" }, { k: "blk", label: "Blocks", code: "BLK" }, { k: "turnover", label: "Turnovers", code: "TOV" },
  { k: "oreb", label: "Offensive rebounds", code: "OREB" }, { k: "min", label: "Minutes", code: "MIN" },
  { k: "fg", label: "Field goals", code: "FG", made: "fgm", att: "fga" }, { k: "fg3", label: "Threes", code: "3PT", made: "fg3m", att: "fg3a" },
  { k: "ft", label: "Free throws", code: "FT", made: "ftm", att: "fta" },
  { k: "fg_pct", label: "Field goal %", code: "FG%", pct: ["fgm", "fga"] }, { k: "fg3_pct", label: "Three-point %", code: "3P%", pct: ["fg3m", "fg3a"] },
  { k: "ft_pct", label: "Free throw %", code: "FT%", pct: ["ftm", "fta"] },
];
const RES_RANGES = [["last", "Last game"], [5, "L5"], [10, "L10"], [20, "L20"], ["season", "Season"]];
const RES0 = () => ({ id: null, name: "", team: "", stats: ["pts", "reb", "ast", "fg3m", "fg_pct", "min"], hero: "pts", range: 10 });
const resStat = (k) => RES_STATS.find((s) => s.k === k);
const resMinutes = (log) => String(log.min || "0").split(":").reduce((a, p, i) => a + (Number(p) || 0) / (i ? 60 : 1), 0);
const seasonName = (y) => `${y}-${String(y + 1).slice(2)} season`;
function saveRes() { const { entry, ...keep } = S.res; store.set("lh-studio-res", keep); }
// The games the card covers, newest first, and how to say it ("Last 10 games", "2026-27 season").
function resGames() {
  const e = S.res.entry; if (!e) return { games: [], label: "" };
  const cur = e.current.filter(playedInGame), prev = e.previous.filter(playedInGame), r = S.res.range;
  if (r === "season") return cur.length ? { games: cur, label: seasonName(currentSeasonYear()) } : { games: prev, label: seasonName(currentSeasonYear() - 1) };
  const all = cur.concat(prev);
  if (r === "last") return { games: all.slice(0, 1), label: "Last game" };
  const g = all.slice(0, r);
  return { games: g, label: `Last ${g.length} games${g.length > cur.length && cur.length ? " (incl. last season)" : !cur.length ? " (last season)" : ""}` };
}
// One stat over those games: the game's number for one game, else per game; made-attempted as "9-18"; percentages pooled.
function resValue(st, games) {
  if (!st || !games.length) return "–";
  const n = games.length, one = n === 1;
  const sum = (key) => games.reduce((a, g) => a + (key === "min" ? resMinutes(g) : Number(g[key]) || 0), 0);
  if (st.pct) { const att = sum(st.pct[1]); return att ? `${((sum(st.pct[0]) / att) * 100).toFixed(1)}%` : "–"; }
  if (st.made) return one ? `${sum(st.made)}-${sum(st.att)}` : `${(sum(st.made) / n).toFixed(1)}-${(sum(st.att) / n).toFixed(1)}`;
  const v = st.sum ? st.sum.reduce((a, k) => a + sum(k), 0) : sum(st.k);
  return one ? String(Math.round(v)) : (v / n).toFixed(1);
}
function resRows() {
  const { games } = resGames(); if (!games.length) return [];
  return S.res.stats.map(resStat).filter(Boolean).map((st) => ({ full: S.res.name, n: st.label, t: "", hideTeam: true, stat: st.made ? "made-att" : "", rec: resValue(st, games) }));
}
function resFields() {
  const base = { footer: FOOT_RESEARCH, kicker: "Player research" };
  const { games, label } = resGames();
  if (!S.res.name) return { ...base, hero: "–", title: "Pick a player", subtitle: "Search any NBA player above" };
  if (!games.length) return { ...base, hero: "–", title: S.res.name, subtitle: S.res.entry ? "No games played yet" : "Loading games…" };
  const h = resStat(S.res.hero) || resStat(S.res.stats[0]) || resStat("pts"), g = games[0];
  let sub;
  if (S.res.range === "last") {
    const home = g.isHome, mine = home ? g.game.home_team_score : g.game.visitor_team_score, theirs = home ? g.game.visitor_team_score : g.game.home_team_score;
    const result = mine && theirs ? ` · ${mine > theirs ? "W" : "L"} ${mine}-${theirs}` : "";
    sub = `${h.label} ${home ? "vs" : "@"} ${g.opponent} · ${dateLabel(String(g.game.date).slice(0, 10))}${result}`;
  } else sub = `${h.label}${h.pct || h.made ? "" : " per game"} · ${label}`;
  return { ...base, kicker: h.label, hero: resValue(h, games), title: S.res.name, subtitle: sub };
}
function researchSource() {
  return { id: "research", kind: "list", label: "Player stats", research: true, footer: FOOT_RESEARCH, get teams() { return S.res.team ? [S.res.team] : []; }, build: () => resRows() };
}
const researchGroup = () => ({ label: "Research", items: [researchSource()] });
async function resLoad(player) {
  S.res = { ...S.res, id: player.id, name: player.name, team: player.team || "", entry: null }; saveRes();
  $("stResMsg").textContent = `Loading ${player.name}'s games…`;
  if (S.source && S.source.research) chooseSource(S.source);
  const want = player.id;
  try {
    const out = await loadPlayerGameLogs([want], 20);
    if (S.res.id !== want) return;
    S.res.entry = out.logsByPlayer[want];
    const newest = S.res.entry.current.concat(S.res.entry.previous)[0];
    if (newest && newest.team && newest.team.abbreviation) S.res.team = newest.team.abbreviation;
    saveRes(); $("stResMsg").textContent = "";
  } catch (e) { if (S.res.id === want) $("stResMsg").textContent = "Couldn't load this player's games. Try again in a moment."; }
  if (S.source && S.source.research) chooseSource(S.source);
}
let resTimer = 0, resToken = 0;
async function resSearch(text) {
  const words = norm(text).split(/\s+/).filter(Boolean), list = $("stResList");
  if (!words.length) { list.hidden = true; return; }
  const token = ++resToken, longest = words.reduce((a, b) => (b.length > a.length ? b : a));
  try {
    const res = await fetch(`/api/bdl/v1/players/active?search=${encodeURIComponent(longest)}&per_page=50`);
    if (!res.ok) throw new Error(res.status);
    const json = await res.json(); if (token !== resToken) return;
    const hits = json.data.filter((p) => words.every((w) => norm(`${p.first_name} ${p.last_name}`).includes(w))).slice(0, 8);
    list.innerHTML = hits.length ? hits.map((p) => `<button type="button" data-resp="${p.id}" data-name="${esc(`${p.first_name} ${p.last_name}`)}" data-team="${esc((p.team && p.team.abbreviation) || "")}">${esc(`${p.first_name} ${p.last_name}`)} <small>${esc((p.team && p.team.abbreviation) || "")}</small></button>`).join("") : `<div class="st-res-none">No active player matches</div>`;
    list.hidden = false;
  } catch (e) { if (token === resToken) { list.innerHTML = `<div class="st-res-none">Search is unavailable right now.</div>`; list.hidden = false; } }
}
function renderResearchUi() {
  const on = !!(S.source && S.source.research); $("stResWrap").hidden = !on; if (!on) return;
  $("stResWho").innerHTML = S.res.name ? `<b>${esc(S.res.name)}</b>${S.res.team ? ` · ${esc(S.res.team)}` : ""}` : "No player picked yet";
  $("stResRange").innerHTML = RES_RANGES.map(([v, l]) => `<button type="button" class="${String(S.res.range) === String(v) ? "on" : ""}" data-rrange="${v}">${l}</button>`).join("");
  $("stResStats").innerHTML = RES_STATS.map((s) => { const i = S.res.stats.indexOf(s.k); return chip(i >= 0 ? `${i + 1} · ${s.code}` : s.code, i >= 0, `data-rstat="${s.k}" title="${esc(s.label)}"`); }).join("");
  $("stResHero").innerHTML = S.res.stats.map(resStat).filter(Boolean).map((s) => `<option value="${s.k}"${s.k === S.res.hero ? " selected" : ""}>${esc(s.label)}</option>`).join("");
}
function bindResearch() {
  $("stResSearch").addEventListener("input", (e) => { clearTimeout(resTimer); const v = e.target.value; resTimer = setTimeout(() => resSearch(v), 250); });
  $("stResSearch").addEventListener("keydown", (e) => { if (e.key === "Escape") { $("stResList").hidden = true; e.target.value = ""; } });
  $("stResWrap").addEventListener("click", (e) => {
    const t = e.target.closest("[data-resp],[data-rrange],[data-rstat]"); if (!t) return;
    const ds = t.dataset;
    if (ds.resp) { $("stResList").hidden = true; $("stResSearch").value = ""; return resLoad({ id: +ds.resp, name: ds.name, team: ds.team }); }
    if (ds.rrange) S.res.range = /^\d+$/.test(ds.rrange) ? +ds.rrange : ds.rrange;
    if (ds.rstat) {
      const i = S.res.stats.indexOf(ds.rstat);
      if (i >= 0) { if (S.res.stats.length > 1) S.res.stats.splice(i, 1); } else S.res.stats.push(ds.rstat);
      if (!S.res.stats.includes(S.res.hero)) S.res.hero = S.res.stats[0];
    }
    saveRes(); chooseSource(S.source);
  });
  $("stResHero").onchange = (e) => { S.res.hero = e.target.value; saveRes(); chooseSource(S.source); };
}

// ---------- Photos ----------
async function loadPhotos() {
  try { const res = await fetch("studio/photos/credits.json", { cache: "no-cache" }); S.photos = res.ok ? await res.json() : []; } catch (e) { S.photos = []; }
  // Local test photos (localhost only): studio/photos/local/local.json, written by studio/tools/local-photos.sh from a folder you pick.
  S.localPhotos = [];
  if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
    try { const res = await fetch("studio/photos/local/local.json", { cache: "no-cache" }); if (res.ok) S.localPhotos = await res.json(); } catch (e) { /* none */ }
  }
  S.uploads = await idbAll();
}
let uploadUrls = {};
function allPhotos() {
  return [...S.photos.map((p) => ({ id: "lib:" + p.file, player: p.player, url: "studio/photos/" + p.file, credit: `Photo: ${p.photographer} / ${p.license}`, sa: p.shareAlike })),
    ...(S.localPhotos || []).map((p) => ({ id: "loc:" + p.file, player: p.player, url: "studio/photos/local/" + encodeURIComponent(p.file), credit: p.credit ? `Photo: ${p.credit}` : "", local: true })),
    ...S.uploads.map((u) => ({ id: "up:" + u.id, player: u.player, url: uploadUrls[u.id] || (uploadUrls[u.id] = URL.createObjectURL(u.blob)), credit: u.credit ? `Photo: ${u.credit}` : "", mine: true }))];
}
function leadName() { if (kindOf() === "player") return S.source.row.name; const lead = S.rows.find((r) => r.on); return lead ? lead.full || lead.n : ""; }
function autoPhoto() {
  const key = (t) => norm(t).replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/[^a-z]+/g, " ").trim();
  const name = key(leadName()); if (!name) { S.photoId = "none"; return; }
  const last = name.split(" ").pop(), first = name[0];
  const all = allPhotos(), same = (p) => key(p.player) === name;
  const m = all.find(same) || all.find((p) => key(p.player).split(" ").pop() === last && key(p.player)[0] === first);
  S.photoId = m ? m.id : "none";
}
function idbOpen() { return new Promise((res, rej) => { const r = indexedDB.open("lh-studio", 1); r.onupgradeneeded = () => r.result.createObjectStore("photos", { keyPath: "id" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbAll() { try { const db = await idbOpen(); return await new Promise((res) => { const q = db.transaction("photos").objectStore("photos").getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }); } catch (e) { return []; } }
async function idbPut(rec) { const db = await idbOpen(); return new Promise((res, rej) => { const t = db.transaction("photos", "readwrite"); t.objectStore("photos").put(rec); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function idbDelete(id) { const db = await idbOpen(); return new Promise((res) => { const t = db.transaction("photos", "readwrite"); t.objectStore("photos").delete(id); t.oncomplete = res; }); }
async function saveUpload() {
  const file = $("stUpFile").files[0], player = $("stUpPlayer").value.trim(), credit = $("stUpCredit").value.trim();
  if (!file || !player) { $("stUpMsg").textContent = "Pick a file and type the player's name (the credit is optional)."; return; }
  const bmp = await createImageBitmap(file); const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
  const id = "u" + Date.now(); await idbPut({ id, player, credit, blob });
  S.uploads = await idbAll(); S.photoId = "up:" + id;
  $("stUpMsg").textContent = "Saved on this device."; $("stUpFile").value = ""; renderControls(); renderAll();
}
const adjFor = (id) => ({ ...ADJ0(), ...(S.photoAdj[id] || {}) });
// How much of the photo's bottom fades out (0-100 %): the slider's value, else the design's own (designs without `fade` keep 0).
const fadeOf = (design, adj) => (adj.fade != null ? adj.fade : design.fade || 0);
function setAdj(key, value) { if (S.photoId === "none") return; S.photoAdj[S.photoId] = { ...adjFor(S.photoId), [key]: value }; store.set("lh-studio-photoadj", S.photoAdj); syncPhotoUi(); schedule(); }

const imgCache = {}, outCache = {};
function loadImg(url) { if (!imgCache[url]) imgCache[url] = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); return imgCache[url]; }
// html2canvas draws the lockup SVG clipped, so both logos are turned into PNGs first.
async function rasterLogo(url) {
  const key = "logo|" + url; if (outCache[key]) return outCache[key];
  const img = await loadImg(url); const c = document.createElement("canvas"); c.width = 924; c.height = 160; c.getContext("2d").drawImage(img, 0, 0, 924, 160);
  return (outCache[key] = c.toDataURL("image/png"));
}
// The photo, cut to exactly the design's box (so nothing else crops it), zoomed around the focus point, flipped,
// brightened and given its look (color, black and white, or a duotone from the background to the accent color).
async function processPhoto(photo, adj, design, box, maxW) {
  const t = tokensFor(design), off = S.style.off[design.id] || {};
  const mode = adj.mode || (design.photoModeFor ? design.photoModeFor(off) : design.photo === "duotone" ? "duotone" : "color");
  const fx = adj.fx == null ? design.focus.x : adj.fx, fy = adj.fy == null ? design.focus.y : adj.fy;
  const a = box.w / box.h, ow = Math.round(Math.min(maxW, box.w * S.scale));
  const key = [photo.url, a.toFixed(3), ow, adj.zoom, fx, fy, adj.bright, mode, adj.tint, adj.flip, t.bg, t.accent, design.alpha ? "a" : "", fadeOf(design, adj), adj.vignette ? "v" : "", mode === "teamduo" ? teamColorsFor().join() : ""].join("|");
  if (outCache[key]) return outCache[key];
  const img = await loadImg(photo.url), W = img.naturalWidth, H = img.naturalHeight;
  let cw = W / H > a ? H * a : W, ch = cw / a;
  cw /= adj.zoom / 100; ch /= adj.zoom / 100;
  const sx = clamp((fx / 100) * W - cw / 2, 0, W - cw), sy = clamp((fy / 100) * H - ch / 2, 0, H - ch);
  const w = Math.min(ow, Math.round(cw * 1.5)), h = Math.round(w / a);
  const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
  if (adj.flip) { g.translate(w, 0); g.scale(-1, 1); }
  g.drawImage(img, sx, sy, cw, ch, 0, 0, w, h);
  if (adj.bright !== 100 || mode !== "color") {
    const d = g.getImageData(0, 0, w, h), px = d.data, b = adj.bright / 100, s = adj.tint / 100;
    const bg = hexRgb(t.bg), lo = [bg[0] * 1.4 + 4, bg[1] * 1.4 + 4, bg[2] * 1.8 + 18];
    // Team duotone: from near-black to the player's team color (lifted a bit so dark team colors still show); else the accent.
    const tc = mode === "teamduo" ? teamColorsFor()[0] : null;
    const hi = tc ? mix(hexRgb(tc), [255, 255, 255], 0.18) : hexRgb(t.accent), tlo = [12, 12, 16];
    let seed = 1337; const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5; // same grain every render
    for (let i = 0; i < px.length; i += 4) {
      let r = px[i] * b, gg = px[i + 1] * b, bl = px[i + 2] * b;
      if (mode === "bw") { const l = 0.3 * r + 0.59 * gg + 0.11 * bl; r = gg = bl = l; }
      else if (mode === "press") { // high-contrast black and white: crushed blacks, bright whites
        const l = (0.3 * r + 0.59 * gg + 0.11 * bl) / 255, c = clamp((l - 0.5) * 2.1 + 0.44, 0, 1); r = gg = bl = Math.pow(c, 1.2) * 215; // whites stop at light gray so text on top stays readable
      } else if (mode === "grain") { // film: a little washed, lifted blacks, soft grain
        const l = 0.3 * r + 0.59 * gg + 0.11 * bl, k = 0.55, n = noise() * 34;
        r = (r + (l - r) * k) * 0.9 + 16 + n; gg = (gg + (l - gg) * k) * 0.9 + 15 + n; bl = (bl + (l - bl) * k) * 0.9 + 14 + n;
      } else if (mode === "teamduo") {
        let l = (0.3 * r + 0.59 * gg + 0.11 * bl) / 255; l = clamp((l - 0.06) * 1.2, 0, 1);
        r += (tlo[0] + (hi[0] - tlo[0]) * l - r) * s; gg += (tlo[1] + (hi[1] - tlo[1]) * l - gg) * s; bl += (tlo[2] + (hi[2] - tlo[2]) * l - bl) * s;
      }
      else if (mode === "duotone" || mode === "halftone") {
        let l = (0.3 * r + 0.59 * gg + 0.11 * bl) / 255; l = clamp((l - 0.08) * 1.25, 0, 1) * 0.85;
        r += (lo[0] + (hi[0] - lo[0]) * l - r) * s; gg += (lo[1] + (hi[1] - lo[1]) * l - gg) * s; bl += (lo[2] + (hi[2] - lo[2]) * l - bl) * s;
      }
      px[i] = r; px[i + 1] = gg; px[i + 2] = bl;
    }
    g.putImageData(d, 0, 0);
    // Halftone: the duotone redrawn as a grid of dots on the card color, each dot as big as that spot is bright.
    if (mode === "halftone") {
      const cs = Math.max(5, Math.round(w / 140)), bgc = t.bg;
      g.fillStyle = bgc; g.fillRect(0, 0, w, h);
      for (let y = cs / 2; y < h; y += cs) for (let x = (Math.floor(y / cs) % 2 ? cs : cs / 2); x < w; x += cs) {
        const i = (Math.min(h - 1, Math.floor(y)) * w + Math.min(w - 1, Math.floor(x))) * 4;
        if (px[i + 3] < 40) continue;
        const l = (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) / 255;
        const r = cs * 0.62 * Math.sqrt(clamp(l * 1.15, 0, 1)); if (r < 0.4) continue;
        g.fillStyle = `rgb(${px[i]},${px[i + 1]},${px[i + 2]})`; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    }
  }
  // Vignette: darker edges on top of any look (keeps a cut-out's transparency).
  if (adj.vignette) {
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "source-atop";
    const vg = g.createRadialGradient(w / 2, h * 0.42, Math.min(w, h) * 0.25, w / 2, h * 0.42, Math.max(w, h) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.62)"); g.fillStyle = vg; g.fillRect(0, 0, w, h); g.restore();
  }
  // Fade: the bottom part of the photo turns see-through (not painted in the card color), so it blends into any background.
  const fade = fadeOf(design, adj);
  if (fade > 0) {
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "destination-out";
    const gr = g.createLinearGradient(0, h * (1 - fade / 100), 0, h); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(0.55, "rgba(0,0,0,.6)"); gr.addColorStop(1, "rgba(0,0,0,1)");
    g.fillStyle = gr; g.fillRect(0, 0, w, h); g.restore();
  }
  // A cut-out (transparent background) shows through at the edges: check a few edge points so a design can place it differently.
  let alpha = false;
  if (design.alpha) { const pts = [[0, 0], [w - 1, 0], [0, h >> 1], [w - 1, h >> 1], [w >> 1, 0], [w >> 2, 0], [(3 * w) >> 2, 0]]; alpha = pts.some(([x, y]) => g.getImageData(x, y, 1, 1).data[3] < 200); }
  const out = { alpha, url: design.alpha || fade > 0 ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.92), src: { W, H, cw, ch } };
  return (outCache[key] = out);
}

// ---------- Style ----------
function tokensFor(design) { return { ...design.tokens, ...(S.style.colors[design.id] || {}) }; }
function saveStyle() { store.set("lh-studio-style", S.style); }
// The CSS variables the designs read (colors, fonts, heading format), on a wrapper around the card.
function themeAttrs(design, data) {
  const t = tokensFor(design), st = S.style, q = (f) => `'${f}'`;
  const vars = `--c-bg:${t.bg};--c-ink:${t.ink};--c-mut:${t.mut};--c-accent:${t.accent};--c-good:${t.good || t.accent};--c-rule:${t.rule};--c-bg-rgb:${hexRgb(t.bg)};--c-accent-rgb:${hexRgb(t.accent)};--c-ink-rgb:${hexRgb(t.ink)};--f-head:${q(st.fontHead || "Clash Display")};--f-body:${q(st.fontBody || "Satoshi")};--h-ls:${(st.ls || 0) / 100}em;--h-fw:${st.fw || 700};width:${data.w}px;height:${data.h}px`;
  return `class="st-theme" style="${vars}"${st.ls != null ? " data-ls" : ""}${st.upper ? " data-up" : ""}${st.fw ? " data-fw" : ""}`;
}
async function ensureFonts() {
  if (!document.fonts) return;
  const fams = [S.style.fontHead || "Clash Display", S.style.fontBody || "Satoshi"];
  await Promise.all(fams.flatMap((f) => ["400", "500", "600", "700", "800"].map((w) => document.fonts.load(`${w} 40px "${f}"`).catch(() => null))));
}
// Background layer (gradient, dots, lines, grid, team colors), drawn on a canvas so the export matches the preview.
function teamColorsFor() {
  const info = (abbr) => (typeof TEAM_INFO !== "undefined" && TEAM_INFO[abbr] ? TEAM_INFO[abbr].colors.primary : null);
  if (S.source && S.source.teams) return S.source.teams.map(info).filter(Boolean);
  const team = kindOf() === "player" ? S.source.row.team : (S.rows.find((r) => r.on) || {}).t;
  return [info(team)].filter(Boolean);
}
function backgroundImage(design, w, h, cardBg) {
  const mode = S.style.bg; if (!mode) return null;
  const t = { ...tokensFor(design), ...(cardBg ? { bg: cardBg } : {}) }, bg = hexRgb(t.bg), ink = hexRgb(t.ink), ac = hexRgb(t.accent), team = teamColorsFor();
  const key = ["bg", mode, w, h, t.bg, t.ink, t.accent, team.join(",")].join("|"); if (outCache[key]) return outCache[key];
  const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
  g.fillStyle = t.bg; g.fillRect(0, 0, w, h);
  const rgba = (rgb, a) => `rgba(${rgb.map(Math.round).join(",")},${a})`;
  if (mode === "gradient") { const gr = g.createLinearGradient(0, 0, w * 0.6, h); gr.addColorStop(0, rgbHex(mix(bg, ac, 0.55))); gr.addColorStop(0.7, t.bg); gr.addColorStop(1, t.bg); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
  if (mode === "team") {
    const cols = team.length ? team.map(hexRgb) : [ac];
    const gr = g.createLinearGradient(0, 0, w, h * 0.8);
    gr.addColorStop(0, rgbHex(mix(cols[0], bg, 0.25))); if (cols[1]) gr.addColorStop(0.5, rgbHex(mix(cols[1], bg, 0.35))); gr.addColorStop(cols[1] ? 1 : 0.75, t.bg); if (!cols[1]) gr.addColorStop(1, t.bg);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = rgba(ink, 0.05); g.lineWidth = 10; for (let x = -h; x < w; x += 46) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.stroke(); }
  }
  if (mode === "dots") { g.fillStyle = rgba(ink, 0.11); for (let y = 13; y < h; y += 26) for (let x = 13; x < w; x += 26) { g.beginPath(); g.arc(x, y, 2.4, 0, Math.PI * 2); g.fill(); } }
  if (mode === "lines") { g.strokeStyle = rgba(ink, 0.06); g.lineWidth = 7; for (let x = -h; x < w; x += 24) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.stroke(); } }
  if (mode === "grid") { g.strokeStyle = rgba(ink, 0.07); g.lineWidth = 2; for (let x = 0; x <= w; x += 54) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } for (let y = 0; y <= h; y += 54) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } }
  return (outCache[key] = c.toDataURL("image/png"));
}

// ---------- Building a card ----------
// The data for a design at a size, the photo processed for that design's photo box, the background and the on-card edits.
// Returns a detached element (the .st-theme wrapper with the card in it).
async function buildCard(design, sizeKey, opts = {}) {
  const size = SIZES[sizeKey], off = S.style.off[design.id] || {};
  await ensureFonts();
  const data = {
    w: size.w, h: size.h, rows: S.rows.filter((r) => r.on).map((r) => ({ ...r, t: r.hideTeam ? "" : r.t })),
    hero: S.fields.hero, title: S.fields.title, subtitle: S.fields.subtitle, footer: S.fields.footer, kicker: S.fields.kicker, name: S.fields.name,
    note: off.showSite ? STUDIO_NOTE : STUDIO_NOTE.replace(/\s*linehunterapp\.com$/, ""), photo: null, logo: await rasterLogo(LOGO_DARK), logoLight: await rasterLogo(LOGO_LIGHT),
    style: { hero: S.style.hero / 100, title: S.style.title / 100, rows: S.style.rows / 100, showLogo: !off.showLogo, showSub: !off.showSub, showPips: !off.showPips, showKicker: !off.showKicker, showValues: !off.showValues, showSite: !off.showSite, teamColor: !off.teamColor, sidePhoto: !off.sidePhoto, showEdge: !off.showEdge, naturalPhoto: !off.naturalPhoto },
  };
  if (kindOf() === "player") data.player = playerData(S.source.row, S.win);
  if (design.teamSwitch) {
    // Team color switch: the team's main color, a little darker so light text reads on it; a picked Background color wins.
    const custom = (S.style.colors[design.id] || {}).bg, tc = teamColorsFor()[0];
    data.cardBg = custom || (data.style.teamColor ? (tc ? rgbHex(mix(hexRgb(tc), [0, 0, 0], 0.22)) : "#1d2a52") : tokensFor(design).bg);
  }
  data.rows = data.rows.slice(0, design.capacity(data, data));
  const sel = allPhotos().find((p) => p.id === S.photoId);
  if (sel) {
    data.photo = { url: sel.url, credit: sel.credit, player: sel.player };
    design.render(data); // first pass: the design reports its photo box
    try { const out = await processPhoto(sel, adjFor(sel.id), design, data.photoBox, opts.thumb ? 420 : 2400); data.photo.url = out.url; data.photo.cutout = out.alpha; data.photoSrc = out.src; }
    catch (e) { data.photo = null; }
  }
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div ${themeAttrs(design, data)}>${design.render(data)}</div>`;
  const theme = wrap.firstElementChild, card = theme.firstElementChild;
  const bg = backgroundImage(design, data.w, data.h, data.cardBg);
  if (bg) card.insertAdjacentHTML("afterbegin", `<img class="st-bgimg" src="${bg}" alt="">`);
  applyEdits(theme, design);
  return { el: theme, data, design };
}
function applyEdits(root, design) {
  const edits = S.edits[design.id] || {};
  root.querySelectorAll("[data-el]").forEach((el) => {
    const e = edits[el.dataset.el]; if (!e) return;
    if (e.dx || e.dy || (e.s && e.s !== 1)) { el.style.transform = `translate(${e.dx || 0}px,${e.dy || 0}px) scale(${e.s || 1})`; el.style.transformOrigin = "0 0"; }
    if (e.color) el.style.color = e.color;
    if (e.hide && !LOCKED_ELS.has(el.dataset.el)) el.style.visibility = "hidden";
  });
}

// ---------- Preview, thumbnails ----------
let renderToken = 0, previewK = 1, previewData = null, raf = 0, thumbTimer = 0;
function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => renderAll()); }
async function renderAll() {
  if (!S.source) return;
  const token = ++renderToken, design = curDesign();
  const { el, data } = await buildCard(design, S.size);
  if (token !== renderToken) return;
  const host = $("stPv"); host.innerHTML = "";
  const scaler = document.createElement("div"); scaler.className = "st-scale"; scaler.id = "stScale"; scaler.appendChild(el); host.appendChild(scaler);
  previewK = host.clientWidth / data.w; host.style.height = Math.round(data.h * previewK) + "px"; scaler.style.transform = `scale(${previewK})`;
  previewData = data;
  host.classList.toggle("st-editing", S.editing);
  if (S.sel) { const s = host.querySelector(`[data-el="${S.sel}"]`); if (s) s.classList.add("st-sel"); else S.sel = null; }
  const cap = design.capacity(data, data);
  $("stMeta").textContent = kindOf() === "player"
    ? `${data.w} × ${data.h} · last ${S.win} games · ${S.slate ? `data for ${dateLabel(S.slate.date)}` : "player research"}`
    : `${data.w} × ${data.h} · ${data.rows.length} rows (this design fits ${cap} at this size) · ${S.slate ? `data for ${dateLabel(S.slate.date)}` : "player research"}`;
  renderEditBar(); writeCaption(); pushHistory();
  clearTimeout(thumbTimer); thumbTimer = setTimeout(renderThumbs, 350);
}
async function renderThumbs() {
  const size = SIZES[S.size];
  for (const d of designsForKind(kindOf())) {
    const box = document.querySelector(`[data-thumb="${d.id}"]`); if (!box) continue;
    const { el } = await buildCard(d, S.size, { thumb: true });
    const k = box.clientWidth / size.w; box.style.height = Math.round(size.h * k) + "px";
    box.innerHTML = ""; const s = document.createElement("div"); s.className = "st-scale"; s.style.transform = `scale(${k})`; s.appendChild(el); box.appendChild(s);
  }
}

// ---------- On-card editing ----------
function editsOf(design) { return (S.edits[design.id] = S.edits[design.id] || {}); }
function saveEdits() { store.set("lh-studio-edits", S.edits); }
function setEdit(key, patch) { const e = editsOf(curDesign()); e[key] = { ...(e[key] || {}), ...patch }; saveEdits(); schedule(); }
function renderEditBar() {
  const bar = $("stEditBar");
  if (!S.editing) { bar.hidden = true; return; }
  bar.hidden = false;
  if (!S.sel) { bar.innerHTML = `<span>Click anything on the card to select it. Drag to move it, double-click text to retype it, arrow keys nudge (Shift = bigger steps). Drag the photo to reframe it.</span>`; return; }
  const e = editsOf(curDesign())[S.sel] || {}, isPhoto = S.sel === "photo", textish = !["photo", "logo", "list", "block"].includes(S.sel);
  const adj = adjFor(S.photoId);
  bar.innerHTML = `<b>${esc(EL_NAMES[S.sel] || S.sel)}</b>
    ${isPhoto ? `<label>Zoom <input type="range" id="stE_zoom" min="100" max="300" step="5" value="${adj.zoom}"></label><span>Drag to reframe</span>`
      : `<label>Size <input type="range" id="stE_s" min="40" max="250" step="5" value="${Math.round((e.s || 1) * 100)}"></label>`}
    ${textish ? `<label>Color <input type="color" id="stE_color" value="${e.color || "#ffffff"}"></label>` : ""}
    ${LOCKED_ELS.has(S.sel) ? `<span>Always shown</span>` : `<label><input type="checkbox" id="stE_hide" ${e.hide ? "checked" : ""}> Hide</label>`}
    <span class="st-sp"></span><button class="st-chip" id="stE_reset" type="button">Reset this</button>`;
  const on = (id, ev, fn) => { const n = $(id); if (n) n.addEventListener(ev, fn); };
  on("stE_s", "input", (ev) => setEdit(S.sel, { s: +ev.target.value / 100 }));
  on("stE_zoom", "input", (ev) => setAdj("zoom", +ev.target.value));
  on("stE_color", "input", (ev) => setEdit(S.sel, { color: ev.target.value }));
  on("stE_hide", "change", (ev) => setEdit(S.sel, { hide: ev.target.checked }));
  on("stE_reset", "click", () => { if (isPhoto && S.photoId !== "none") { delete S.photoAdj[S.photoId]; store.set("lh-studio-photoadj", S.photoAdj); syncPhotoUi(); } delete editsOf(curDesign())[S.sel]; saveEdits(); schedule(); });
}
function bindCardEditing() {
  const host = $("stPv"); let drag = null;
  host.addEventListener("pointerdown", (ev) => {
    if (!S.editing || ev.target.closest('[contenteditable="true"]')) return;
    const el = ev.target.closest("[data-el]");
    host.querySelectorAll(".st-sel").forEach((n) => n.classList.remove("st-sel"));
    if (!el) { S.sel = null; renderEditBar(); return; }
    S.sel = el.dataset.el; el.classList.add("st-sel"); renderEditBar();
    const e = editsOf(curDesign())[S.sel] || {};
    drag = { el, x: ev.clientX, y: ev.clientY, moved: false, dx: e.dx || 0, dy: e.dy || 0, s: e.s || 1, adj: adjFor(S.photoId) };
    host.setPointerCapture(ev.pointerId); ev.preventDefault();
  });
  host.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const mx = (ev.clientX - drag.x) / previewK, my = (ev.clientY - drag.y) / previewK;
    if (!drag.moved && Math.abs(mx) + Math.abs(my) < 4) return;
    drag.moved = true; drag.mx = mx; drag.my = my;
    if (drag.el.dataset.el === "photo") { const img = drag.el.tagName === "IMG" ? drag.el : drag.el.querySelector("img"); if (img) img.style.transform = `translate(${mx}px,${my}px)`; }
    else { drag.el.style.transform = `translate(${drag.dx + mx}px,${drag.dy + my}px) scale(${drag.s})`; drag.el.style.transformOrigin = "0 0"; }
  });
  const end = () => {
    if (!drag) return; const d = drag; drag = null;
    if (!d.moved) return;
    if (d.el.dataset.el === "photo" && previewData && previewData.photoSrc && S.photoId !== "none") {
      // Moving the picture right shows more of its left side: the focus point moves the other way, in source pixels.
      const src = previewData.photoSrc, box = previewData.photoBox, a = d.adj;
      const fx = (a.fx == null ? curDesign().focus.x : a.fx) - (d.mx / box.w) * (src.cw / src.W) * 100 * (a.flip ? -1 : 1);
      const fy = (a.fy == null ? curDesign().focus.y : a.fy) - (d.my / box.h) * (src.ch / src.H) * 100;
      S.photoAdj[S.photoId] = { ...a, fx: Math.round(clamp(fx, 0, 100)), fy: Math.round(clamp(fy, 0, 100)) };
      store.set("lh-studio-photoadj", S.photoAdj); syncPhotoUi(); schedule();
    } else setEdit(d.el.dataset.el, { dx: Math.round(d.dx + d.mx), dy: Math.round(d.dy + d.my) });
  };
  host.addEventListener("pointerup", end); host.addEventListener("pointercancel", end);
  host.addEventListener("dblclick", (ev) => {
    if (!S.editing) return;
    // The drag code captures the pointer, so the event's target is the preview box: find the text under the pointer instead.
    const hit = document.elementFromPoint(ev.clientX, ev.clientY), el = hit && hit.closest("[data-text]"); if (!el || !host.contains(el)) return;
    el.contentEditable = "true"; el.focus();
    const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    const done = () => { el.removeEventListener("blur", done); const key = el.dataset.text; S.fields[key] = el.innerText.replace(/\s*\n\s*/g, " ").trim(); syncFieldsUi(); schedule(); };
    el.addEventListener("blur", done);
    el.addEventListener("keydown", (k) => { if (k.key === "Enter") { k.preventDefault(); el.blur(); } });
  });
  document.addEventListener("keydown", (ev) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "z" && !typing) { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
    if (!S.editing || !S.sel || typing || S.sel === "photo") return;
    const step = ev.shiftKey ? 20 : 2, mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
    if (!mv) return; ev.preventDefault();
    const e = editsOf(curDesign())[S.sel] || {}; setEdit(S.sel, { dx: (e.dx || 0) + mv[0], dy: (e.dy || 0) + mv[1] });
  });
}

// ---------- Undo / redo ----------
const hist = { list: [], i: -1, restoring: false };
function snapshot() { return JSON.stringify({ src: S.source && S.source.id, win: S.win, rows: S.rows, fields: S.fields, design: S.design, size: S.size, photoId: S.photoId, style: S.style, edits: S.edits, photoAdj: S.photoAdj }); }
function pushHistory() {
  if (hist.restoring) { hist.restoring = false; return; }
  const s = snapshot(); if (hist.list[hist.i] === s) return;
  hist.list = hist.list.slice(0, hist.i + 1); hist.list.push(s); if (hist.list.length > 80) hist.list.shift(); hist.i = hist.list.length - 1; syncUndo();
}
function restore(s) {
  const v = JSON.parse(s), item = allSources().find((i) => i.id === v.src) || S.source;
  hist.restoring = true;
  Object.assign(S, { source: item, win: v.win, rows: v.rows, fields: v.fields, design: v.design, size: v.size, photoId: v.photoId, style: v.style, edits: v.edits, photoAdj: v.photoAdj });
  saveStyle(); saveEdits(); store.set("lh-studio-photoadj", S.photoAdj); renderControls(); renderAll();
}
function undo() { if (hist.i > 0) { hist.i--; restore(hist.list[hist.i]); syncUndo(); } }
function redo() { if (hist.i < hist.list.length - 1) { hist.i++; restore(hist.list[hist.i]); syncUndo(); } }
function syncUndo() { $("stUndo").disabled = hist.i <= 0; $("stRedo").disabled = hist.i >= hist.list.length - 1; }

// ---------- Export ----------
const MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
async function drawFile(sizeKey) {
  const { el, data } = await buildCard(curDesign(), sizeKey);
  const stage = document.createElement("div"); stage.style.cssText = `position:fixed;left:-30000px;top:0;width:${data.w}px;height:${data.h}px`; stage.appendChild(el); document.body.appendChild(stage);
  try {
    const [h2c] = await Promise.all([loadHtml2Canvas(), document.fonts ? document.fonts.ready : null]);
    await Promise.all([...stage.querySelectorAll("img")].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
    const canvas = await h2c(el, { width: data.w, height: data.h, scale: S.scale, useCORS: true, backgroundColor: S.fmt === "png" ? null : tokensFor(curDesign()).bg, logging: false });
    const blob = await new Promise((r) => canvas.toBlob(r, MIME[S.fmt], 0.92));
    const name = `linehunter-${slug(kindOf() === "player" ? S.fields.name + "-" + S.fields.title : S.fields.title)}-${sizeKey}${S.scale > 1 ? "@2x" : ""}.${S.fmt}`;
    return new File([blob], name, { type: MIME[S.fmt] });
  } finally { stage.remove(); }
}
function download(file) { const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
async function exportImages(mode) {
  const btn = $({ one: "stDownload", share: "stShare", all: "stAllSizes" }[mode]); const old = btn.textContent; btn.disabled = true; btn.textContent = "Drawing…";
  try {
    const keys = mode === "all" ? Object.keys(SIZES) : [S.size], files = [];
    for (const k of keys) files.push(await drawFile(k));
    const canShare = navigator.canShare && navigator.canShare({ files });
    if ((mode === "share" || (mode === "all" && matchMedia("(pointer:coarse)").matches)) && canShare) await navigator.share({ files, title: S.fields.title });
    else for (const f of files) { download(f); await new Promise((r) => setTimeout(r, 400)); }
  } catch (e) { if (e.name !== "AbortError") { console.error(e); alert("Couldn't draw the image: " + e.message); } }
  btn.disabled = false; btn.textContent = old;
}

// ---------- Caption writer ----------
function captionText(plat) {
  const f = S.fields, rows = S.rows.filter((r) => r.on), tags = plat === "x" ? "#NBA #PlayerProps" : "#NBA #NBAProps #PlayerProps #NBAStats #LineHunter";
  const legal = plat === "x" ? "21+ | 1-800-GAMBLER" : "Based on past results, not guarantees. 21+. Gambling problem? Call 1-800-GAMBLER.";
  let lines;
  if (S.source && S.source.research) {
    const rtags = plat === "x" ? "#NBA #NBAStats" : "#NBA #NBAStats #NBATwitter #Basketball #LineHunter";
    const body = [f.title, f.subtitle, "", ...rows.map((r) => `${plat === "x" ? "" : "• "}${r.n}: ${r.rec}${r.stat ? " " + r.stat : ""}`)];
    const rtail = ["", plat === "x" ? "Free NBA research: linehunterapp.com" : "Free NBA research every night at linehunterapp.com", "", legal, "", rtags];
    let out = [...body, ...rtail].join("\n");
    while (plat === "x" && out.length > 280 && body.length > 4) { body.pop(); out = [...body, ...rtail].join("\n"); }
    return out;
  }
  if (kindOf() === "player") {
    const p = playerData(S.source.row, S.win);
    lines = [`${f.name}: ${f.title} in ${f.hero} of his last ${p.total} (avg ${p.avg.toFixed(1)} ${p.code}).`, f.subtitle];
  } else {
    const head = `${f.hero && f.hero !== f.title ? f.hero + " " : ""}${f.title}${f.subtitle ? " · " + f.subtitle : ""}`;
    lines = [head, "", ...rows.map((r) => `${plat === "x" ? "" : "• "}${r.n}${r.t && !r.hideTeam ? ` (${r.t})` : ""}: ${r.stat} · ${r.rec}`)];
  }
  const tail = plat === "x" ? ["", "Free research: linehunterapp.com", legal, tags] : ["", "Which one are you riding? 👇", "", "Free research every night at linehunterapp.com", "", legal, "", tags];
  let text = [...lines, ...tail].join("\n");
  // X: drop rows from the bottom until it fits in 280 characters.
  while (plat === "x" && text.length > 280 && lines.length > 3) { lines.pop(); text = [...lines, ...tail].join("\n"); }
  return text;
}
function writeCaption(force) {
  if (S.cap.dirty && !force) return countCaption();
  $("stCapText").value = captionText(S.cap.plat); S.cap.dirty = false; countCaption();
}
function countCaption() { const n = $("stCapText").value.length; $("stCapCount").textContent = S.cap.plat === "x" ? `${n} / 280${n > 280 ? " · too long for X" : ""}` : `${n} characters`; }

// ---------- Presets ----------
function presets() { return store.get("lh-studio-presets", []); }
function renderPresets() { const list = presets(); $("stPreset").innerHTML = list.length ? list.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join("") : `<option value="">No presets yet</option>`; }
function savePreset() {
  const name = (prompt("Name this preset (fonts, colors, sizes, background, design, size and on-card layout):", "My style") || "").trim(); if (!name) return;
  const list = presets().filter((p) => p.name !== name);
  list.push({ name, design: S.design, size: S.size, style: S.style, edits: S.edits[S.design] || {} }); store.set("lh-studio-presets", list); renderPresets();
  $("stPreset").value = String(list.length - 1);
}
function applyPreset() {
  const p = presets()[+$("stPreset").value]; if (!p) return;
  S.style = { ...STYLE0(), ...JSON.parse(JSON.stringify(p.style)) };
  if (designsForKind(kindOf()).some((d) => d.id === p.design)) { S.design = p.design; S.designByKind[kindOf()] = p.design; }
  S.size = p.size || S.size; S.edits[p.design] = JSON.parse(JSON.stringify(p.edits || {}));
  saveStyle(); saveEdits(); renderControls(); renderAll();
}
function deletePreset() { const i = +$("stPreset").value; const list = presets(); if (!list[i] || !confirm(`Delete the preset "${list[i].name}"?`)) return; list.splice(i, 1); store.set("lh-studio-presets", list); renderPresets(); }

// ---------- Controls ----------
const allSources = () => S.groups.flatMap((g) => g.items);
function chip(label, on, attrs) { return `<button type="button" class="st-chip${on ? " on" : ""}" ${attrs}>${esc(label)}</button>`; }
function renderControls() {
  const kind = kindOf();
  $("stSources").innerHTML = S.groups.map((g) => `<div class="st-lbl">${esc(g.label)}</div><div class="st-chips">${g.items.map((i) => chip(i.label, S.source && S.source.id === i.id, `data-src="${i.id}"`)).join("")}</div>`).join("");
  $("stPlayerWrap").hidden = !S.players.length;
  const pp = $("stPlayerPick");
  pp.innerHTML = `<option value="">Pick a player and prop…</option>` + S.players.map((r, i) => `<option value="${i}">${esc(r.name)} · ${STAT_CODE(r.code)} ${r.line}</option>`).join("");
  pp.value = kind === "player" ? String(S.players.indexOf(S.source.row)) : "";
  $("stWinWrap").hidden = !(S.source && S.source.windowed);
  $("stWin").innerHTML = WINDOWS.map((n) => `<button type="button" class="${S.win === n ? "on" : ""}" data-win="${n}">L${n}</button>`).join("");
  $("stRowsSec").hidden = kind === "player";
  $("stRows").innerHTML = S.rows.map((r, i) => `<div class="st-row"><input type="checkbox" data-row="${i}" ${r.on ? "checked" : ""}><span class="nm">${esc(r.n)} · ${esc(r.stat)}</span><span class="rec">${esc(r.rec)}</span><button class="st-ed${S.openRow === i ? " on" : ""}" data-edit="${i}" title="Edit this row">✎</button><button class="st-mv" data-up="${i}" title="Move up">▲</button><button class="st-mv" data-down="${i}" title="Move down">▼</button></div>` +
    (S.openRow === i ? `<div class="st-rowedit"><input class="st-in" data-rf="n" data-i="${i}" value="${esc(r.n)}" placeholder="Name"><input class="st-in" data-rf="rec" data-i="${i}" value="${esc(r.rec)}" placeholder="Record (5/5)">
      <input class="st-in" data-rf="stat" data-i="${i}" value="${esc(r.stat)}" placeholder="Stat (Over 24.5 PTS)" style="grid-column:1/-1"><input class="st-in" data-rf="t" data-i="${i}" value="${esc(r.t)}" placeholder="Team (LAL)">
      <label><input type="checkbox" data-rteam="${i}" ${r.hideTeam ? "" : "checked"}> Show team tag</label>${r.custom ? `<button class="st-chip" data-rdel="${i}" type="button">Delete this row</button>` : ""}</div>` : "")).join("");
  $("stRowsCount").textContent = S.rows.filter((r) => r.on).length + " of " + S.rows.length + " shown";
  $("stSizes").innerHTML = Object.entries(SIZES).map(([k, v]) => `<button type="button" class="${S.size === k ? "on" : ""}" data-size="${k}">${v.label}</button>`).join("");
  $("stDesigns").innerHTML = designsForKind(kind).map((d) => `<button type="button" class="st-th${S.design === d.id ? " on" : ""}" data-design="${d.id}"><div class="st-tw" data-thumb="${d.id}"></div>${esc(d.name)}</button>`).join("");
  const ph = allPhotos();
  $("stPhotos").innerHTML = `<button type="button" class="st-ph${S.photoId === "none" ? " on" : ""}" data-photo="none"><span style="padding:30px 5px;text-align:center">No photo</span></button>` +
    ph.map((p) => `<button type="button" class="st-ph${S.photoId === p.id ? " on" : ""}" data-photo="${esc(p.id)}" title="${esc(p.player)} — ${esc(p.credit || "no credit")}"><img src="${p.url}" alt=""><span>${esc(p.player)}${p.sa ? " · SA" : ""}${p.mine ? " · mine" : ""}${p.local ? " · local" : ""}</span></button>`).join("");
  const sel = ph.find((p) => p.id === S.photoId);
  $("stPhotoInfo").innerHTML = sel ? `<b>${esc(sel.player)}</b><br><span style="color:var(--st-mut)">${esc(sel.credit || "No credit")}${sel.sa ? " · share-alike: the edited image has to carry the same license" : ""}</span>` : `<span style="color:var(--st-mut)">No photo on the card.</span>`;
  $("stDelPhoto").hidden = !(sel && sel.mine);
  $("stCapPlat").innerHTML = [["x", "X"], ["ig", "Instagram"]].map(([k, l]) => `<button type="button" class="${S.cap.plat === k ? "on" : ""}" data-plat="${k}">${l}</button>`).join("");
  $("stEditToggle").classList.toggle("on", S.editing); $("stEditToggle").textContent = S.editing ? "Done editing" : "Edit on card";
  renderResearchUi(); syncFieldsUi(); syncPhotoUi(); syncStyleUi(); syncUndo();
}
function syncFieldsUi() {
  $("stNameWrap").hidden = kindOf() !== "player";
  ["name", "hero", "title", "subtitle", "footer"].forEach((k) => { if ($("stF_" + k) !== document.activeElement) $("stF_" + k).value = S.fields[k] || ""; });
}
function syncPhotoUi() {
  const has = S.photoId !== "none", a = adjFor(S.photoId), d = curDesign();
  $("stPhotoAdj").hidden = !has; $("stPhotoReset").hidden = !has; if (!has) return;
  const vals = { zoom: a.zoom, fx: a.fx == null ? d.focus.x : a.fx, fy: a.fy == null ? d.focus.y : a.fy, bright: a.bright, tint: a.tint, fade: fadeOf(d, a) };
  Object.entries(vals).forEach(([k, v]) => { $("stP_" + k).value = v; $("stPO_" + k).textContent = k === "fx" || k === "fy" ? v : v + "%"; });
  $("stP_mode").value = a.mode; $("stP_flip").checked = !!a.flip; $("stP_vig").checked = !!a.vignette;
}
function syncStyleUi() {
  const design = curDesign(), st = S.style, t = tokensFor(design);
  const fill = (id, list, cur, def) => { const el = $(id); if (!el.options.length) el.innerHTML = `<option value="">${def} (design)</option>` + list.map((f) => `<option>${f}</option>`).join(""); el.value = cur || ""; };
  fill("stS_fontHead", HEAD_FONTS, st.fontHead, "Clash Display"); fill("stS_fontBody", BODY_FONTS, st.fontBody, "Satoshi");
  ["hero", "title", "rows"].forEach((k) => { $("stS_" + k).value = st[k]; $("stO_" + k).textContent = st[k] + "%"; });
  $("stS_ls").value = st.ls == null ? 0 : st.ls; $("stO_ls").textContent = st.ls == null ? "design" : (st.ls / 100).toFixed(2) + "em";
  $("stS_up").checked = !!st.upper; $("stS_fw").value = st.fw || ""; $("stS_bg").value = st.bg || "";
  ["bg", "ink", "accent", "good"].forEach((k) => { if ($("stC_" + k) !== document.activeElement) $("stC_" + k).value = t[k] || t.accent; });
  const hasGood = !!design.tokens.good; $("stC_good").hidden = !hasGood; $("stC_goodLbl").hidden = !hasGood;
  const off = st.off[design.id] || {};
  $("stToggles").innerHTML = Object.entries(design.toggles || {}).map(([k, label]) => `<label class="st-chip${off[k] ? "" : " on"}" style="cursor:pointer"><input type="checkbox" data-tog="${k}" ${off[k] ? "" : "checked"} hidden>${esc(label)}</label>`).join("");
}
function styleChanged() { saveStyle(); syncStyleUi(); schedule(); }
function bind() {
  $("stUnlock").onclick = unlock; $("stPass").onkeydown = (e) => { if (e.key === "Enter") unlock(); };
  $("stGen").onclick = generatePass; $("stLockBtn").onclick = () => { try { localStorage.removeItem("lh-studio-ok"); } catch (e) { /* ok */ } setLocked(true); };
  $("stCopyPass").onclick = () => navigator.clipboard && navigator.clipboard.writeText($("stNewPass").textContent);
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-src],[data-up],[data-down],[data-edit],[data-rdel],[data-size],[data-design],[data-photo],[data-win],[data-plat]"); if (!t || t.closest("#stPv")) return;
    const ds = t.dataset;
    if (ds.src) return chooseSource(allSources().find((i) => i.id === ds.src));
    if (ds.win) { S.win = +ds.win; return chooseSource(S.source, true); }
    if (ds.plat) { S.cap.plat = ds.plat; S.cap.dirty = false; renderControls(); return writeCaption(true); }
    if (ds.edit != null) { S.openRow = S.openRow === +ds.edit ? -1 : +ds.edit; return renderControls(); }
    if (ds.rdel != null) { S.rows.splice(+ds.rdel, 1); S.openRow = -1; renderControls(); return schedule(); }
    if (ds.up != null || ds.down != null) { const i = +(ds.up ?? ds.down), j = ds.up != null ? i - 1 : i + 1; if (j < 0 || j >= S.rows.length) return; [S.rows[i], S.rows[j]] = [S.rows[j], S.rows[i]]; S.openRow = -1; renderControls(); return schedule(); }
    if (ds.size) S.size = ds.size;
    if (ds.design) { S.design = ds.design; S.designByKind[kindOf()] = ds.design; S.sel = null; }
    if (ds.photo) S.photoId = ds.photo;
    renderControls(); renderAll();
  });
  document.addEventListener("change", (e) => {
    const ds = e.target.dataset || {};
    if (ds.row != null) { S.rows[+ds.row].on = e.target.checked; if (S.photoId === "none" || S.photoId.startsWith("lib:")) autoPhoto(); renderControls(); renderAll(); }
    if (ds.rteam != null) { S.rows[+ds.rteam].hideTeam = !e.target.checked; schedule(); }
  });
  document.addEventListener("input", (e) => { const ds = e.target.dataset || {}; if (ds.rf) { S.rows[+ds.i][ds.rf] = e.target.value; schedule(); } });
  $("stAddRow").onclick = () => { S.rows.push({ id: Date.now(), n: "Name", full: "", t: "", stat: "Stat", rec: "0/0", on: true, custom: true }); S.openRow = S.rows.length - 1; renderControls(); schedule(); };
  $("stPlayerPick").onchange = (e) => { const r = S.players[+e.target.value]; if (r) chooseSource(playerSource(r)); };
  ["name", "hero", "title", "subtitle", "footer"].forEach((k) => $("stF_" + k).addEventListener("input", (e) => { S.fields[k] = e.target.value; schedule(); }));
  // Photo
  ["zoom", "fx", "fy", "bright", "tint", "fade"].forEach((k) => $("stP_" + k).addEventListener("input", (e) => setAdj(k, +e.target.value)));
  $("stP_mode").onchange = (e) => setAdj("mode", e.target.value); $("stP_flip").onchange = (e) => setAdj("flip", e.target.checked); $("stP_vig").onchange = (e) => setAdj("vignette", e.target.checked);
  $("stPhotoReset").onclick = () => { delete S.photoAdj[S.photoId]; store.set("lh-studio-photoadj", S.photoAdj); syncPhotoUi(); schedule(); };
  $("stUpSave").onclick = saveUpload;
  $("stDelPhoto").onclick = async () => { if (S.photoId.startsWith("up:") && confirm("Delete this uploaded photo from this device?")) { await idbDelete(S.photoId.slice(3)); S.uploads = await idbAll(); S.photoId = "none"; renderControls(); renderAll(); } };
  // Style
  $("stS_fontHead").onchange = (e) => { S.style.fontHead = e.target.value; styleChanged(); };
  $("stS_fontBody").onchange = (e) => { S.style.fontBody = e.target.value; styleChanged(); };
  $("stS_fw").onchange = (e) => { S.style.fw = e.target.value; styleChanged(); };
  $("stS_ls").addEventListener("input", (e) => { S.style.ls = +e.target.value; styleChanged(); });
  $("stS_up").onchange = (e) => { S.style.upper = e.target.checked; styleChanged(); };
  $("stS_bg").onchange = (e) => { S.style.bg = e.target.value; styleChanged(); };
  ["hero", "title", "rows"].forEach((k) => $("stS_" + k).addEventListener("input", (e) => { S.style[k] = +e.target.value; styleChanged(); }));
  ["bg", "ink", "accent", "good"].forEach((k) => $("stC_" + k).addEventListener("input", (e) => { (S.style.colors[S.design] = S.style.colors[S.design] || {})[k] = e.target.value; styleChanged(); }));
  $("stToggles").addEventListener("change", (e) => { const k = e.target.dataset.tog; if (!k) return; (S.style.off[S.design] = S.style.off[S.design] || {})[k] = !e.target.checked; styleChanged(); });
  $("stStyleReset").onclick = () => { S.style = STYLE0(); styleChanged(); };
  $("stPresetSave").onclick = savePreset; $("stPresetApply").onclick = applyPreset; $("stPresetDel").onclick = deletePreset;
  // Stage
  $("stEditToggle").onclick = () => { S.editing = !S.editing; if (!S.editing) S.sel = null; renderControls(); renderAll(); };
  $("stEditReset").onclick = () => { if (!confirm(`Put every moved, resized or hidden piece of "${curDesign().name}" back where the design has it?`)) return; delete S.edits[S.design]; S.sel = null; saveEdits(); schedule(); };
  $("stUndo").onclick = undo; $("stRedo").onclick = redo;
  $("stFmt").onchange = (e) => { S.fmt = e.target.value; }; $("stScaleSel").onchange = (e) => { S.scale = +e.target.value; };
  $("stDownload").onclick = () => exportImages("one"); $("stShare").onclick = () => exportImages("share"); $("stAllSizes").onclick = () => exportImages("all");
  $("stCapText").addEventListener("input", () => { S.cap.dirty = true; countCaption(); });
  $("stCapRewrite").onclick = () => writeCaption(true);
  $("stCapCopy").onclick = async () => { try { await navigator.clipboard.writeText($("stCapText").value); $("stCapCopy").textContent = "Copied"; setTimeout(() => { $("stCapCopy").textContent = "Copy"; }, 1500); } catch (e) { $("stCapText").select(); } };
  bindCardEditing(); bindResearch();
  let rt = 0; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(renderAll, 150); });
}

// ---------- Start ----------
function onSlate(event) {
  const slate = event.detail && event.detail.slate;
  if (!slate) { $("stStatus").textContent = (event.detail && event.detail.message ? "No slate yet. " : "") + "Waiting for tonight's games…"; return; }
  if (S.slate === slate) return;
  S.slate = slate; S.groups = [...buildSources(slate), researchGroup()];
  addBbqSource(slate);
  $("stStatus").hidden = true; $("stApp").hidden = false;
  const keep = S.source && allSources().find((i) => i.id === S.source.id);
  if (keep) chooseSource(keep, true);
  else if (S.groups.length > 1) chooseSource(S.groups[0].items[0]);
  else if (!S.players.length) chooseSource(S.groups[0].items[0]);
  else chooseSource(playerSource(S.players[0]));
}
let started = false;
async function startStudio() {
  if (started) return; started = true;
  await loadPhotos();
  S.res = { ...RES0(), ...store.get("lh-studio-res", {}) };
  // The Research source works without a slate (a night with no games, or games already started): show it right away.
  if (!S.slate) { S.groups = [researchGroup()]; $("stStatus").hidden = true; $("stApp").hidden = false; chooseSource(S.groups[0].items[0]); }
  if (S.res.id) resLoad({ id: S.res.id, name: S.res.name, team: S.res.team });
  document.addEventListener("lh-top-slate", onSlate);
  if (window.__lhPendingSlate) onSlate(window.__lhPendingSlate);
}
document.addEventListener("lh-top-slate", (e) => { window.__lhPendingSlate = e; });
addEventListener("DOMContentLoaded", () => {
  S.style = { ...STYLE0(), ...store.get("lh-studio-style", {}) };
  S.edits = store.get("lh-studio-edits", {}); S.photoAdj = store.get("lh-studio-photoadj", {});
  renderPresets(); bind();
  let ok = false; try { ok = localStorage.getItem("lh-studio-ok") === window.STUDIO_PASS_HASH; } catch (e) { /* blocked */ }
  if (ok) { setLocked(false); startStudio(); } else setLocked(true);
});

window.StudioDebug = { S, hist }; // for the console and the tests
})();
