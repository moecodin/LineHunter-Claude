// LineHunter - dev/hunt-under-check.js
// The under-tilt checks (a console tool, part of the 10 am report; not part of the site). Over every saved night's lines (final games only,
// players who did not play left out) it prints:
//   CHECK 1  how often a line went UNDER, overall and per night, with a game-clustered error margin (sigma over 50% and over break-even 52.4%)
//   CHECK 2  the same by stat x line size (buckets with 15+ lines)
//   CHECK 3  whether the engine's under chance / under edge predicts anything: win rate of the under by chance and edge bucket, and the
//            engine's Brier score against always saying the base rate
// Usage: node dev/hunt-under-check.js   (needs dev/snapshots; writes gitignored dev/hunt-under-check.txt)
const { snapshotDates, snapshotFile, readJson, bdlAll } = require("./hunt-lib");
const KEYS = { pts: ["pts"], reb: ["reb"], ast: ["ast"], "3pm": ["fg3m"], pra: ["pts", "reb", "ast"] };
const lines = [];
const log = console.log;
console.log = (...a) => { lines.push(a.join(" ")); log(...a); };
(async () => {
  const L = []; // one row per player+stat+line: night, game, stat, line, actualUnder, underChance, underEdge, overChance
  for (const d of snapshotDates()) {
    const snap = readJson(snapshotFile(d));
    for (const saved of Object.values(snap.games)) {
      if (saved.game.status !== "Final" && !(saved.sides.length)) continue;
      const rows = await bdlAll(`/v1/stats?game_ids[]=${saved.game.id}&per_page=100`);
      const by = {}; rows.forEach((r) => { by[r.player.id] = r; });
      const m = {};
      saved.sides.forEach((s) => { (m[`${s.playerId}-${s.stat}-${s.line}`] = m[`${s.playerId}-${s.stat}-${s.line}`] || {})[s.side] = s; });
      Object.values(m).forEach((x) => {
        const u = x.under, o = x.over; const any = u || o; const r = by[any.playerId];
        if (!r || !r.min || r.min === "00" || r.min === "0") return;
        const actual = KEYS[any.stat].reduce((a, k) => a + (r[k] || 0), 0);
        if (!(r.game && r.game.status === "Final")) return;
        L.push({ night: d, game: saved.game.id, stat: any.stat, line: any.line, under: actual < any.line,
          uc: u ? u.chance : (o ? 100 - o.chance : null), ue: u ? u.edge : (o ? -o.edge : null) });
      });
    }
  }
  const pct = (a) => (100 * a.filter((x) => x.under).length / a.length).toFixed(1) + "% (" + a.filter((x) => x.under).length + "/" + a.length + ")";
  // clustered SE by game
  const games = {}; L.forEach((x) => { (games[x.game] = games[x.game] || []).push(x); });
  const gs = Object.values(games);
  const p = L.filter((x) => x.under).length / L.length;
  const gm = gs.map((g) => g.filter((x) => x.under).length - p * g.length);
  const se = Math.sqrt(gm.reduce((a, b) => a + b * b, 0)) / L.length;
  console.log(`CHECK 1  all lines ${pct(L)}  clustered SE ${(100 * se).toFixed(1)} pts -> ${((p - 0.5) / se).toFixed(1)} sigma over 50%, ${((p - 0.524) / se).toFixed(1)} over break-even 52.4%`);
  snapshotDates().forEach((d) => console.log("  ", d, pct(L.filter((x) => x.night === d))));
  console.log("CHECK 2  by stat x line bucket");
  const lb = (l) => (l <= 1.5 ? "<=1.5" : l <= 5.5 ? "2-5.5" : l <= 15.5 ? "6-15.5" : "16+");
  ["pts", "reb", "ast", "3pm", "pra"].forEach((s) => {
    const row = ["<=1.5", "2-5.5", "6-15.5", "16+"].map((b) => { const a = L.filter((x) => x.stat === s && lb(x.line) === b); return a.length >= 15 ? `${b}: ${pct(a)}` : null; }).filter(Boolean);
    console.log("  ", s, row.join(" | "));
  });
  console.log("CHECK 3  does the engine's under chance add anything? (win rate of the UNDER by the engine's under chance)");
  const q = (lo, hi) => L.filter((x) => x.uc !== null && x.uc >= lo && x.uc < hi);
  [[0, 40], [40, 45], [45, 50], [50, 55], [55, 60], [60, 70], [70, 101]].forEach(([a, b]) => { const g = q(a, b); if (g.length) console.log(`   under chance ${a}-${b}%: went under ${pct(g)}  (engine said ~${(g.reduce((s, x) => s + x.uc, 0) / g.length).toFixed(0)}%)`); });
  console.log("   by under EDGE:");
  [[-100, 0], [0, 5], [5, 10], [10, 15], [15, 100]].forEach(([a, b]) => { const g = L.filter((x) => x.ue !== null && x.ue >= a && x.ue < b); if (g.length) console.log(`   edge ${a}..${b}: ${pct(g)}`); });
  // rank correlation (uc vs outcome) and Brier vs constant baseline
  const c = L.filter((x) => x.uc !== null);
  const brier = c.reduce((s, x) => s + (x.uc / 100 - (x.under ? 1 : 0)) ** 2, 0) / c.length;
  const base = c.filter((x) => x.under).length / c.length;
  const brierBase = c.reduce((s, x) => s + (base - (x.under ? 1 : 0)) ** 2, 0) / c.length;
  console.log(`   Brier of the engine's under chance ${brier.toFixed(4)} vs always saying ${(100 * base).toFixed(1)}%: ${brierBase.toFixed(4)}  (lower is better), n=${c.length}`);
  require("fs").writeFileSync(require("path").join(__dirname, "hunt-under-check.txt"), lines.join("\n") + "\n");
})();
