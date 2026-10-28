// LineHunter - dev/hunt-whatif.js
// A console tool for the Hunt Score engine (not part of the site), run on localhost with the key from .env:
//   1. old engine (no Role step, CONFIG.sim.role.off) vs the engine now, for the top hunts of both
//   2. every Role step's games: date, opponent, his minutes, the stat and who was out, so a Role number can be checked
//   3. the under-bias check: how far the projections sit from the book lines, per stat and by games played this season
//   4. the calibration check: the sim's under chance vs how often each player actually went under that same line before
// Writes the same text to dev/hunt-whatif.txt (gitignored).
//
//   node dev/hunt-whatif.js                          today
//   node dev/hunt-whatif.js 2026-10-28               that date
//   node dev/hunt-whatif.js 2026-10-28 "Reaves" pra  one player + stat (the side the engine likes better)

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
if (!process.env.BALLDONTLIE_API_KEY) {
  const match = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^BALLDONTLIE_API_KEY\s*=\s*"?([^"\n\r]+)"?/m);
  if (match) process.env.BALLDONTLIE_API_KEY = match[1].trim();
}
const date = process.argv[2] || new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const nameArg = (process.argv[3] || "").toLowerCase();
const statArg = (process.argv[4] || "").toLowerCase();

// Same answers for the same URL: the second engine run reuses the first run's downloads (errors and 429s are retried for real).
const realFetch = global.fetch;
const fetchMemo = new Map();
global.fetch = (url, options) => {
  const key = String(url);
  if (!fetchMemo.has(key)) {
    fetchMemo.set(key, realFetch(url, options).then(async (r) => {
      if (!r.ok) fetchMemo.delete(key);
      return { ok: r.ok, status: r.status, body: await r.text() };
    }));
  }
  return fetchMemo.get(key).then((r) => ({ ok: r.ok, status: r.status, json: async () => JSON.parse(r.body) }));
};

const engine = require(path.join(root, "netlify/functions/hunt.js"));

const pad = (text, n) => String(text).padEnd(n);
const padL = (text, n) => String(text).padStart(n);
const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const signed = (v) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)}`;
const statWord = (code) => (code === "3pm" ? "3PM" : code.toUpperCase());
const pickText = (p) => `${p.side === "over" ? "Over" : "Under"} ${p.line} ${statWord(p.stat)}`;
const sameProp = (a, b) => a.playerId === b.playerId && a.stat === b.stat;
const oddsText = (o) => (o === null || o === undefined ? "–" : o > 0 ? `+${o}` : `${o}`);
const priceText = (p) => `${oddsText(p.odds)} · fair ${p.fair}% · edge ${p.edge > 0 ? "+" : ""}${p.edge}`;

async function runEngine({ roleOff }) {
  engine.CONFIG.sim.role.off = roleOff;
  engine.CONFIG.debug = true;         // role games and past results at the line come back in the answer
  engine.setWhatIf(null);             // clears the warm cache
  const answer = await engine.handler({ httpMethod: "GET", queryStringParameters: { date } });
  const body = JSON.parse(answer.body);
  if (answer.statusCode !== 200) throw new Error(body.error);
  return body;
}

async function teamAbbreviations() {
  const response = await fetch("https://api.balldontlie.io/v1/teams?per_page=100", { headers: { Authorization: process.env.BALLDONTLIE_API_KEY } });
  const json = await response.json();
  return Object.fromEntries((json.data || []).map((t) => [t.id, t.abbreviation]));
}

// One prop in full: old score, today's build-up, and the Role step's games.
function detailText(target, old, abbr) {
  const out = [];
  out.push(`${target.player} (${target.team} ${target.home ? "vs" : "@"} ${target.opp}) · ${pickText(target)} · ${date}`);
  const was = old.props.find((p) => sameProp(p, target) && p.side === target.side);
  if (was) out.push(`  old engine: ${was.score} · projects ${was.projection.mean} (${was.projection.p10}-${was.projection.p90})`);
  out.push("");
  out.push(`  ${pad("Season baseline", 26)} ${padL(target.base.toFixed(1), 6)}${target.teamPrior ? `   last season = his ${target.teamPrior.games} games with ${target.teamPrior.team} only${target.teamPrior.other ? ` (not ${target.teamPrior.other})` : ""}` : ""}`);
  target.factors.forEach((f) => out.push(`  ${pad(f.label, 26)} ${padL(signed(f.points), 6)}${f.key === "role" ? `   ${f.out} out` : f.key === "market" ? `   line ${f.line} vs projection ${f.sim} before the pull (gap ${f.gap}%, pulled ${f.weight}%)` : f.key === "spread" && f.bookGap ? "   wider: far from the book" : ""}`));
  out.push(`  ${pad("= Hunt Score", 26)} ${padL(target.score, 6)}   ${target.chance}% chance · projects ${target.projection.mean} (${target.projection.p10}-${target.projection.p90})`);
  out.push(`  ${pad("Price", 26)} ${padL(oddsText(target.odds), 6)}   ${target.book} · the book's fair chance ${target.fair}% · edge ${target.edge > 0 ? "+" : ""}${target.edge} points`);
  const role = target.factors.find((f) => f.key === "role");
  if (role && role.list) {
    out.push("");
    out.push(`  ROLE GAMES (${role.games}${role.samePos ? ", the missing minutes are at his position: minutes trusted more" : ""}): minutes ${role.from} -> ${role.minutes} (role games ${role.roleMinutes}) · ${statWord(target.stat)} per 36 ${role.from36} -> ${role.rate36} (role games ${role.roleRate36})`);
    role.list.forEach((g) => out.push(`    ${g.date} ${g.lastSeason ? "LS" : "  "} vs ${pad(abbr[g.oppId] || "?", 4)} ${padL(g.min.toFixed(0), 3)} min ${padL(g.v, 3)} ${statWord(target.stat)}   without ${g.without.join(", ")}`));
  }
  if (target.roleMiss) {
    const m = target.roleMiss;
    out.push("");
    out.push(`  NO ROLE STEP: ${m.out} out, but ${m.reason} (${m.loadedFrom})`);
    m.games.forEach((g) => out.push(`    ${g.date} ${g.lastSeason ? "LS" : "  "} ${padL(g.min.toFixed(0), 3)} min ${padL(g.v, 3)} ${statWord(target.stat)}   without ${g.without.join(", ")}   ${g.why}`));
    if (!m.games.length) out.push("    no games without them in the loaded logs");
  }
  return out.join("\n");
}

