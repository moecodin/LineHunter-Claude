// LineHunter - dev/hunt-whatif.js
// What if the Hunt Score used everything the Matchup Analyzer shows? A console tool, not part of the site.
// Takes one prop (tonight's top hunt by default), scores it with the real engine, then scores it again with five test steps
// added INSIDE the same simulation (netlify/functions/hunt.js setWhatIf), so each step's points are measured the way the
// engine measures its own factors. Prints both and writes dev/hunt-whatif.txt (gitignored).
//
//   node dev/hunt-whatif.js                          today, the top hunt
//   node dev/hunt-whatif.js 2026-10-28               that date's top hunt
//   node dev/hunt-whatif.js 2026-10-28 "Brunson" pts one player + stat (the side the engine likes better)
//
// The five test steps (weights in WHATIF below, all guesses to tune, none of them live):
//   role       tonight's lineup: minutes and per-minute output from his past games without tonight's missing teammates
//              (Out / Doubtful, 15+ min), replacing the engine's form numbers in proportion to how many such games there are
//   playtypes  his play types (share of possessions) vs what tonight's defense allows on each (Matchup Analyzer mapping)
//   h2h        his per-minute output vs this opponent over 5 seasons vs his normal per-minute output those seasons
//   defender   the opponent's top-minutes player at his position: FG% (3P% for threes) shooters make against him vs normally
//   rest       2+ days of rest for his team, and the opponent on the second night of a back-to-back

const fs = require("fs");
const path = require("path");

const WHATIF = {
  // role games: 50%+ of tonight's missing minutes also missing, newest count most (halves every 10 role games), last season's
  // games count half; minutes trust them like `n` games against 2 for the engine's form, the per-minute rate against 6
  role: { minMinutes: 15, minMatch: 0.5, halfLife: 10, lastSeason: 0.5, minutesPrior: 2, ratePrior: 6, showGames: 8 },
  playtypes: { minShare: 0.05, shrink: 0.5, cap: 0.05 },
  h2h: { minGames: 3, priorGames: 20, cap: 0.06, seasons: 5 },
  defender: { minMinutes: 10, share: 0.3, cap: 0.04 },
  rest: { rested: 1.01, oppTired: 1.015 },
  minSeasonGames: 5, // season-level numbers use this season once there are this many games, else last season
};

const root = path.join(__dirname, "..");
if (!process.env.BALLDONTLIE_API_KEY) {
  const match = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^BALLDONTLIE_API_KEY\s*=\s*"?([^"\n\r]+)"?/m);
  if (match) process.env.BALLDONTLIE_API_KEY = match[1].trim();
}
const date = process.argv[2] || new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const nameArg = (process.argv[3] || "").toLowerCase();
const statArg = (process.argv[4] || "").toLowerCase();

// Same answers for the same URL: the second engine run (and this script) reuse the first run's downloads.
const realFetch = global.fetch;
const fetchMemo = new Map();
global.fetch = (url, options) => {
  const key = String(url);
  if (!fetchMemo.has(key)) {
    fetchMemo.set(key, realFetch(url, options).then(async (r) => {
      if (!r.ok) fetchMemo.delete(key); // errors and 429s are retried for real
      return { ok: r.ok, status: r.status, body: await r.text() };
    }));
  }
  return fetchMemo.get(key).then((r) => ({ ok: r.ok, status: r.status, json: async () => JSON.parse(r.body) }));
};

const engine = require(path.join(root, "netlify/functions/hunt.js"));

// ---------- API helpers ----------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function bdl(pathAndQuery, attempt = 0) {
  const response = await fetch(`https://api.balldontlie.io${pathAndQuery}`, { headers: { Authorization: process.env.BALLDONTLIE_API_KEY } });
  if (response.status === 429 && attempt < 3) { await sleep(700 * (attempt + 1)); return bdl(pathAndQuery, attempt + 1); }
  if (!response.ok) throw new Error(`BALLDONTLIE answered ${response.status} for ${pathAndQuery.split("?")[0]}`);
  return response.json();
}
async function all(pathAndQuery) {
  const items = [];
  let cursor = null;
  do {
    const json = await bdl(cursor ? `${pathAndQuery}&cursor=${cursor}` : pathAndQuery);
    items.push(...json.data);
    cursor = json.meta && json.meta.next_cursor;
  } while (cursor);
  return items;
}
const soft = (promise, fallback) => promise.catch((error) => { console.warn(`  (skipped: ${error.message})`); return fallback; });

