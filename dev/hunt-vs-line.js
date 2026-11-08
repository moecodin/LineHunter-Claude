// LineHunter - dev/hunt-vs-line.js
// "Is the model a better guess than the book's line?" (a console tool, not part of the site). For every saved night it replays the engine
// on its saved lines with the book-line pull switched OFF (so the projection is the model's own), grades each player + stat against the
// real box score and compares three predictions of the final stat: the book's line, the model's own mean, and the engine's normal mean
// (with the pull). Prints
//   1. average miss (MAE) and RMSE of each, overall and per stat
//   2. the best blend  actual - line = a + b x (model - line)  fitted on the other nights (leave-one-night-out) and scored on the held-out
//      night: b near 0 = the model adds nothing beyond the line, b near 1 = the model beats the line
//   3. how often the actual went the model's way (over when model > line) by the size of the gap
//
//   node dev/hunt-vs-line.js [--nights 2026-10-28,...]
// Cloud: BALLDONTLIE_API_KEY=placeholder NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt. Writes dev/hunt-vs-line.txt.

const fs = require("fs");
const path = require("path");

const realFetch = global.fetch; // one answer per URL for the whole run
const memo = new Map();
global.fetch = (url, options) => {
  const key = String(url);
  if (!memo.has(key)) {
    memo.set(key, realFetch(url, options).then(async (r) => {
      const text = await r.text();
      if (!r.ok) memo.delete(key);
      return { ok: r.ok, status: r.status, text };
    }));
  }
  return memo.get(key).then((r) => ({ ok: r.ok, status: r.status, json: async () => JSON.parse(r.text), text: async () => r.text }));
};

const { bdl, bdlAll, snapshotDates, pad, padL, statWord } = require("./hunt-lib");
const { loadSnapshot, runEngineOn } = require("./hunt-replay");

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const nights = flag("--nights", snapshotDates().join(",")).split(",");

const FIELDS = { pts: ["pts"], reb: ["reb"], ast: ["ast"], "3pm": ["fg3m"], pra: ["pts", "reb", "ast"] };
const minutesOf = (min) => { const [m, s] = String(min || "0").split(":").map(Number); return (m || 0) + (s || 0) / 60; };
const noPull = (e) => { const M = e.CONFIG.sim.market; M.base = 0; M.thin = 0; M.maxWeight = 0; M.gapCv = 0; };

async function boxesFor(snap) {
  const boxes = {};
  for (const game of snap.games) {
    const fresh = (await bdl(`/v1/games/${game.id}`)).data;
    if (fresh.status !== "Final") continue;
    const logs = await bdlAll(`/v1/stats?game_ids[]=${game.id}&per_page=100`);
    boxes[game.id] = Object.fromEntries(logs.map((l) => [l.player.id, l]));
  }
  return boxes;
}