// The under-bias check: one row per player + prop (the over side carries the same projection as the under).
function biasText(body) {
  const rows = body.props.filter((p) => p.side === "over" || !body.props.some((q) => sameProp(q, p) && q.side === "over"))
    .map((p) => {
      const market = p.factors.find((f) => f.key === "market");
      const spread = p.factors.find((f) => f.key === "spread");
      const under = body.props.find((q) => sameProp(q, p) && q.side === "under");
      return {
        stat: p.stat, line: p.line, games: spread ? spread.games : null,
        before: market ? (market.sim - p.line) / p.line : null,              // projection before the book-line pull vs the line
        after: (p.projection.mean - p.line) / p.line,                        // the final projection vs the line
        baseUnder: under ? under.base > 50 : null,                           // the season numbers alone favor the under
        strongUnder: under ? under.score >= 65 : false,
      };
    });
  const line = (label, list) => {
    if (!list.length) return null;
    const b = list.filter((r) => r.before !== null);
    const pct = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`;
    const share = (fn) => `${Math.round((list.filter(fn).length / list.length) * 100)}%`;
    return `  ${pad(label, 18)} ${padL(list.length, 4)}   ${padL(b.length ? pct(avg(b.map((r) => r.before))) : "–", 7)}   ${padL(pct(avg(list.map((r) => r.after))), 7)}   ${padL(share((r) => r.after < 0), 6)}   ${padL(share((r) => r.baseUnder), 6)}   ${padL(share((r) => r.strongUnder), 6)}`;
  };
  const out = [];
  out.push("UNDER-BIAS CHECK (one row per player + prop)");
  out.push(`  ${pad("", 18)} ${padL("props", 4)}   ${padL("before", 7)}   ${padL("after", 7)}   ${padL("proj<", 6)}   ${padL("base U", 6)}   ${padL("U 65+", 6)}`);
  out.push(line("All", rows));
  ["pts", "reb", "ast", "3pm", "pra"].forEach((code) => { const l = line(statWord(code), rows.filter((r) => r.stat === code)); if (l) out.push(l); });
  out.push(line("Under 5 games", rows.filter((r) => r.games !== null && r.games < 5)));
  out.push(line("5-19 games", rows.filter((r) => r.games !== null && r.games >= 5 && r.games < 20)));
  out.push(line("20+ games", rows.filter((r) => r.games !== null && r.games >= 20)));
  const lowLines = { pts: 10, reb: 4, ast: 3, "3pm": 1.5, pra: 15 };
  out.push(line("Low lines", rows.filter((r) => r.line <= lowLines[r.stat])));
  out.push(line("Other lines", rows.filter((r) => r.line > lowLines[r.stat])));
  out.push("");
  out.push("  before = the average gap between our projection BEFORE the book-line pull and the line (−8% = 8% under the line)");
  out.push("  after  = the same gap for the final projection (after the pull toward the line)");
  out.push("  proj<  = share of props whose final projection sits under the line");
  out.push("  base U = share where the season numbers alone already favor the under (season baseline over 50 for the under)");
  out.push("  U 65+  = share where the under scores 65+");
  out.push("  Low lines = PTS 10 or less, REB 4, AST 3, 3PM 1.5, PRA 15 (bench players, where a count's long tail matters most)");
  return out.filter((l) => l !== null).join("\n");
}

// The calibration check: for each player + prop + line, the sim's chance of the under (final score and season baseline) next to
// how often he actually finished under that line in his past games (this season + last season's logs, 10+ games). In-sample and
// blind to tonight's matchup, so it only catches a shape problem: if the sim says 62% and his history says 52%, the simulated
// games have too many low nights.
function calibrationText(body) {
  const rows = [];
  body.props.forEach((p) => {
    if (rows.some((r) => sameProp(r.p, p)) || !p.history) return;
    const under = body.props.find((q) => sameProp(q, p) && q.side === "under");
    const over = body.props.find((q) => sameProp(q, p) && q.side === "over");
    const n = p.history.over + p.history.under;
    if (n < 10) return;
    rows.push({
      p, n, lowLine: p.line <= ({ pts: 10, reb: 4, ast: 3, "3pm": 1.5, pra: 15 })[p.stat],
      sim: under ? under.chance / 100 : 1 - over.chance / 100,
      base: under ? under.base / 100 : 1 - over.base / 100,
      hist: p.history.under / n,
    });
  });
  const pct = (v) => `${Math.round(v * 100)}%`;
  const line = (label, list) => (list.length
    ? `  ${pad(label, 22)} ${padL(list.length, 5)}   ${padL(pct(avg(list.map((r) => r.sim))), 6)}   ${padL(pct(avg(list.map((r) => r.base))), 8)}   ${padL(pct(avg(list.map((r) => r.hist))), 8)}   ${padL(signed((avg(list.map((r) => r.sim)) - avg(list.map((r) => r.hist))) * 100), 6)}`
    : null);
  const out = [];
  out.push("CALIBRATION CHECK (the sim's under chance vs how often he went under that line before)");
  out.push(`  ${pad("", 22)} ${padL("props", 5)}   ${padL("sim", 6)}   ${padL("baseline", 8)}   ${padL("history", 8)}   ${padL("gap", 6)}`);
  out.push(line("All", rows));
  ["pts", "reb", "ast", "3pm", "pra"].forEach((code) => out.push(line(statWord(code), rows.filter((r) => r.p.stat === code))));
  out.push(line("Low lines", rows.filter((r) => r.lowLine)));
  out.push(line("Other lines", rows.filter((r) => !r.lowLine)));
  out.push("  by the sim's under chance:");
  [[0, 0.4, "under 40%"], [0.4, 0.5, "40-50%"], [0.5, 0.6, "50-60%"], [0.6, 0.7, "60-70%"], [0.7, 1.01, "70%+"]]
    .forEach(([lo, hi, label]) => out.push(line(`  sim ${label}`, rows.filter((r) => r.sim >= lo && r.sim < hi))));
  out.push("");
  out.push("  sim = the final under chance · baseline = the season-baseline under chance (before any factor) · history = his past");
  out.push("  games under that line (pushes left out) · gap = sim − history in points. A gap of +5 or more across the board = too");
  out.push("  many low nights in the sim. In the buckets, history should rise with the sim; a flat history = the sim's confidence is noise.");
  return out.filter((l) => l !== null).join("\n");
}

// The top 10 by edge: the best edge per player (like the top hunts), our chance 55%+, not injured.
const EDGE_LIST = { size: 10, minChance: 55 };
function edgeList(body) {
  const best = {};
  body.props.filter((p) => !p.injured && p.chance >= EDGE_LIST.minChance && Number.isFinite(p.edge)).forEach((p) => {
    if (!best[p.playerId] || p.edge > best[p.playerId].edge) best[p.playerId] = p;
  });
  return Object.values(best).sort((a, b) => b.edge - a.edge).slice(0, EDGE_LIST.size);
}

function edgeText(body) {
  const list = edgeList(body);
  const out = [];
  out.push(`TOP 10 BY EDGE (our chance minus the book's fair chance; chance ${EDGE_LIST.minChance}%+, one per player, not injured)`);
  out.push(`  ${pad("", 22)} ${pad("", 18)} ${padL("odds", 5)}  ${padL("ours", 5)}  ${padL("fair", 5)}  ${padL("edge", 5)}  score`);
  list.forEach((p) => {
    const role = p.factors.find((f) => f.key === "role");
    out.push(`  ${pad(p.player, 22)} ${pad(pickText(p), 18)} ${padL(oddsText(p.odds), 5)}  ${padL(`${p.chance}%`, 5)}  ${padL(`${p.fair}%`, 5)}  ${padL(`${p.edge > 0 ? "+" : ""}${p.edge}`, 5)}  ${padL(p.score, 5)}${role ? `  [Role: ${role.out} out]` : ""}${p.gtd ? "  [GTD]" : ""}`);
  });
  const overs = list.filter((p) => p.side === "over").length;
  out.push(`  ${overs} overs / ${list.length - overs} unders`);
  const all = body.props.filter((p) => Number.isFinite(p.edge));
  const avgEdge = (side) => { const l = all.filter((p) => p.side === side); return l.length ? (l.reduce((a, p) => a + p.edge, 0) / l.length).toFixed(1) : "–"; };
  out.push(`  Average edge over every scored side: overs ${avgEdge("over")}, unders ${avgEdge("under")} (near 0 for both = the sim agrees with the books overall)`);
  return out.join("\n");
}

function countText(label, body) {
  const strong = body.props.filter((p) => p.score >= 65);
  const by = (list, side) => list.filter((p) => p.side === side).length;
  const stats = ["pts", "reb", "ast", "3pm", "pra"].map((code) => {
    const list = strong.filter((p) => p.stat === code);
    return list.length ? `${statWord(code)} ${by(list, "over")}/${by(list, "under")}` : null;
  }).filter(Boolean).join(" · ");
  const share = strong.length ? Math.round((by(strong, "under") / strong.length) * 100) : 0;
  return `  ${pad(label, 22)} ${padL(strong.length, 3)} props at 65+: ${by(strong, "over")} overs / ${by(strong, "under")} unders (${share}% unders)${stats ? `   [over/under: ${stats}]` : ""}`;
}

(async () => {
  console.log(`Scoring ${date} with the old engine (no Role step)...`);
  const old = await runEngine({ roleOff: true });
  console.log("Scoring again with the Role step...");
  const now = await runEngine({ roleOff: false });
  if (!now.props.length) throw new Error(`No scored props for ${date} (no games, every game started, or no lines yet).`);
  const abbr = await teamAbbreviations();

  let targets;
  if (nameArg) {
    const list = now.props.filter((p) => p.player.toLowerCase().includes(nameArg) && (!statArg || p.stat === statArg)).sort((a, b) => b.score - a.score);
    if (!list.length) throw new Error(`No prop for "${process.argv[3]}"${statArg ? ` ${statArg}` : ""} on ${date}.`);
    targets = [list[0]];
  } else {
    // the old engine's top hunts (the same side, as the engine scores it now), then the new top hunts
    const sameSide = (p) => now.props.find((n) => sameProp(n, p) && n.side === p.side);
    targets = [...old.topHunts.map(sameSide), ...now.topHunts].filter(Boolean)
      .filter((p, i, list) => list.findIndex((q) => sameProp(q, p) && q.side === p.side) === i);
  }

  const out = [];
  out.push(`${nameArg ? "ONE PROP" : "TOP HUNTS (old engine's + new engine's)"} · ${date}`);
  out.push(`  ${pad("", 22)} ${pad("", 18)} old -> now`);
  targets.forEach((t) => {
    const was = old.props.find((p) => sameProp(p, t) && p.side === t.side);
    const role = t.factors.find((f) => f.key === "role");
    out.push(`  ${pad(t.player, 22)} ${pad(pickText(t), 18)} ${padL(was ? was.score : "–", 3)} -> ${padL(t.score, 3)}  proj ${was ? was.projection.mean : "–"} -> ${t.projection.mean}  ${priceText(t)}${t.score >= 65 ? "" : "  [below 65]"}${role ? `  [Role ${signed(role.points)}: ${role.out} out, ${role.from} -> ${role.minutes} min${role.samePos ? ", his position" : ""}]` : ""}${t.teamPrior ? "  [traded]" : ""}${t.roleMiss ? `  [no Role: ${t.roleMiss.reason}]` : ""}`);
  });
  out.push("");
  out.push(`New top 5 (by score): ${now.topHunts.map((p) => `${p.player} ${pickText(p)} ${p.score}`).join(" | ") || "none"}`);
  out.push("");
  out.push(edgeText(now));
  out.push("");
  out.push("OVERS vs UNDERS");
  out.push(countText("Old engine", old));
  out.push(countText("Now", now));
  const roleSides = now.props.filter((p) => p.factors.some((f) => f.key === "role"));
  out.push(`  ${roleSides.length} of ${now.props.length} scored sides had a Role step.`);
  out.push("");
  out.push(biasText(now));
  out.push("");
  out.push(calibrationText(now));
  targets.forEach((t) => out.push("", "-".repeat(110), "", detailText(t, old, abbr)));
  out.push("");
  out.push("LS = a last-season game (counts half). Role games skip his own short nights (under 80% of his usual minutes).");

  const text = out.join("\n");
  console.log(`\n${text}`);
  fs.writeFileSync(path.join(__dirname, "hunt-whatif.txt"), `${text}\n`);
})().catch((error) => { console.error(error.message || error); process.exit(1); });