const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const minutesOf = (min) => { const [m, s] = String(min || "0").split(":").map(Number); return (m || 0) + (s || 0) / 60; };
const played = (log) => minutesOf(log.min) > 0;
const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const pct = (v) => (v === null ? "–" : `${(v > 1 ? v : v * 100).toFixed(1)}%`);
const signedPct = (mult) => `${mult >= 1 ? "+" : "−"}${Math.abs((mult - 1) * 100).toFixed(1)}%`;
const pad = (text, n) => String(text).padEnd(n);
const padL = (text, n) => String(text).padStart(n);
const seasonOf = (iso) => { const [y, m] = iso.split("-").map(Number); return m >= 9 ? y : y - 1; };
const addDays = (iso, days) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

const STAT_KEYS = { pts: ["pts"], reb: ["reb"], ast: ["ast"], "3pm": ["fg3m"], pra: ["pts", "reb", "ast"] };
const statOf = (log, code) => STAT_KEYS[code].reduce((sum, key) => sum + (log[key] || 0), 0);
const oppIdOf = (log) => (log.game.home_team_id === log.team.id ? log.game.visitor_team_id : log.game.home_team_id);

// A season-averages row for one player: this season with enough games, else last season.
async function seasonRow(category, type, playerId, season) {
  const url = (year) => `/nba/v1/season_averages/${category}?season=${year}&season_type=regular${type ? `&type=${type}` : ""}&player_ids[]=${playerId}`;
  const games = (row) => (row ? Number(row.stats.gp ?? row.stats.g ?? 0) : 0);
  const now = (await bdl(url(season))).data[0];
  if (games(now) >= WHATIF.minSeasonGames) return { season, stats: now.stats };
  const last = (await bdl(url(season - 1))).data[0];
  return last ? { season: season - 1, stats: last.stats } : now ? { season, stats: now.stats } : null;
}

// ---------- the five test steps ----------

