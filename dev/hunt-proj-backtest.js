// LineHunter - dev/hunt-proj-backtest.js
// The projection backtest (a console tool, not part of the site): how close are the engine's PROJECTIONS to what players actually did,
// on past slates, with no book lines needed. Book lines for finished games can't be fetched later, but a projection can be checked
// against the box score, so this covers every game of the season so far instead of the few nights we saved.
//
//   node dev/hunt-proj-backtest.js [--from 2026-10-27] [--to 2026-11-04] [--variants norole,old,importance]
//
// For each past date it rebuilds what the engine would have known that afternoon:
//   games       the day's games, shown as not started
//   injuries    "Out" rows for each team's regulars (3+ games and 15+ minutes before) who did not play that day (the box score is the
//               stand-in for the injury report, so Role-style steps see the lineup that really played)
//   props       one synthetic line per player + stat = his last-10 average rounded down + 0.5 (only used to give the engine a line)
//   the engine  the market pull toward the book line is switched OFF (there is no real line), so the projection is the model's own
// Each variant (CONFIG tweaks, see VARIANTS) is run on the same slate and compared with the box score. Metrics: mean absolute error of
// the projected mean, the bias (projected - actual), and the Brier score of the over chance at the synthetic line. "naive" = the
// player's last-10 average, the bar to beat. Players with 10+ minutes that day are scored (conditional on playing).
// Environment (cloud): BALLDONTLIE_API_KEY=placeholder NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt

const fs = require("fs");
const path = require("path");

// one answer per URL for the whole run: the logs and team numbers repeat across variants and dates
const realFetch = global.fetch;
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

