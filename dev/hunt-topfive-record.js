// LineHunter - dev/hunt-topfive-record.js
// The running record of the nightly top five (a console tool, not part of the site). For every saved night it rebuilds the top five from
// the sides saved before tip-off (the same selectTopFive the live engine uses, netlify/functions/hunt.js), grades each pick against the
// real box score, and prints every night plus the running totals.
//
// HONEST LABELS: the selection rules (score 60+, 8+ games, odds not shorter than -250, at most 10 points above the book's fair chance, 2 per
// game / 2 per stat) were fixed on Nov 9, 2026 AFTER looking at the first six graded nights (Oct 28 - Nov 7), so those nights are "retro"
// (rules applied in hindsight, the 92% there means little) and only nights from MIN_LIVE_DATE on are a real out-of-sample record: the
// Nov 8 games were not final yet when the rules were chosen.
//
//   node dev/hunt-topfive-record.js            all saved nights; writes dev/hunt-topfive-record.txt and .json (gitignored)
// Cloud: BALLDONTLIE_API_KEY=placeholder NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt

const fs = require("fs");
const path = require("path");
const { bdlAll, snapshotDates, snapshotFile, readJson, pad, padL, statWord } = require("./hunt-lib");
const { selectTopFive } = require("../netlify/functions/hunt.js");

const MIN_LIVE_DATE = "2026-11-08";
const FIELDS = { pts: ["pts"], reb: ["reb"], ast: ["ast"], "3pm": ["fg3m"], pra: ["pts", "reb", "ast"] };
const minutesOf = (min) => { const [m, s] = String(min || "0").split(":").map(Number); return (m || 0) + (s || 0) / 60; };
const profit = (odds, win) => (win ? (odds > 0 ? odds : 10000 / -odds) : -100);

(async () => {
  const out = [];
  const nights = [];
  for (const date of snapshotDates()) {
    const snap = readJson(snapshotFile(date));
    const saved = Object.values(snap.games);
    const sides = saved.flatMap((g) => g.sides);
    const five = selectTopFive(sides);
    const boxes = {};
    for (const g of saved) {
      const logs = await bdlAll(`/v1/stats?game_ids[]=${g.game.id}&per_page=100`);
      if (logs.length && logs[0].game.status === "Final") boxes[g.game.id] = Object.fromEntries(logs.map((l) => [l.player.id, l]));
    }
    const picks = five.map((p) => {
      const log = boxes[p.gameId] && boxes[p.gameId][p.playerId];
      if (!boxes[p.gameId]) return { p, result: "pending" };
      if (!log || !(minutesOf(log.min) > 0)) return { p, result: "void" };
      const actual = FIELDS[p.stat].reduce((a, k) => a + (log[k] || 0), 0);
      if (actual === p.line) return { p, result: "push", actual };
      const win = p.side === "over" ? actual > p.line : actual < p.line;
      return { p, result: win ? "WON" : "lost", actual, profit: Number.isFinite(p.odds) ? profit(p.odds, win) : null };
    });
    nights.push({ date, live: date >= MIN_LIVE_DATE, picks });
  }

  const tally = (list) => {
    const done = list.flatMap((n) => n.picks).filter((x) => x.result === "WON" || x.result === "lost");
    const won = done.filter((x) => x.result === "WON").length;
    const priced = done.filter((x) => Number.isFinite(x.profit));
    return { n: done.length, won, rate: done.length ? won / done.length : null, profitPer100: priced.length ? priced.reduce((a, x) => a + x.profit, 0) / priced.length : null };
  };
  const fmt = (t) => (t.n ? `${t.won}-${t.n - t.won} (${(100 * t.rate).toFixed(0)}%), profit per $100 pick ${t.profitPer100 >= 0 ? "+" : ""}${t.profitPer100.toFixed(1)}` : "no graded picks yet");

  out.push("THE NIGHTLY TOP FIVE · rebuilt from the sides saved before tip-off, graded against the box scores");
  out.push(`  retro = rules applied in hindsight (chosen after seeing these nights, so the record is inflated); live = rules fixed in advance (${MIN_LIVE_DATE} on)`);
  nights.forEach((n) => {
    out.push("", `${n.date} (${n.live ? "live" : "retro"}): ${n.picks.length} pick${n.picks.length === 1 ? "" : "s"}`);
    n.picks.forEach((x) => out.push(`  ${pad(x.result, 7)} ${pad(x.p.player, 24)} ${pad(`${x.p.side === "over" ? "Over" : "Under"} ${x.p.line} ${statWord(x.p.stat)}`, 18)} score ${x.p.score} odds ${padL(x.p.odds, 5)} ${x.actual !== undefined ? `actual ${x.actual}` : ""}`));
  });
  out.push("", "RUNNING TOTALS");
  out.push(`  retro (before ${MIN_LIVE_DATE}): ${fmt(tally(nights.filter((n) => !n.live)))}`);
  out.push(`  live  (${MIN_LIVE_DATE} on):    ${fmt(tally(nights.filter((n) => n.live)))}`);
  out.push(`  all nights:               ${fmt(tally(nights))}`);
  const text = out.join("\n");
  console.log(text);
  fs.writeFileSync(path.join(__dirname, "hunt-topfive-record.txt"), text + "\n");
  fs.writeFileSync(path.join(__dirname, "hunt-topfive-record.json"), JSON.stringify(nights.map((n) => ({ date: n.date, live: n.live, picks: n.picks.map((x) => ({ player: x.p.player, team: x.p.team, opp: x.p.opp, stat: x.p.stat, side: x.p.side, line: x.p.line, score: x.p.score, odds: x.p.odds, result: x.result, actual: x.actual })) })), null, 1));
})().catch((e) => { console.error(e.message || e); process.exit(1); });