// Role: tonight's lineup. Teammates listed Out / Doubtful who play 15+ minutes are "missing". Each of his past games on this team
// (this season + last) is scored by how much of that missing minutes total was also missing then (a teammate counts only in
// seasons he was on the team), and games at least `minMatch` alike are the role games: newest count most, last season's count
// less. Their minutes and per-minute output replace the engine's form numbers in proportion to how many there are.
async function roleStep(ctx) {
  const W = WHATIF.role;
  const injuries = await all(`/v1/player_injuries?team_ids[]=${ctx.teamId}&per_page=100`);
  const listed = injuries.filter((row) => row.player && row.player.id !== ctx.playerId && /out|doubt/i.test(row.status || "Out"));
  const gtd = injuries.filter((row) => row.player && row.player.id !== ctx.playerId && /question|day/i.test(row.status || ""));
  if (!listed.length) return { note: "no teammates listed Out / Doubtful: no role change" };
  const ids = [ctx.playerId, ...listed.map((row) => row.player.id)];
  const logs = await all(`/v1/stats?${ids.map((id) => `player_ids[]=${id}`).join("&")}&seasons[]=${ctx.season}&seasons[]=${ctx.season - 1}&per_page=100`);
  const onTeam = logs.filter((log) => log.team.id === ctx.teamId && String(log.game.date).slice(0, 10) < date);
  const mine = onTeam.filter((log) => log.player.id === ctx.playerId && played(log))
    .sort((a, b) => String(b.game.date).localeCompare(String(a.game.date)));

  // who is missing tonight, and how many minutes each usually plays (this season once he has 3 games, else last season)
  const missing = [];
  listed.forEach((row) => {
    const theirs = onTeam.filter((log) => log.player.id === row.player.id && played(log));
    const now = theirs.filter((log) => log.game.season === ctx.season);
    const usual = avg((now.length >= 3 ? now : theirs).map((log) => minutesOf(log.min)));
    if (!(usual >= W.minMinutes)) return;
    missing.push({
      name: `${row.player.first_name} ${row.player.last_name}`, last: row.player.last_name, status: row.status, minutes: usual,
      seasons: new Set([ctx.season, ctx.season - 1].filter((s) => theirs.filter((log) => log.game.season === s).length >= 5 || (s === ctx.season && theirs.some((log) => log.game.season === s)))),
      played: new Set(theirs.map((log) => log.game.id)),
    });
  });
  if (!missing.length) return { note: `listed: ${listed.map((row) => row.player.last_name).join(", ")}, none plays ${W.minMinutes}+ minutes` };

  const games = [];
  mine.forEach((log, index) => {
    const counted = missing.filter((m) => m.seasons.has(log.game.season));
    const total = counted.reduce((a, m) => a + m.minutes, 0);
    if (!total) return;
    const out = counted.filter((m) => !m.played.has(log.game.id));
    const match = out.reduce((a, m) => a + m.minutes, 0) / total;
    if (match < W.minMatch) return;
    const weight = match * Math.pow(0.5, games.length / W.halfLife) * (log.game.season === ctx.season ? 1 : W.lastSeason);
    games.push({ log, out, match, weight, v: statOf(log, ctx.stat), m: minutesOf(log.min) });
  });
  if (!games.length) return { note: `no past games without ${missing.map((m) => m.last).join(" / ")}` };

  const n = games.reduce((a, g) => a + g.weight, 0); // effective games
  const minutes = games.reduce((a, g) => a + g.weight * g.m, 0) / n;
  const allMin = games.reduce((a, g) => a + g.weight * g.m, 0);
  const rate = allMin > 0 ? games.reduce((a, g) => a + g.weight * g.v, 0) / allMin : 0;
  const role = {
    minutes, rate, n,
    minutesWeight: n / (n + W.minutesPrior), rateWeight: n / (n + W.ratePrior),
    games: games.length, thisSeason: games.filter((g) => g.log.game.season === ctx.season).length,
  };
  const word = (code) => (code === "3pm" ? "3PM" : code.toUpperCase());
  const list = games.slice(0, W.showGames).map((g) => {
    const opp = ctx.abbrOf(oppIdOf(g.log));
    return `      ${String(g.log.game.date).slice(0, 10)} ${g.log.game.season === ctx.season ? "  " : "LS"} vs ${pad(opp, 4)} ${padL(g.m.toFixed(0), 3)} min ${padL(g.v, 3)} ${word(ctx.stat)}   without ${g.out.map((m) => m.last).join(", ")}`;
  });
  return {
    role,
    note: `missing ${missing.map((m) => `${m.last} ${m.minutes.toFixed(0)} min`).join(", ")}${gtd.length ? ` (GTD not counted: ${gtd.map((row) => row.player.last_name).join(", ")})` : ""}`
      + `\n      ${games.length} role games (${role.thisSeason} this season), ${n.toFixed(1)} effective: ${minutes.toFixed(1)} min, ${(rate * 36).toFixed(1)} ${word(ctx.stat)} per 36`
      + `\n${list.join("\n")}${games.length > W.showGames ? `\n      ... ${games.length - W.showGames} more` : ""}`,
  };
}

const PLAY_TYPES = [
  { type: "isolation", label: "Isolation", def: "fg" }, { type: "prballhandler", label: "P&R ball handler", def: "rim" },
  { type: "prrollman", label: "P&R roll man", def: "paint" }, { type: "spotup", label: "Spot-up", def: "three" },
  { type: "postup", label: "Post-up", def: "paint" }, { type: "transition", label: "Transition", def: "fastbreak" },
  { type: "cut", label: "Cuts", def: "paint" }, { type: "offscreen", label: "Off screens", def: "three" },
  { type: "handoff", label: "Handoffs", def: "rim" }, { type: "offrebound", label: "Putbacks", def: "second" },
];
const DEFENSE = {
  fg: (t) => t.opponent.opp_fg_pct, rim: (t) => t.range["less_than_5_ft._opp_fg_pct"], paint: (t) => t.misc.opp_pts_paint,
  three: (t) => t.opponent.opp_fg3_pct, fastbreak: (t) => t.misc.opp_pts_fb, second: (t) => t.misc.opp_pts_2nd_chance,
};

