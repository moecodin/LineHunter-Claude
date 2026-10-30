// LineHunter - dev/hunt-grade.js
// Grades the Hunt Score against the box scores (a console tool, not part of the site). For every saved night in dev/snapshots
// (or the dates given) it scores the saved lines with main's old engine and with this branch's engine (dev/hunt-replay.js), grades
// every side of the games that are FINAL (over / under vs the line, profit per $100 at the saved price) and prints the report.
//
//   node dev/hunt-grade.js                        every saved night
//   node dev/hunt-grade.js 2026-10-28             one night
//   node dev/hunt-grade.js 2026-10-28 --old /path/to/hunt-main.js   main's engine from a file (default: git show origin/main:...)
//
// Environment (cloud): BALLDONTLIE_API_KEY=placeholder NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
// A player who did not play (no minutes) is voided, not graded. Writes dev/hunt-grade.txt (gitignored).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { bdl, bdlAll, snapshotDates, pad, padL, statWord } = require("./hunt-lib");
const { loadSnapshot, runEngineOn } = require("./hunt-replay");

const args = process.argv.slice(2);
const oldFlag = args.indexOf("--old");
const oldPath = oldFlag >= 0 ? path.resolve(args[oldFlag + 1]) : null;
const afterFlag = args.indexOf("--after"); // only games that tip off at or after this ISO time, e.g. --after 2026-10-29T00:45:00Z (the late games)
const after = afterFlag >= 0 ? Date.parse(args[afterFlag + 1]) : null;
const dates = args.filter((a, i) => /^\d{4}-\d{2}-\d{2}$/.test(a) && args[i - 1] !== "--old");
const branchEngine = path.resolve(__dirname, "../netlify/functions/hunt.js");

function mainEngineFile() {
  if (oldPath) return oldPath;
  const file = path.join(os.tmpdir(), "hunt-main-engine.js");
  fs.writeFileSync(file, execSync("git show origin/main:netlify/functions/hunt.js", { cwd: path.join(__dirname, "..") }).toString());
  return file;
}

const STAT_FIELDS = { pts: ["pts"], reb: ["reb"], ast: ["ast"], "3pm": ["fg3m"], pra: ["pts", "reb", "ast"] };
const minutesOf = (min) => { const [m, s] = String(min || "0").split(":").map(Number); return (m || 0) + (s || 0) / 60; };
const profitOf = (odds, win) => (win ? (odds > 0 ? odds : 10000 / -odds) : -100);

// { gameId: { playerId: log } } for the FINAL games of a snapshot
async function boxScores(snap) {
  const finals = [];
  for (const game of snap.games.filter((g) => after === null || Date.parse(g.datetime) >= after)) {
    const fresh = (await bdl(`/v1/games/${game.id}`)).data;
    if (fresh.status === "Final") finals.push(fresh);
  }
  const boxes = {};
  for (const game of finals) {
    const logs = await bdlAll(`/v1/stats?game_ids[]=${game.id}&per_page=100`);
    boxes[game.id] = Object.fromEntries(logs.map((l) => [l.player.id, l]));
  }
  return { finals, boxes };
}

// Grade one side: { result: "win" | "loss" | "push" | "void", actual, profit }
function grade(side, boxes) {
  const log = boxes[side.gameId] && boxes[side.gameId][side.playerId];
  if (!boxes[side.gameId]) return null; // the game is not final yet
  if (!log || !(minutesOf(log.min) > 0)) return { result: "void" };
  const actual = STAT_FIELDS[side.stat].reduce((sum, key) => sum + (log[key] || 0), 0);
  if (actual === side.line) return { result: "push", actual, profit: 0 };
  const win = side.side === "over" ? actual > side.line : actual < side.line;
  return { result: win ? "win" : "loss", actual, profit: Number.isFinite(side.odds) ? profitOf(side.odds, win) : null, minutes: minutesOf(log.min) };
}

const best = (sides, better) => { const m = {}; sides.forEach((p) => { if (!m[p.playerId] || better(p, m[p.playerId])) m[p.playerId] = p; }); return Object.values(m); };
const summary = (graded) => {
  const done = graded.filter((g) => g.g && (g.g.result === "win" || g.g.result === "loss"));
  const wins = done.filter((g) => g.g.result === "win").length;
  const priced = done.filter((g) => g.g.profit !== null && g.g.profit !== undefined);
  const profit = priced.reduce((a, g) => a + g.g.profit, 0);
  return { n: done.length, wins, rate: done.length ? wins / done.length : null, profitPer100: priced.length ? profit / priced.length : null, ourChance: done.length ? done.reduce((a, g) => a + g.p.chance, 0) / done.length : null };
};
const fmtSummary = (s) => (s.n ? `${padL(s.n, 4)} picks  won ${padL(s.wins, 3)} (${padL(Math.round(s.rate * 100), 3)}%)  we said ${padL(Math.round(s.ourChance), 3)}%  profit/pick ${s.profitPer100 === null ? "  –" : padL((s.profitPer100 >= 0 ? "+" : "") + s.profitPer100.toFixed(1), 6)}` : "   0 picks");