const { bdl, bdlAll, pad, padL, statWord } = require("./hunt-lib");
const { runEngineOn } = require("./hunt-replay");

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const etYesterday = new Date(Date.now() - 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const from = flag("--from", "2026-10-27");
const to = flag("--to", etYesterday);
const variantNames = flag("--variants", "norole,old,importance").split(",");

// Each variant tweaks the engine's CONFIG after it is loaded. Every one switches the book-line pull off first.
const BASE = (engine) => {
  const M = engine.CONFIG.sim.market;
  M.base = 0; M.thin = 0; M.maxWeight = 0; M.gapCv = 0;
};
const VARIANTS = {
  norole: (engine) => { BASE(engine); engine.CONFIG.sim.role.off = true; engine.CONFIG.sim.back.off = true; },
  old: (engine) => { BASE(engine); engine.CONFIG.sim.back.off = true; engine.CONFIG.sim.role.mode = "old"; },
  importance: (engine) => { BASE(engine); engine.CONFIG.sim.back.off = true; engine.CONFIG.sim.role.mode = "importance"; },
  lift: (engine) => { BASE(engine); engine.CONFIG.sim.back.off = true; engine.CONFIG.sim.role.mode = "lift"; },
  back: (engine) => { BASE(engine); engine.CONFIG.sim.back.off = false; },
};
if (process.env.EXTRA_VARIANTS) Object.assign(VARIANTS, require(path.resolve(process.env.EXTRA_VARIANTS)));

const minutesOf = (m) => { const [a, b] = String(m || "0").split(":").map(Number); return (a || 0) + (b || 0) / 60; };
const PROPS = [
  ["points", "pts", ["pts"]], ["rebounds", "reb", ["reb"]], ["assists", "ast", ["ast"]],
  ["threes", "3pm", ["fg3m"]], ["points_rebounds_assists", "pra", ["pts", "reb", "ast"]],
];
const statOf = (row, keys) => keys.reduce((a, k) => a + (row[k] || 0), 0);
const dateOf = (row) => String(row.game.date).slice(0, 10);

(async () => {
  console.log(`Loading box scores ${from} .. ${to}...`);
  const rows = (await bdlAll(`/v1/stats?seasons[]=2026&start_date=2026-10-01&end_date=${to}&per_page=100`))
    .filter((r) => r.player && r.team && r.game && !r.game.postseason && minutesOf(r.min) > 0);
  const byDate = {};
  const byPlayer = {};
  rows.forEach((r) => { (byDate[dateOf(r)] = byDate[dateOf(r)] || []).push(r); (byPlayer[r.player.id] = byPlayer[r.player.id] || []).push(r); });
  Object.values(byPlayer).forEach((l) => l.sort((a, b) => dateOf(b).localeCompare(dateOf(a))));
  const dates = Object.keys(byDate).filter((d) => d >= from && d <= to).sort();
  console.log(`${rows.length} player-games, ${dates.length} dates: ${dates.join(" ")}`);

  const results = Object.fromEntries(variantNames.map((v) => [v, []]));
  for (const D of dates) {
    const games = (await bdl(`/v1/games?start_date=${D}&end_date=${D}&per_page=100`)).data.filter((g) => g.status === "Final");
    if (!games.length) continue;
    const today = byDate[D];
    const teamIds = new Set(games.flatMap((g) => [g.home_team.id, g.visitor_team.id]));
    const props = {};
    const injuries = [];
    const targets = []; // { playerId, stat, line, actual, naive }
    let seq = 0;
    games.forEach((g) => { props[g.id] = []; });
    // players who played that day with 3+ earlier games: one synthetic line per stat
    const played = new Map(today.filter((r) => teamIds.has(r.team.id)).map((r) => [r.player.id, r]));
    played.forEach((r, id) => {
      if (minutesOf(r.min) < 10) return;
      const prior = (byPlayer[id] || []).filter((x) => dateOf(x) < D && x.team.id === r.team.id).slice(0, 10);
      if (prior.length < 3) return;
      PROPS.forEach(([type, code, keys]) => {
        const naive = prior.reduce((a, x) => a + statOf(x, keys), 0) / prior.length;
        const line = Math.floor(naive) + 0.5;
        props[r.game.id].push({ id: ++seq, game_id: r.game.id, player_id: id, vendor: "draftkings", prop_type: type, line_value: String(line),
          market: { type: "over_under", over_odds: -110, under_odds: -110 } });
        targets.push({ playerId: id, stat: code, line, actual: statOf(r, keys), naive });
      });
    });
    // regulars of those teams who did not play: "Out"
    teamIds.forEach((teamId) => {
      const seen = new Map();
      rows.filter((x) => x.team.id === teamId && dateOf(x) < D).forEach((x) => {
        const e = seen.get(x.player.id) || { n: 0, min: 0, player: x.player };
        e.n++; e.min += minutesOf(x.min); seen.set(x.player.id, e);
      });
      seen.forEach((e, id) => {
        if (e.n >= 3 && e.min / e.n >= 15 && !played.has(id)) injuries.push({ player: { id, first_name: e.player.first_name, last_name: e.player.last_name, position: e.player.position, team_id: teamId }, status: "Out" });
      });
    });
    const patched = games.map((g) => ({ ...g, status: g.datetime, period: 0, time: null, home_team_score: 0, visitor_team_score: 0 }));
    const snap = { date: D, games: patched, props, injuries, takenAt: Math.min(...games.map((g) => Date.parse(g.datetime))) - 3 * 3600e3 };
    for (const v of variantNames) {
      const body = await runEngineOn(path.resolve(__dirname, "../netlify/functions/hunt.js"), snap, { configure: VARIANTS[v] });
      const bySide = new Map(body.props.filter((p) => p.side === "over").map((p) => [`${p.playerId}-${p.stat}`, p]));
      targets.forEach((t) => {
        const p = bySide.get(`${t.playerId}-${t.stat}`);
        if (!p) return;
        results[v].push({ date: D, stat: t.stat, mean: p.projection.mean, overChance: p.chance / 100, line: t.line, actual: t.actual, naive: t.naive, role: p.factors.some((f) => f.key === "role" || f.key === "back"), key: `${D}-${t.playerId}-${t.stat}` });
      });
    }
    console.log(`  ${D}: ${games.length} games, ${targets.length} player-stats, ${injuries.length} out rows`);
  }

  // ---- report ----
  const out = [];
  const common = new Set(results[variantNames[0]].map((r) => r.key));
  variantNames.forEach((v) => { const keys = new Set(results[v].map((r) => r.key)); [...common].forEach((k) => { if (!keys.has(k)) common.delete(k); }); });
  const pick = (v) => results[v].filter((r) => common.has(r.key));
  const roleKeys = new Set();
  variantNames.forEach((v) => results[v].forEach((r) => { if (r.role && common.has(r.key)) roleKeys.add(r.key); }));
  const mean = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : NaN);
  const metrics = (list) => ({
    n: list.length,
    mae: mean(list.map((r) => Math.abs(r.mean - r.actual))),
    bias: mean(list.map((r) => r.mean - r.actual)),
    brier: mean(list.map((r) => (r.overChance - (r.actual > r.line ? 1 : 0)) ** 2)),
  });
  const naiveM = (list) => ({ n: list.length, mae: mean(list.map((r) => Math.abs(r.naive - r.actual))), bias: mean(list.map((r) => r.naive - r.actual)) });
  const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "–");
  out.push(`PROJECTION BACKTEST · ${from} .. ${to} · ${dates.length} dates · ${common.size} player-stats scored by every variant (market pull OFF, synthetic lines)`);
  const table = (label, filter) => {
    out.push("", label);
    out.push(`  ${pad("variant", 12)} ${padL("n", 6)} ${padL("MAE", 7)} ${padL("bias", 7)} ${padL("Brier", 7)}`);
    const first = pick(variantNames[0]).filter(filter);
    const nv = naiveM(first);
    out.push(`  ${pad("naive L10", 12)} ${padL(nv.n, 6)} ${padL(f(nv.mae), 7)} ${padL(f(nv.bias), 7)} ${padL("–", 7)}`);
    variantNames.forEach((v) => { const m = metrics(pick(v).filter(filter)); out.push(`  ${pad(v, 12)} ${padL(m.n, 6)} ${padL(f(m.mae), 7)} ${padL(f(m.bias), 7)} ${padL(f(m.brier, 4), 7)}`); });
  };
  table("ALL", () => true);
  table("ROLE-AFFECTED (a Role step in some variant)", (r) => roleKeys.has(r.key));
  table("NOT role-affected", (r) => !roleKeys.has(r.key));
  ["pts", "reb", "ast", "3pm", "pra"].forEach((s) => table(`STAT ${statWord(s)}`, (r) => r.stat === s));
  out.push("", "MAE = average |projection - actual| (lower is better); bias = average (projection - actual); Brier = squared error of the over chance at the synthetic line.");
  const text = out.join("\n");
  console.log("\n" + text);
  fs.writeFileSync(path.join(__dirname, "hunt-proj-backtest.txt"), text + "\n");
})().catch((error) => { console.error(error.message || error); process.exit(1); });