async function teamDefense(season) {
  const get = (year, p) => all(`/nba/v1/team_season_averages/${p}&season=${year}&season_type=regular&per_page=100`);
  let year = season;
  let opponent = await get(year, "general?type=opponent");
  if (!opponent.length || Math.min(...opponent.map((row) => Number(row.stats.gp) || 0)) < WHATIF.minSeasonGames) { year = season - 1; opponent = await get(year, "general?type=opponent"); }
  const [misc, range] = await Promise.all([get(year, "general?type=misc"), get(year, "shooting?type=5ft_range_opponent")]);
  const byTeam = {};
  const add = (rows, part) => rows.forEach((row) => { byTeam[row.team.id] = byTeam[row.team.id] || { misc: {}, opponent: {}, range: {} }; byTeam[row.team.id][part] = row.stats; });
  add(opponent, "opponent"); add(misc, "misc"); add(range, "range");
  return { season: year, byTeam };
}

// Points steps also move PRA, scaled by how much of his PRA is points.
const scoringShare = (ctx) => (ctx.stat === "pra" ? ctx.ptsShare : 1);

async function playTypesStep(ctx) {
  if (!["pts", "3pm", "pra"].includes(ctx.stat)) return { note: "scoring props only" };
  const W = WHATIF.playtypes;
  const url = (year, type) => `/nba/v1/season_averages/playtype?season=${year}&season_type=regular&type=${type}&player_ids[]=${ctx.playerId}`;
  const probe = (await bdl(url(ctx.season, "spotup"))).data[0];
  const year = probe && Number(probe.stats.gp) >= WHATIF.minSeasonGames ? ctx.season : ctx.season - 1;
  const rows = (await Promise.all(PLAY_TYPES.map((pt) => bdl(url(year, pt.type)).then((j) => (j.data[0] ? { ...pt, ...j.data[0].stats } : null)).catch(() => null)))).filter(Boolean);
  const def = await teamDefense(ctx.season);
  const teams = Object.values(def.byTeam);
  const opp = def.byTeam[ctx.oppId];
  if (!rows.length || !opp) return { note: "no play-type data" };
  let weighted = 0;
  let shares = 0;
  const parts = [];
  rows.forEach((row) => {
    let share = num(row.poss_pct) || 0;
    if (share > 1) share /= 100;
    const value = num(DEFENSE[row.def](opp));
    const league = avg(teams.map((t) => num(DEFENSE[row.def](t))).filter((v) => v !== null));
    if (share < W.minShare || value === null || !league) return;
    weighted += share * (value / league - 1);
    shares += share;
    parts.push(`${row.label} ${Math.round(share * 100)}% (${(value / league - 1 >= 0 ? "+" : "")}${((value / league - 1) * 100).toFixed(1)}% vs league)`);
  });
  if (!shares) return { note: "no play type above 5%" };
  const mult = clamp(1 + weighted * W.shrink * scoringShare(ctx), 1 - W.cap, 1 + W.cap);
  return { mult, note: `${year}-${String(year + 1).slice(2)} play types: ${parts.join(", ")}` };
}