(async () => {
  const enginePath = path.resolve(__dirname, "../netlify/functions/hunt.js");
  const rows = []; // one per player + stat + line
  for (const date of nights) {
    const snap = loadSnapshot(date);
    const boxes = await boxesFor(snap);
    if (!Object.keys(boxes).length) { console.log(`  ${date}: no final games, skipped`); continue; }
    const pure = await runEngineOn(enginePath, snap, { configure: noPull });
    const live = await runEngineOn(enginePath, snap, { configure: () => {} });
    const liveMean = {};
    live.props.forEach((p) => { liveMean[`${p.playerId}-${p.stat}-${p.line}`] = p.projection.mean; });
    const seen = new Set();
    pure.props.filter((p) => boxes[p.gameId] && !p.injured).forEach((p) => {
      const key = `${p.playerId}-${p.stat}-${p.line}`;
      if (seen.has(key)) return; seen.add(key);
      const log = boxes[p.gameId][p.playerId];
      if (!log || !(minutesOf(log.min) > 0)) return;
      const actual = FIELDS[p.stat].reduce((a, k) => a + (log[k] || 0), 0);
      rows.push({ night: date, stat: p.stat, line: p.line, model: p.projection.mean, live: liveMean[key], actual });
    });
    console.log(`  ${date}: ${rows.filter((r) => r.night === date).length} player-stats`);
  }

  const out = [];
  const mean = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : NaN);
  const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "–");
  const mae = (l, g) => mean(l.map((r) => Math.abs(g(r) - r.actual)));
  const rmse = (l, g) => Math.sqrt(mean(l.map((r) => (g(r) - r.actual) ** 2)));
  const bias = (l, g) => mean(l.map((r) => g(r) - r.actual));
  const L = rows.filter((r) => Number.isFinite(r.live));
  out.push(`PROJECTION vs THE BOOK'S LINE · nights ${nights.join(" ")} · ${L.length} player-stats (one per player + stat + line)`);
  out.push("");
  const table = (label, list) => {
    out.push(label);
    out.push(`  ${pad("predictor", 22)} ${padL("n", 6)} ${padL("MAE", 7)} ${padL("RMSE", 7)} ${padL("bias", 7)}`);
    [["the book's line", (r) => r.line], ["model alone (no pull)", (r) => r.model], ["engine now (20% pull)", (r) => r.live]].forEach(([name, g]) => {
      out.push(`  ${pad(name, 22)} ${padL(list.length, 6)} ${padL(f(mae(list, g)), 7)} ${padL(f(rmse(list, g)), 7)} ${padL(f(bias(list, g)), 7)}`);
    });
    out.push("");
  };
  table("ALL", L);
  ["pts", "reb", "ast", "3pm", "pra"].forEach((s) => table(`STAT ${statWord(s)}`, L.filter((r) => r.stat === s)));

  // blend: actual - line = a + b (model - line), fitted on the other nights, scored on the held-out night
  const fit = (train) => {
    const x = train.map((r) => r.model - r.line); const y = train.map((r) => r.actual - r.line);
    const mx = mean(x), my = mean(y);
    const b = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / (x.reduce((s, v) => s + (v - mx) ** 2, 0) || 1);
    return { a: my - b * mx, b };
  };
  const all = fit(L);
  out.push(`BLEND  actual - line = a + b x (model - line)`);
  out.push(`  all nights together: a = ${f(all.a)}, b = ${f(all.b)}   (b = 0: the model adds nothing beyond the line; b = 1: the model is right about the gap)`);
  ["pts", "reb", "ast", "3pm", "pra"].forEach((s) => { const m = fit(L.filter((r) => r.stat === s)); out.push(`  ${pad(statWord(s), 5)} a = ${f(m.a)}, b = ${f(m.b)}  (n ${L.filter((r) => r.stat === s).length})`); });
  const held = [];
  nights.forEach((d) => {
    const train = L.filter((r) => r.night !== d), test = L.filter((r) => r.night === d);
    if (!train.length || !test.length) return;
    const m = fit(train);
    test.forEach((r) => held.push({ ...r, blend: r.line + m.a + m.b * (r.model - r.line), lineOnly: r.line }));
  });
  const meanShift = mean(held.map((r) => r.actual - r.line)); // a line corrected only for its average bias
  out.push(`  held-out RMSE (fitted on the other nights): line ${f(rmse(held, (r) => r.line))} · line + its average bias ${f(rmse(held, (r) => r.line + meanShift))} · line + fitted blend of the model ${f(rmse(held, (r) => r.blend))}`);
  out.push(`  held-out MAE:                                line ${f(mae(held, (r) => r.line))} · line + its average bias ${f(mae(held, (r) => r.line + meanShift))} · line + fitted blend of the model ${f(mae(held, (r) => r.blend))}`);
  out.push("");

  // direction: when the model is above the line, does the stat go over?
  out.push("DIRECTION  when the model's own mean is above / below the line, how often did the real stat go that way?  (gap = |model - line| as % of the line)");
  [[0, 5], [5, 10], [10, 20], [20, 1000]].forEach(([lo, hi]) => {
    const g = L.filter((r) => { const gap = (100 * Math.abs(r.model - r.line)) / r.line; return gap >= lo && gap < hi && r.actual !== r.line; });
    const ov = g.filter((r) => r.model > r.line), un = g.filter((r) => r.model < r.line);
    const w = (l, over) => (l.length ? `${f(100 * mean(l.map((r) => ((over ? r.actual > r.line : r.actual < r.line) ? 1 : 0))), 1)}% of ${l.length}` : "–");
    out.push(`  gap ${pad(`${lo}-${hi === 1000 ? "+" : hi}%`, 7)} model says over: went over ${padL(w(ov, true), 14)}   |   model says under: went under ${padL(w(un, false), 14)}`);
  });
  const text = out.join("\n");
  console.log("\n" + text);
  fs.writeFileSync(path.join(__dirname, "hunt-vs-line.txt"), text + "\n");
})().catch((e) => { console.error(e.message || e); process.exit(1); });
