// LineHunter - js/core/demo.js
// LOCAL TESTING ONLY. Open a page with ?demo=1 on localhost (e.g. http://localhost:8899/hunts.html?demo=1) and it shows a made-up slate:
// three games tipping off in the next hours, a dozen stars with fake game logs, fake odds from two books (a few props have none, so the
// disabled "Add" buttons can be tested) and one injured player. It replaces the real slate (js/components/top-hit-rates.js stops loading),
// so every reader of the slate (the Hunts builder, The Board, the Today story deck) works with it. It does nothing on any other host
// or without ?demo=1. The numbers are random but seeded (same every time) and mean nothing.
(function () {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  if (!local || new URLSearchParams(location.search).get("demo") !== "1") return;
  window.LH_DEMO = true;

  let seed = 20261109;
  const rand = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  const GAMES = [
    { id: 9000001, away: "LAL", home: "DEN", hours: 2 },
    { id: 9000002, away: "BOS", home: "NYK", hours: 3 },
    { id: 9000003, away: "OKC", home: "HOU", hours: 4 },
  ];
  // name, team, game, means (pts, reb, ast, 3pm)
  const PLAYERS = [
    ["Nikola Jokic", "DEN", 0, 27, 12.5, 9.5, 1.5], ["Jamal Murray", "DEN", 0, 21, 4, 6, 2.5],
    ["LeBron James", "LAL", 0, 24, 7.5, 8, 1.8], ["Austin Reaves", "LAL", 0, 19, 4, 5.5, 2.3],
    ["Jayson Tatum", "BOS", 1, 27, 8.5, 5, 3], ["Jaylen Brown", "BOS", 1, 23, 5.5, 4, 2.2],
    ["Jalen Brunson", "NYK", 1, 28, 3.5, 6.5, 2.6], ["Karl-Anthony Towns", "NYK", 1, 22, 11.5, 3, 1.8],
    ["Shai Gilgeous-Alexander", "OKC", 2, 31, 5, 6.5, 1.4], ["Chet Holmgren", "OKC", 2, 16, 8, 2.5, 1.5],
    ["Alperen Sengun", "HOU", 2, 20, 9.5, 5.5, 0.6], ["Jalen Green", "HOU", 2, 21, 4, 3.5, 3],
  ].map(([name, team, game, ...means], i) => ({ name, team, game, means, id: 9100 + i }));
  const CODES = ["pts", "reb", "ast", "3pm", "pra"];
  const TYPE = { pts: "points", reb: "rebounds", ast: "assists", "3pm": "threes", pra: "points_rebounds_assists" };
  const now = Date.now();
  const today = new Date().toLocaleDateString("en-CA");
  const tips = {};
  GAMES.forEach((g) => { tips[g.id] = new Date(now + g.hours * 3600000).toISOString(); });

  const sideStats = (games, line, name) => {
    let streak = 0;
    for (const g of games) { if (g.overUnder !== name) break; streak += 1; }
    const hits = games.filter((g) => g.overUnder === name).length;
    const avg = games.length ? games.reduce((s, g) => s + g.value, 0) / games.length : 0;
    const margin = name === "over" ? avg - line : line - avg;
    return { hits, streak, hitRate: games.length ? Math.round((hits / games.length) * 1000) / 10 : null, cushion: Math.round(margin * 10) / 10 };
  };

  const rows = [];
  const props = [];
  let n = 0;
  PLAYERS.forEach((p) => {
    const game = GAMES[p.game];
    const opp = p.team === game.home ? game.away : game.home;
    CODES.forEach((code) => {
      const mean = code === "pra" ? p.means[0] + p.means[1] + p.means[2] : p.means[["pts", "reb", "ast", "3pm"].indexOf(code)];
      const line = Math.max(0.5, Math.round((mean + (rand() - 0.5) * mean * 0.35) * 2) / 2 - ((rand() < 0.5) ? 0.5 : 0) + 0.0);
      const lineHalf = Math.floor(line) + 0.5;
      const values = Array.from({ length: 20 }, () => Math.max(0, Math.round(mean + (rand() - 0.5) * mean * 0.9))); // newest first
      const gameRows = values.map((value, i) => ({
        gameId: 8000000 + i, date: new Date(now - (i + 1) * 2 * 86400000).toISOString().slice(0, 10), opponent: "OPP", homeAway: i % 2 ? "home" : "away",
        season: 2026, postseason: false, value, overUnder: value > lineHalf ? "over" : value < lineHalf ? "under" : "push",
        parts: [{ key: code, value }], minutes: 30 + Math.round(rand() * 6), teamScore: 110, opponentScore: 105,
      }));
      const w = {};
      [5, 10, 20].forEach((size) => {
        const part = gameRows.slice(0, size);
        w[size] = { totalGames: part.length, games: part, underGames: part.map((g) => ({ ...g, overUnder: g.overUnder === "over" ? "under" : g.overUnder === "under" ? "over" : "push" })),
          over: sideStats(part, lineHalf, "over"), under: sideStats(part, lineHalf, "under") };
      });
      const l10 = w[10];
      const best = l10.over.hitRate >= l10.under.hitRate ? "over" : "under";
      n += 1;
      const hasOdds = n % 7 !== 0; // every 7th prop has no price, to test the disabled Add button
      if (hasOdds) {
        [["draftkings", 0], ["fanduel", 6]].forEach(([vendor, shift]) => {
          let over = Math.round(-110 - (l10.over.hitRate - 50) * 1.5 + shift);
          over = Math.max(-300, Math.min(180, over));
          if (over > -100) over = 100 + (over + 100 > 0 ? over + 100 : 0);
          const under = over <= -100 ? Math.round(-over * 0.85 + 25) : -Math.round(over * 0.85 + 25);
          props.push({ game_id: game.id, player_id: p.id, vendor, prop_type: TYPE[code], line_value: String(lineHalf), market: { type: "over_under", over_odds: over, under_odds: under } });
        });
      }
      rows.push({
        gameId: game.id, playerId: p.id, name: p.name, team: p.team, matchup: p.team === game.home ? `vs ${opp}` : `@ ${opp}`, tip: tips[game.id],
        gameLabel: `${game.away} @ ${game.home}`, opp, book: "", overOdds: null, underOdds: null, bestOdds: { over: null, under: null },
        code, line: lineHalf, hits: l10[best].hits, totalGames: l10.totalGames, hitRate: l10[best].hitRate,
        average: values.slice(0, 10).reduce((s, v) => s + v, 0) / 10, games: l10.games, w,
      });
    });
  });
  rows.sort((a, b) => (b.w[10].over.hitRate - a.w[10].over.hitRate));

  const slate = { date: today, rows, injuries: { 9101: "Out" }, tips, legs: [], teamLegs: [], fan: [], incomplete: false };
  const badge = () => {
    const el = document.createElement("div");
    el.textContent = "Demo data (local only)";
    el.style.cssText = "position:fixed;top:6px;left:6px;z-index:2000;background:#d85a30;color:#fff;font:700 11px/1 sans-serif;padding:4px 8px;border-radius:4px;pointer-events:none;";
    document.body.appendChild(el);
  };
  window.addEventListener("load", () => {
    badge();
    if (typeof lhOdds !== "undefined") {
      lhOdds.ingest(props);
      rows.forEach((r) => { r.bestOdds = { over: lhOdds.getOdds(r.playerId, TYPE[r.code], r.line, "over")[0] || null, under: lhOdds.getOdds(r.playerId, TYPE[r.code], r.line, "under")[0] || null }; });
    }
    setTimeout(() => {
      document.dispatchEvent(new CustomEvent("lh-top-slate", { detail: { slate } }));
      document.dispatchEvent(new CustomEvent("lh-odds-ready"));
    }, 300);
  });
})();