async function h2hStep(ctx) {
  const W = WHATIF.h2h;
  const seasons = Array.from({ length: W.seasons }, (_, i) => ctx.season - i);
  const logs = (await all(`/v1/stats?player_ids[]=${ctx.playerId}&${seasons.map((s) => `seasons[]=${s}`).join("&")}&per_page=100`))
    .filter((log) => played(log) && String(log.game.date).slice(0, 10) < date);
  const perMin = (list) => { const m = list.reduce((a, l) => a + minutesOf(l.min), 0); return m > 0 ? list.reduce((a, l) => a + statOf(l, ctx.stat), 0) / m : null; };
  let ratioSum = 0;
  let n = 0;
  seasons.forEach((season) => {
    const games = logs.filter((log) => log.game.season === season);
    const vs = games.filter((log) => oppIdOf(log) === ctx.oppId);
    const base = perMin(games);
    if (!vs.length || !base) return;
    ratioSum += (perMin(vs) / base) * vs.length;
    n += vs.length;
  });
  if (n < W.minGames) return { note: `${n} games vs ${ctx.oppAbbr} in ${W.seasons} seasons, not used` };
  const ratio = ratioSum / n;
  const mult = clamp(1 + (ratio - 1) * (n / (n + W.priorGames)), 1 - W.cap, 1 + W.cap);
  return { mult, note: `${n} games vs ${ctx.oppAbbr}: ${((ratio - 1) * 100 >= 0 ? "+" : "")}${((ratio - 1) * 100).toFixed(1)}% per minute vs his normal, counted at ${Math.round((n / (n + W.priorGames)) * 100)}%` };
}

async function defenderStep(ctx) {
  if (!["pts", "3pm", "pra"].includes(ctx.stat)) return { note: "scoring props only" };
  const W = WHATIF.defender;
  const group = String(ctx.position || "").trim().charAt(0).toUpperCase();
  const [roster, injuries] = await Promise.all([
    all(`/v1/players/active?team_ids[]=${ctx.oppId}&per_page=100`),
    all(`/v1/player_injuries?team_ids[]=${ctx.oppId}&per_page=100`),
  ]);
  const out = new Set(injuries.filter((row) => row.player && /out|doubt/i.test(row.status || "Out")).map((row) => row.player.id));
  const ids = roster.map((p) => p.id);
  const avgs = async (year) => all(`/nba/v1/season_averages/general?season=${year}&season_type=regular&type=base&per_page=100&${ids.map((id) => `player_ids[]=${id}`).join("&")}`);
  let rows = await avgs(ctx.season);
  if (rows.filter((row) => Number(row.stats.gp) >= WHATIF.minSeasonGames).length < 5) rows = await avgs(ctx.season - 1);
  const minutes = Object.fromEntries(rows.map((row) => [row.player.id, minutesOf(row.stats.min)]));
  const candidates = roster
    .filter((p) => String(p.position || "").trim().charAt(0).toUpperCase() === group && !out.has(p.id) && (minutes[p.id] || 0) >= W.minMinutes)
    .sort((a, b) => (minutes[b.id] || 0) - (minutes[a.id] || 0));
  const defender = candidates[0];
  if (!defender) return { note: `no healthy ${group || "?"} on ${ctx.oppAbbr} with 10+ minutes` };
  const type = ctx.stat === "3pm" ? "3_pointers" : "overall";
  const row = await seasonRow("defense", type, defender.id, ctx.season);
  if (!row) return { note: `no defense numbers for ${defender.last_name}` };
  const allowed = num(ctx.stat === "3pm" ? row.stats.fg3_pct : row.stats.d_fg_pct);
  const normal = num(ctx.stat === "3pm" ? row.stats.ns_fg3_pct : row.stats.normal_fg_pct);
  if (!allowed || !normal) return { note: `no defense numbers for ${defender.last_name}` };
  const mult = clamp(1 + (allowed / normal - 1) * W.share * scoringShare(ctx), 1 - W.cap, 1 + W.cap);
  return { mult, note: `${defender.first_name} ${defender.last_name} (${defender.position}, ${(minutes[defender.id] || 0).toFixed(1)} min): shooters make ${pct(allowed)} vs ${pct(normal)} normally` };
}

async function restStep(ctx) {
  const W = WHATIF.rest;
  const games = await all(`/v1/games?team_ids[]=${ctx.teamId}&team_ids[]=${ctx.oppId}&start_date=${addDays(date, -6)}&end_date=${addDays(date, -1)}&per_page=100`);
  const lastGame = (teamId) => games.filter((g) => g.home_team.id === teamId || g.visitor_team.id === teamId).map((g) => String(g.date).slice(0, 10)).sort().pop();
  const restDays = (teamId) => { const last = lastGame(teamId); return last ? Math.round((Date.parse(date) - Date.parse(last)) / 864e5) - 1 : null; };
  const mine = restDays(ctx.teamId);
  const theirs = restDays(ctx.oppId);
  let mult = 1;
  if (mine !== null && mine >= 2) mult *= W.rested;
  if (theirs === 0) mult *= W.oppTired;
  const words = (d) => (d === null ? "6+ days" : d === 0 ? "back-to-back" : `${d} day${d === 1 ? "" : "s"}`);
  return { mult, note: `${ctx.teamAbbr} rest ${words(mine)} · ${ctx.oppAbbr} rest ${words(theirs)}` };
}

