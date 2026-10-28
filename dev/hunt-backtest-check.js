// LineHunter - dev/hunt-backtest-check.js
// Step 1 of the Hunt Score backtest (a console tool, not part of the site): does BALLDONTLIE keep player-prop lines for games
// that have FINISHED, and were they posted before tip-off? Everything else in the backtest depends on the answer.
// Run on localhost with the key from .env; writes the same text to dev/hunt-backtest-check.txt (gitignored).
//
//   node dev/hunt-backtest-check.js                  yesterday (America/New_York)
//   node dev/hunt-backtest-check.js 2026-10-24       that date
//
// For up to 3 finished games of the date it prints: how many props come back, which books and market types, every field of
// one prop as the API sends it (so we can see which timestamps exist), the earliest and latest timestamp against the tip-off,
// and a few lines next to the player's final stat (lines sitting right on top of the final numbers hint at live lines).

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
if (!process.env.BALLDONTLIE_API_KEY) {
  const match = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^BALLDONTLIE_API_KEY\s*=\s*"?([^"\n\r]+)"?/m);
  if (match) process.env.BALLDONTLIE_API_KEY = match[1].trim();
}
const etDate = (d) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const date = process.argv[2] || etDate(new Date(Date.now() - 864e5));

async function bdl(pathAndQuery) {
  const response = await fetch(`https://api.balldontlie.io${pathAndQuery}`, { headers: { Authorization: process.env.BALLDONTLIE_API_KEY } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} for ${pathAndQuery.split("?")[0]}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const STAT = { points: ["pts"], rebounds: ["reb"], assists: ["ast"], threes: ["fg3m"], points_rebounds_assists: ["pts", "reb", "ast"] };
const timeKeys = (obj, prefix = "") => Object.entries(obj || {}).flatMap(([key, value]) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return timeKeys(value, `${prefix}${key}.`);
  return /(_at|time|date|stamp)$/i.test(key) || /^\d{4}-\d{2}-\d{2}T/.test(String(value)) ? [[`${prefix}${key}`, value]] : [];
});
const minutesFromTip = (iso, tip) => Math.round((Date.parse(iso) - Date.parse(tip)) / 60000);

(async () => {
  const out = [];
  out.push(`BACKTEST STEP 1 · player-prop lines for finished games · ${date}`);
  const games = (await bdl(`/v1/games?start_date=${date}&end_date=${date}&per_page=100`)).data;
  const finished = games.filter((g) => g.status === "Final");
  out.push(`${games.length} games that day, ${finished.length} final.`);
  if (!finished.length) throw new Error(`No final games on ${date}. Try an earlier date: node dev/hunt-backtest-check.js 2026-10-24`);

  let gamesWithProps = 0;
  for (const game of finished.slice(0, 3)) {
    const label = `${game.visitor_team.abbreviation} @ ${game.home_team.abbreviation}`;
    out.push("", "-".repeat(100), "", `${label} · game ${game.id} · tip-off ${game.datetime || "unknown"} · final ${game.visitor_team_score}-${game.home_team_score}`);
    let props = [];
    try {
      const json = await bdl(`/nba/v2/odds/player_props?game_id=${game.id}`);
      props = json.data || [];
      if (json.meta && Object.keys(json.meta).length) out.push(`  meta: ${JSON.stringify(json.meta)}`);
    } catch (error) {
      out.push(`  props request failed: ${error.message}`);
      continue;
    }
    out.push(`  ${props.length} props came back`);
    if (!props.length) continue;
    gamesWithProps++;

    const count = (fn) => Object.entries(props.reduce((acc, p) => { const k = fn(p); acc[k] = (acc[k] || 0) + 1; return acc; }, {}))
      .sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ");
    out.push(`  books: ${count((p) => p.vendor)}`);
    out.push(`  market types: ${count((p) => (p.market && p.market.type) || "?")}`);
    out.push(`  prop types: ${count((p) => p.prop_type)}`);

    out.push("  one prop exactly as the API sends it:");
    JSON.stringify(props[0], null, 2).split("\n").forEach((line) => out.push(`    ${line}`));

    // every timestamp-looking field, earliest and latest, in minutes from tip-off (negative = before the game)
    const stamps = {};
    props.forEach((p) => timeKeys(p).forEach(([key, value]) => { if (!Number.isNaN(Date.parse(value))) (stamps[key] = stamps[key] || []).push(value); }));
    if (!Object.keys(stamps).length) out.push("  no timestamp fields on the props: can't tell when they were posted");
    Object.entries(stamps).forEach(([key, values]) => {
      values.sort();
      const first = values[0];
      const last = values[values.length - 1];
      const after = game.datetime ? values.filter((v) => Date.parse(v) > Date.parse(game.datetime)).length : null;
      out.push(`  ${key}: earliest ${first}${game.datetime ? ` (${minutesFromTip(first, game.datetime)} min from tip)` : ""}, latest ${last}${game.datetime ? ` (${minutesFromTip(last, game.datetime)} min from tip)` : ""}${after !== null ? ` · ${after} of ${values.length} after tip-off` : ""}`);
    });

    // a few over/under lines next to the final stat
    const stats = (await bdl(`/v1/stats?game_ids[]=${game.id}&per_page=100`)).data;
    const finalOf = (playerId, type) => {
      const log = stats.find((s) => s.player && s.player.id === playerId);
      return log && STAT[type] ? STAT[type].reduce((sum, key) => sum + (log[key] || 0), 0) : null;
    };
    const sample = props.filter((p) => p.market && p.market.type === "over_under" && STAT[p.prop_type]).slice(0, 8);
    if (sample.length) {
      out.push("  lines next to the final stat:");
      sample.forEach((p) => {
        const final = finalOf(p.player_id, p.prop_type);
        out.push(`    player ${p.player_id} ${p.prop_type} ${p.line_value} (${p.vendor}, o ${p.market.over_odds} / u ${p.market.under_odds}) · final ${final ?? "?"}`);
      });
      const all = props.filter((p) => p.market && p.market.type === "over_under" && STAT[p.prop_type])
        .map((p) => ({ line: Number(p.line_value), final: finalOf(p.player_id, p.prop_type) })).filter((r) => r.final !== null);
      const near = all.filter((r) => Math.abs(r.final - r.line) <= 1).length;
      out.push(`  ${all.length} over/under lines with a final stat; ${near} (${Math.round((near / (all.length || 1)) * 100)}%) sit within 1 of it`);
      out.push("  (a rough hint only: if most lines sit right on the final, they were likely moved during the game; the timestamps decide)");
    }
  }

  out.push("", "-".repeat(100), "");
  out.push(gamesWithProps
    ? "VERDICT: lines exist for finished games. Check the timestamps above: if they all sit before tip-off, the backtest can use them."
    : "VERDICT: no lines for finished games. The backtest has to save tonight's lines each day and grade them the next morning.");

  const text = out.join("\n");
  console.log(text);
  fs.writeFileSync(path.join(__dirname, "hunt-backtest-check.txt"), `${text}\n`);
})().catch((error) => { console.error(error.message || error); process.exit(1); });