const SAM_ALL = fs.existsSync(path.join(__dirname, "hunt-sam.json")) ? JSON.parse(fs.readFileSync(path.join(__dirname, "hunt-sam.json"), "utf8")) : []; // each entry has the date of the game it was typed for

async function gradeNight(date, files) {
  const snap = loadSnapshot(date);
  const out = [];
  const { finals, boxes } = await boxScores(snap);
  out.push(`NIGHT ${date}${after !== null ? ` (games from ${new Date(after).toISOString().slice(11, 16)}Z on)` : ""}: ${finals.length} of ${snap.games.length} games final · snapshot taken ${new Date(snap.takenAt).toISOString().slice(11, 16)}Z · engines replayed on the saved lines`);
  if (!finals.length) return out.join("\n");

  // prices from the snapshot (the old engine's sides carry no odds): playerId-stat-side-line
  const price = {};
  Object.values(snap.sidesByGame).flat().forEach((s) => { price[`${s.playerId}-${s.stat}-${s.side}-${s.line}`] = s.odds; });
  const oldBody = await runEngineOn(files.old, snap);
  const newBody = await runEngineOn(files.branch, snap);
  const prep = (body, isNew) => body.props.filter((p) => boxes[p.gameId] && !p.injured).map((p) => {
    const sideWithOdds = { ...p, odds: Number.isFinite(p.odds) ? p.odds : price[`${p.playerId}-${p.stat}-${p.side}-${p.line}`] };
    return { p: sideWithOdds, g: grade(sideWithOdds, boxes) };
  }).filter((x) => x.g);
  const oldAll = prep(oldBody, false);
  const newAll = prep(newBody, true);

  out.push("");
  out.push("EVERY SIDE WE SCORED, by Hunt Score (a side scoring 65 says about 65% chance)");
  out.push(`  ${pad("", 12)} ${pad("old engine (live site)", 62)} new engine (branch)`);
  [[0, 55, "under 55"], [55, 65, "55-64"], [65, 70, "65-69"], [70, 101, "70+"]].forEach(([lo, hi, label]) => {
    const f = (all) => fmtSummary(summary(all.filter((x) => x.p.score >= lo && x.p.score < hi)));
    out.push(`  ${pad(label, 12)} ${pad(f(oldAll), 62)} ${f(newAll)}`);
  });

  out.push("");
  out.push("NEW ENGINE BY EDGE (our chance minus the book's fair chance)");
  [[-100, 0, "below 0"], [0, 5, "0 to 4"], [5, 10, "5 to 9"], [10, 15, "10 to 14"], [15, 100, "15+"]].forEach(([lo, hi, label]) => {
    out.push(`  ${pad(label, 10)} ${fmtSummary(summary(newAll.filter((x) => Number.isFinite(x.p.edge) && x.p.edge >= lo && x.p.edge < hi)))}`);
  });
  out.push(`  ${pad("overs", 10)} ${fmtSummary(summary(newAll.filter((x) => x.p.side === "over" && x.p.edge >= 5)))}   (edge 5+)`);
  out.push(`  ${pad("unders", 10)} ${fmtSummary(summary(newAll.filter((x) => x.p.side === "under" && x.p.edge >= 5)))}   (edge 5+)`);
  out.push("");
  out.push("NEW ENGINE, SCORE 65+ BY STAT (the picks the engine is most sure about)");
  ["pts", "reb", "ast", "3pm", "pra"].forEach((stat) => {
    out.push(`  ${pad(statWord(stat), 10)} ${fmtSummary(summary(newAll.filter((x) => x.p.stat === stat && x.p.score >= 65)))}`);
  });
  out.push(`  ${pad("line <= 1.5", 10)} ${fmtSummary(summary(newAll.filter((x) => x.p.score >= 65 && x.p.line <= 1.5)))}   (0.5 / 1.5 lines)`);
  out.push(`  ${pad("line > 1.5", 10)} ${fmtSummary(summary(newAll.filter((x) => x.p.score >= 65 && x.p.line > 1.5)))}`);
  const always = newAll.filter((x) => x.p.side === "under");
  out.push(`  ${pad("any under", 10)} ${fmtSummary(summary(always))}   (every under, no filter: the dumb baseline)`);

  const topScore = (all) => best(all.filter((x) => x.p.score >= 65).map((x) => x.p), (a, b) => a.score > b.score).sort((a, b) => b.score - a.score).slice(0, 5);
  const topEdge = (all) => best(all.filter((x) => x.p.chance >= 55 && Number.isFinite(x.p.edge)).map((x) => x.p), (a, b) => a.edge > b.edge).sort((a, b) => b.edge - a.edge).slice(0, 10);
  const lookup = (all, p) => all.find((x) => x.p.playerId === p.playerId && x.p.stat === p.stat && x.p.side === p.side && x.p.line === p.line);
  const lines = (picks, all, edge) => picks.map((p) => {
    const x = lookup(all, p);
    const gr = x && x.g;
    const mark = !gr ? "?" : gr.result === "win" ? "WON " : gr.result === "loss" ? "lost" : gr.result === "void" ? "void" : "push";
    return `    ${mark} ${pad(p.player, 22)} ${pad(`${p.side === "over" ? "Over" : "Under"} ${p.line} ${statWord(p.stat)}`, 17)} score ${padL(p.score, 3)}${edge ? ` edge ${padL((p.edge > 0 ? "+" : "") + p.edge, 4)}` : ""}${gr && gr.actual !== undefined ? `  actual ${gr.actual}${gr.minutes ? ` in ${Math.round(gr.minutes)} min` : ""}` : ""}`;
  });
  out.push("");
  out.push("TOP 5 BY SCORE (65+, one per player) of the final games");
  out.push("  old engine:"); out.push(...lines(topScore(oldAll), oldAll, false));
  out.push("  new engine:"); out.push(...lines(topScore(newAll), newAll, true));
  out.push("");
  out.push("TOP 10 BY EDGE (new engine, our chance 55%+) of the final games");
  out.push(...lines(topEdge(newAll), newAll, true));

  out.push("");
  out.push("TOP SCORE IN EACH FINAL GAME (the pick you asked for)");
  finals.forEach((game) => {
    const label = `${game.visitor_team.abbreviation} @ ${game.home_team.abbreviation}`;
    const pick = (all) => best(all.filter((x) => x.p.gameId === game.id).map((x) => x.p), (a, b) => a.score > b.score).sort((a, b) => b.score - a.score)[0];
    const o = pick(oldAll);
    const n = pick(newAll);
    const show = (p, all) => (p ? lines([p], all, false)[0].trim() : "-");
    out.push(`  ${label}`);
    out.push(`    old: ${show(o, oldAll)}`);
    out.push(`    new: ${show(n, newAll)}${o && n && o.playerId === n.playerId && o.stat === n.stat ? "   (same pick)" : ""}`);
  });

  const SAM = SAM_ALL.filter((x) => x.date === date);
  if (SAM.length) {
    out.push("");
    out.push("THE COMPARED PLAYERS vs SAM (points)");
    for (const s of SAM) {
      const oldS = oldAll.filter((x) => x.p.player.includes(s.name) && x.p.stat === s.stat).sort((a, b) => b.p.score - a.p.score)[0];
      const newS = newAll.filter((x) => x.p.player.includes(s.name) && x.p.stat === s.stat).sort((a, b) => b.p.score - a.p.score)[0];
      const any = oldS || newS;
      if (!any) { out.push(`  ${pad(s.name, 7)} game not final yet`); continue; }
      const gr = any.g;
      const samSide = s.side;
      const samWin = gr.actual === undefined ? "?" : (samSide === "over" ? gr.actual > s.line : gr.actual < s.line) ? "Sam right" : "Sam wrong";
      const f = (x) => (x ? `${x.p.side === "over" ? "Over" : "Under"} ${x.p.line} (${x.p.score}, proj ${x.p.projection.mean}) ${x.g.result === "win" ? "WON" : x.g.result === "loss" ? "lost" : x.g.result}` : "-");
      out.push(`  ${pad(s.name, 7)} actual ${gr.actual === undefined ? "DNP" : gr.actual} pts in ${gr.minutes ? Math.round(gr.minutes) : 0} min`);
      out.push(`          Sam: ${samSide} ${s.line}, proj ${s.proj} -> ${samWin}   old: ${f(oldS)}   new: ${f(newS)}`);
    }
  }
  return out.join("\n");
}

(async () => {
  const files = { old: mainEngineFile(), branch: branchEngine };
  const nights = dates.length ? dates : snapshotDates();
  if (!nights.length) throw new Error("No saved nights in dev/snapshots.");
  const parts = [];
  for (const date of nights) parts.push(await gradeNight(date, files));
  const text = parts.join("\n\n" + "-".repeat(110) + "\n\n");
  console.log(text);
  fs.writeFileSync(path.join(__dirname, "hunt-grade.txt"), `${text}\n`);
})().catch((error) => { console.error(error.message || error); process.exit(1); });