// ---------- run ----------

async function runEngine() {
  const answer = await engine.handler({ httpMethod: "GET", queryStringParameters: { date } });
  const body = JSON.parse(answer.body);
  if (answer.statusCode !== 200) throw new Error(body.error);
  return body;
}

(async () => {
  console.log(`Scoring ${date} with the real engine...`);
  const before = await runEngine();
  if (!before.props.length) throw new Error(`No scored props for ${date} (no games, every game started, or no lines yet).`);
  let target;
  if (nameArg) {
    const list = before.props.filter((p) => p.player.toLowerCase().includes(nameArg) && (!statArg || p.stat === statArg)).sort((a, b) => b.score - a.score);
    target = list[0];
    if (!target) throw new Error(`No prop for "${process.argv[3]}"${statArg ? ` ${statArg}` : ""} on ${date}.`);
  } else {
    target = before.topHunts[0] || [...before.props].sort((a, b) => b.score - a.score)[0];
  }

  const game = (await bdl(`/v1/games/${target.gameId}`)).data;
  const player = (await bdl(`/v1/players/${target.playerId}`)).data;
  const season = seasonOf(date);
  const teamId = target.home ? game.home_team.id : game.visitor_team.id;
  const oppId = target.home ? game.visitor_team.id : game.home_team.id;
  const recent = (await all(`/v1/stats?player_ids[]=${target.playerId}&seasons[]=${season}&seasons[]=${season - 1}&per_page=100`)).filter(played);
  const ptsAvg = avg(recent.map((l) => l.pts || 0)) || 0;
  const praAvg = avg(recent.map((l) => statOf(l, "pra"))) || 1;
  const ctx = {
    playerId: target.playerId, stat: target.stat, season, teamId, oppId, teamAbbr: target.team, oppAbbr: target.opp,
    position: player.position, ptsShare: ptsAvg / praAvg,
    abbrOf: ((teams) => (id) => (teams[id] || "?"))(Object.fromEntries((await all("/v1/teams?per_page=100")).map((t) => [t.id, t.abbreviation]))),
  };

  console.log(`Loading the Matchup Analyzer numbers for ${target.player}...`);
  const STEPS = [
    ["role", "Role (lineup tonight)", roleStep],
    ["playtypes", "Play types vs defense", playTypesStep],
    ["h2h", "Head-to-head", h2hStep],
    ["defender", "Defender check", defenderStep],
    ["rest", "Rest", restStep],
  ];
  const results = [];
  for (const [key, label, fn] of STEPS) results.push({ key, label, ...(await soft(fn(ctx), { note: "data unavailable" })) });

  const multSteps = results.filter((r) => r.mult && Math.abs(r.mult - 1) > 1e-9).map((r) => ({ key: r.key, label: r.label, mult: r.mult }));
  const roleResult = results.find((r) => r.role);
  let roleUsed = null; // the engine's form numbers and the blended role numbers, filled in when the engine calls back
  const extra = (info) => {
    if (!roleResult) return multSteps;
    const r = roleResult.role;
    const minutes = r.minutesWeight * r.minutes + (1 - r.minutesWeight) * info.formMinutes;
    const rate = r.rateWeight * r.rate + (1 - r.rateWeight) * info.formRate;
    roleUsed = { fromMinutes: info.formMinutes, fromRate: info.formRate, minutes, rate };
    return [{ key: "role", label: "Role (lineup tonight)", set: { minutes, rate } }, ...multSteps];
  };
  const keys = new Set([...(roleResult ? ["role"] : []), ...multSteps.map((m) => m.key)]);
  engine.setWhatIf(({ playerId, stat, info }) => (playerId === target.playerId && stat === target.stat ? extra(info) : null));
  const after = await runEngine();
  engine.setWhatIf(null);
  const sameProp = (p) => p.playerId === target.playerId && p.stat === target.stat && p.side === target.side;
  const now = after.props.find(sameProp);
  const otherSide = (body) => body.props.find((p) => p.playerId === target.playerId && p.stat === target.stat && p.side !== target.side);

  const signed = (v) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)}`;
  const out = [];
  out.push(`${target.player} (${target.team} ${target.home ? "vs" : "@"} ${target.opp}) · ${target.side === "over" ? "Over" : "Under"} ${target.line} ${target.stat.toUpperCase()} · ${date}`);
  out.push("");
  out.push("TODAY'S HUNT SCORE");
  out.push(`  ${pad("Season baseline", 26)} ${padL(target.base.toFixed(1), 6)}`);
  target.factors.forEach((f) => out.push(`  ${pad(f.label, 26)} ${padL(signed(f.points), 6)}`));
  out.push(`  ${pad("= Hunt Score", 26)} ${padL(target.score, 6)}   ${target.chance}% chance · projects ${target.projection.mean} (${target.projection.p10}-${target.projection.p90})`);
  out.push("");
  out.push("MATCHUP ANALYZER PIECES (test weights)");
  results.forEach((r) => {
    if (r.role && roleUsed) {
      const w = (code) => (code === "3pm" ? "3PM" : code.toUpperCase());
      out.push(`  ${pad(r.label, 26)} ${padL("", 8)}   minutes ${roleUsed.fromMinutes.toFixed(1)} -> ${roleUsed.minutes.toFixed(1)} (role games ${r.role.minutes.toFixed(1)}, trusted ${Math.round(r.role.minutesWeight * 100)}%)`);
      out.push(`  ${pad("", 26)} ${padL("", 8)}   ${w(target.stat)} per 36 ${(roleUsed.fromRate * 36).toFixed(1)} -> ${(roleUsed.rate * 36).toFixed(1)} (role games ${(r.role.rate * 36).toFixed(1)}, trusted ${Math.round(r.role.rateWeight * 100)}%)`);
      out.push(`      ${r.note}`);
      return;
    }
    out.push(`  ${pad(r.label, 26)} ${padL(r.mult ? signedPct(r.mult) : "not used", 8)}   ${r.note || ""}`);
  });
  out.push("");
  out.push("WITH EVERYTHING");
  out.push(`  ${pad("Season baseline", 26)} ${padL(now.base.toFixed(1), 6)}`);
  now.factors.forEach((f) => {
    const isNew = keys.has(f.key);
    out.push(`  ${pad(f.label, 26)} ${padL(signed(f.points), 6)}${isNew ? "   NEW" : ""}`);
  });
  out.push(`  ${pad("= Hunt Score", 26)} ${padL(now.score, 6)}   ${now.chance}% chance · projects ${now.projection.mean} (${now.projection.p10}-${now.projection.p90})`);
  out.push("");
  const diff = now.score - target.score;
  out.push(`RESULT: ${target.score} -> ${now.score} (${diff > 0 ? "+" : ""}${diff})${now.score >= 65 ? "" : " · below the 65 top-hunt bar"}`);
  const flipA = otherSide(before);
  const flipB = otherSide(after);
  if (flipA && flipB && flipB.score > now.score) out.push(`The other side now scores higher: ${flipB.side} ${flipB.score} (was ${flipA.score}).`);
  out.push("");
  out.push("New steps run inside the same 2,000 simulated games, after back-to-back and before the book line (the book-line pull");
  out.push("and the uncertainty step then act on the new projection, as they do on the engine's own factors).");
  out.push("The Role step swaps in the role games' minutes and per-minute output. LS = a last-season game (counts half).");

  const text = out.join("\n");
  console.log(`\n${text}`);
  fs.writeFileSync(path.join(__dirname, "hunt-whatif.txt"), `${text}\n`);
})().catch((error) => { console.error(error.message || error); process.exit(1); });
