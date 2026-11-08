// LineHunter - dev/hunt-calibrate.js
// Calibration experiment on the saved nights (a console tool, not part of the site). For each variant of the engine's settings it
// replays every saved night on its saved lines (dev/hunt-replay.js), grades EVERY scored side against the real box scores and reports
// how honest the chances are:
//   Brier / log loss of the chance (lower is better), a calibration table (claimed chance vs how often the side won), the record and
//   win rate of the 65+ picks, the top 10 by edge, and edge buckets.
// Then a post-hoc SHRINK of the base engine's chances toward 50% (and toward each side's base rate), with k fitted on all other nights
// (leave-one-night-out), so the Brier gain is out of sample.
//
//   node dev/hunt-calibrate.js [--variants base,mk15,mk2,mk25,cv3,cv6] [--nights 2026-10-28,...]
// Cloud: BALLDONTLIE_API_KEY=placeholder NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt. Writes dev/hunt-calibrate.txt.

const fs = require("fs");
const path = require("path");

const realFetch = global.fetch; // one answer per URL for the whole run (the logs repeat across variants)
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
const variantNames = flag("--variants", "base,mk15,mk2,mk25,cv3,cv6").split(",");
const nights = flag("--nights", snapshotDates().join(",")).split(",");

const FIELDS = { pts: ["pts"], reb: ["reb"], ast: ["ast"], "3pm": ["fg3m"], pra: ["pts", "reb", "ast"] };
const minutesOf = (min) => { const [m, s] = String(min || "0").split(":").map(Number); return (m || 0) + (s || 0) / 60; };
const scale = (k) => (e) => { const M = e.CONFIG.sim.market; M.base *= k; M.thin *= k; };
const VARIANTS = {
  base: () => {},
  mk15: scale(1.5), mk2: scale(2), mk25: scale(2.5),                       // book-line pull 20% / 30% -> x1.5, x2, x2.5
  cv3: (e) => { e.CONFIG.sim.rateCv.base += 0.03; },                      // wider rate uncertainty
  cv6: (e) => { e.CONFIG.sim.rateCv.base += 0.06; },
  mk2cv3: (e) => { scale(2)(e); e.CONFIG.sim.rateCv.base += 0.03; },
};

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
  const rows = Object.fromEntries(variantNames.map((v) => [v, []])); // graded sides
  const enginePath = path.resolve(__dirname, "../netlify/functions/hunt.js");
  for (const date of nights) {
    const snap = loadSnapshot(date);
    const boxes = await boxesFor(snap);
    if (!Object.keys(boxes).length) { console.log(`  ${date}: no final games, skipped`); continue; }
    for (const v of variantNames) {
      const body = await runEngineOn(enginePath, snap, { configure: VARIANTS[v] });
      let n = 0;
      body.props.filter((p) => boxes[p.gameId] && !p.injured).forEach((p) => {
        const log = boxes[p.gameId][p.playerId];
        if (!log || !(minutesOf(log.min) > 0)) return;
        const actual = FIELDS[p.stat].reduce((a, k) => a + (log[k] || 0), 0);
        if (actual === p.line) return;
        const win = p.side === "over" ? actual > p.line : actual < p.line;
        rows[v].push({ night: date, player: p.playerId, name: p.player, stat: p.stat, side: p.side, line: p.line, chance: p.chance / 100, score: p.score, edge: p.edge, win: win ? 1 : 0, fair: p.fair });
        n++;
      });
      console.log(`  ${date} ${v}: ${n} sides graded`);
    }
  }

  const out = [];
  const mean = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : NaN);
  const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "–");
  const brier = (l, pf = (r) => r.chance) => mean(l.map((r) => (pf(r) - r.win) ** 2));
  const logloss = (l, pf = (r) => r.chance) => mean(l.map((r) => { const p = Math.min(0.999, Math.max(0.001, pf(r))); return -(r.win ? Math.log(p) : Math.log(1 - p)); }));
  const topEdge = (l) => { // best edge per player and night, chance 55%+, top 10 per night
    let w = 0, n = 0;
    nights.forEach((d) => {
      const best = {};
      l.filter((r) => r.night === d && r.chance >= 0.55 && Number.isFinite(r.edge)).forEach((r) => { if (!best[r.player] || r.edge > best[r.player].edge) best[r.player] = r; });
      Object.values(best).sort((a, b) => b.edge - a.edge).slice(0, 10).forEach((r) => { n++; w += r.win; });
    });
    return `${w}-${n - w}`;
  };
  out.push(`CALIBRATION · nights ${nights.join(" ")} · every scored side graded vs the box scores (pushes and DNPs left out)`);
  out.push("");
  out.push(`  ${pad("variant", 9)} ${padL("sides", 6)} ${padL("Brier", 7)} ${padL("logloss", 8)} ${padL("65+ n", 6)} ${padL("65+ won", 8)} ${padL("65+ said", 9)} ${padL("edge10+ n", 10)} ${padL("edge10+ won", 12)} ${padL("top10/night", 12)}`);
  variantNames.forEach((v) => {
    const l = rows[v];
    const hi = l.filter((r) => r.score >= 65);
    const he = l.filter((r) => Number.isFinite(r.edge) && r.edge >= 10);
    out.push(`  ${pad(v, 9)} ${padL(l.length, 6)} ${padL(f(brier(l), 4), 7)} ${padL(f(logloss(l), 4), 8)} ${padL(hi.length, 6)} ${padL(f(100 * mean(hi.map((r) => r.win)), 1) + "%", 8)} ${padL(f(100 * mean(hi.map((r) => r.chance)), 1) + "%", 9)} ${padL(he.length, 10)} ${padL(f(100 * mean(he.map((r) => r.win)), 1) + "%", 12)} ${padL(topEdge(l), 12)}`);
  });
  out.push("  (Brier of always saying 50%: 0.2500; lower is better)");

  variantNames.forEach((v) => {
    out.push("", `CALIBRATION TABLE · ${v}: chance the engine gave a side vs how often it won`);
    [[0, 40], [40, 45], [45, 50], [50, 55], [55, 60], [60, 65], [65, 70], [70, 101]].forEach(([lo, hi]) => {
      const g = rows[v].filter((r) => r.chance * 100 >= lo && r.chance * 100 < hi);
      if (g.length) out.push(`  ${pad(`${lo}-${hi}%`, 8)} n ${padL(g.length, 5)}  said ${f(100 * mean(g.map((r) => r.chance)), 1)}%  won ${f(100 * mean(g.map((r) => r.win)), 1)}%`);
    });
  });

  // post-hoc shrink of the base engine, k fitted on the other nights (leave-one-night-out)
  const base = rows.base || rows[variantNames[0]];
  const sideRate = { over: mean(base.filter((r) => r.side === "over").map((r) => r.win)), under: mean(base.filter((r) => r.side === "under").map((r) => r.win)) };
  const shrink = (r, k, toBase) => { const c = toBase ? sideRate[r.side] : 0.5; return c + k * (r.chance - c); };
  const fit = (train, toBase) => { let bestK = 1, bestB = Infinity; for (let k = 0; k <= 1.2001; k += 0.05) { const b = brier(train, (r) => shrink(r, k, toBase)); if (b < bestB) { bestB = b; bestK = k; } } return bestK; };
  out.push("", `SHRINK of the base engine's chance (k = how much of the gap from the centre is kept; fitted on the other nights, scored on the held-out night)`);
  [false, true].forEach((toBase) => {
    const held = [];
    const ks = [];
    nights.forEach((d) => {
      const train = base.filter((r) => r.night !== d);
      const test = base.filter((r) => r.night === d);
      if (!train.length || !test.length) return;
      const k = fit(train, toBase);
      ks.push(`${d.slice(5)}:${k.toFixed(2)}`);
      test.forEach((r) => held.push({ ...r, chance2: shrink(r, k, toBase) }));
    });
    out.push(`  centre = ${toBase ? "each side's base rate (over " + f(100 * sideRate.over, 1) + "%, under " + f(100 * sideRate.under, 1) + "%)" : "50%"}: held-out Brier ${f(brier(held, (r) => r.chance2), 4)} vs unshrunk ${f(brier(held), 4)}  (k by held-out night: ${ks.join(" ")}; all nights k = ${fit(base, toBase).toFixed(2)})`);
  });
  out.push(`  (always saying each side's base rate, no model: Brier ${f(brier(base, (r) => sideRate[r.side]), 4)})`);

  const text = out.join("\n");
  console.log("\n" + text);
  fs.writeFileSync(path.join(__dirname, "hunt-calibrate.txt"), text + "\n");
})().catch((e) => { console.error(e.message || e); process.exit(1); });
