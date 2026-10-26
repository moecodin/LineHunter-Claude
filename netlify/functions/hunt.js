// LineHunter - netlify/functions/hunt.js
// The Hunt Score engine. GET /api/hunt?date=YYYY-MM-DD (default: today in America/New_York).
//
// For every player prop on that date's games that have not started, it builds a projection of the stat and simulates the game
// (Monte Carlo, CONFIG.sim.runs per player + prop, seeded so the same inputs always give the same answer). The Hunt Score of a
// side (OVER / UNDER) is the simulated chance of that side hitting, mapped to 0-100: 50 = a coin flip, 65 = about 60%.
//
// How the projection is built (every number lives in CONFIG):
//   rate per minute  this season's games, recency-weighted (a game's weight halves every 5 games), blended with a prior
//                    (last season while this season has under 20 games, else this season's flat average) that counts as 5 games
//   minutes          the same blend on minutes played
//   opponent / pace  multipliers using half the gap between tonight's opponent and the league average
//   back-to-back     a small multiplier when the team played yesterday
//   spread           minutes noise (the player's own, wider for a game-time decision), uncertainty in the true rate (wider with
//                    few games or when the last 3 games disagree with the projection) and game-to-game noise (from the logs)
// Each piece is added one at a time on top of a "season baseline" (season-level rate and minutes, average opponent, normal spread),
// so every factor shows how many points it moved the score ("Matchup +4.1", "Back-to-back -1.8") and they add up to the score.
// Three plain-English "why" sentences come from templates (no AI): recent form, the matchup, the biggest risk.
//
// The BALLDONTLIE key comes from the BALLDONTLIE_API_KEY environment variable and never reaches the browser. The CDN shares one
// calculation for 10 minutes and a warm function keeps its last answer per date for the same 10 minutes.
//
// BALLDONTLIE endpoints used (the same ones the site already uses through netlify/functions/bdl.js):
//   /v1/games                                       the slate for the date, and yesterday's games (back-to-backs)
//   /nba/v2/odds/player_props?game_id=              the lines
//   /v1/players                                     names and teams
//   /v1/stats?player_ids[]=&seasons[]=              game logs (this season, plus last season while a player has < 20 games)
//   /nba/v1/team_season_averages/general?type=opponent   points / rebounds / assists / threes each team ALLOWS per game
//   /nba/v1/team_season_averages/general?type=advanced   each team's pace
//   /v1/player_injuries                             Out / Doubtful / Questionable

const API_ORIGIN = "https://api.balldontlie.io";

// ============================ CONFIG: every weight lives here ============================
const CONFIG = {
  min: 0,
  max: 100,
  probToScore: 150,                            // score = 50 + (chance - 0.5) * 150: 60% -> 65, 70% -> 80
  sim: {
    runs: 2000,                                // simulated games per player + prop (both sides read the same runs)
    halfLife: 5,                               // recency weight halves every 5 games
    priorGames: 5,                             // the prior (last season, or this season's flat average) counts like 5 games
    priorUntilGames: 20,                       // last season is the prior until a player has this many games this season
    minPriorGames: 5,                          // a last season with fewer games is ignored
    opponentShrink: 0.5,                       // use half of the opponent's "allowed vs league" gap
    paceShrink: 0.5,                           // and half of the pace gap
    backToBack: 0.97,                          // second night of a back-to-back: 3% less of everything
    minutesSd: { base: 4, min: 3, max: 8, gtd: 1.5, games: 15 }, // minutes noise: the player's own spread over 15 games, x1.5 if GTD
    rateCv: { base: 0.05, sample: 0.3, ref: 0.1, minGames: 1 },  // rate uncertainty = 0.05 + 0.3 / sqrt(games); baseline uses 0.1
    priorSampleGames: 10,                      // a full last season adds this many games to the sample above
    disagree: { games: 3, free: 0.15, weight: 0.4, cap: 0.12 },  // last 3 games' rate off the projection by more than 15% widens it
    kMin: 3,                                   // game-to-game noise (negative binomial k), estimated from the logs
    kMax: 200,
    minutesClamp: [4, 46],
  },
  l10Games: 10,                                // the record quoted in the first "why" sentence
  minGamesTotal: 5,                            // fewer games than this (this + last season) = prop skipped
  topHunts: { max: 5, minScore: 65 },
  why: { paceTop: 5, b2bMinGames: 3, b2bMinDiff: 0.5, minutesMention: 2, smallSample: 8 },
  cacheMinutes: 10,                            // a warm function reuses its answer for a date this long (the CDN does the same)

  injuredStatuses: /out|doubt|question|day/i,  // Out, Doubtful, Questionable (the API calls Questionable "Day-To-Day")
  gtdStatuses: /question|day/i,                // the "game-time decision" ones: still scored, tagged GTD, never a top hunt
  preferredBook: "draftkings",
  concurrency: 8,                              // requests in flight at once
  playersPerLogRequest: 5,                     // same grouping the site uses for game logs
};

// The props we score. propType -> { code, stat key in a game log, opponent "allowed" fields }
const PROPS = {
  points: { code: "pts", keys: ["pts"], allowed: ["opp_pts"], word: "points" },
  rebounds: { code: "reb", keys: ["reb"], allowed: ["opp_reb"], word: "rebounds" },
  assists: { code: "ast", keys: ["ast"], allowed: ["opp_ast"], word: "assists" },
  threes: { code: "3pm", keys: ["fg3m"], allowed: ["opp_fg3m"], word: "threes" },
  points_rebounds_assists: { code: "pra", keys: ["pts", "reb", "ast"], allowed: ["opp_pts", "opp_reb", "opp_ast"], word: "points, rebounds and assists" },
};

// ---------- small helpers ----------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function etDate(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // "2026-10-19"
}
function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// BALLDONTLIE names a season by the year it starts; from September on the new one is current.
function seasonOf(isoDate) {
  const [year, month] = isoDate.split("-").map(Number);
  return month >= 9 ? year : year - 1;
}

async function bdl(pathAndQuery, attempt = 0) {
  const response = await fetch(`${API_ORIGIN}${pathAndQuery}`, { headers: { Authorization: process.env.BALLDONTLIE_API_KEY } });
  if (response.status === 429 && attempt < 3) { // too many requests: wait a moment and retry
    await sleep(700 * (attempt + 1));
    return bdl(pathAndQuery, attempt + 1);
  }
  if (!response.ok) throw new Error(`BALLDONTLIE answered ${response.status} for ${pathAndQuery.split("?")[0]}`);
  return response.json();
}

async function bdlAllPages(pathAndQuery) {
  const items = [];
  let cursor = null;
  do {
    const json = await bdl(cursor ? `${pathAndQuery}&cursor=${cursor}` : pathAndQuery);
    items.push(...json.data);
    cursor = json.meta && json.meta.next_cursor;
  } while (cursor);
  return items;
}

// Runs async tasks with at most `limit` at a time. Returns the results in order.
async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));
const playedInGame = (log) => Boolean(log.min) && log.min.split(":").some((part) => Number(part) > 0);
const statOf = (log, keys) => keys.reduce((sum, key) => sum + (log[key] ?? 0), 0);
const minutesOf = (log) => { const [m, s] = String(log.min).split(":").map(Number); return (m || 0) + (s || 0) / 60; };
const sum = (values) => values.reduce((a, b) => a + b, 0);
const average = (values) => (values.length ? sum(values) / values.length : null);

function teamLabel(team) { // "Boston", "LA Clippers"
  return team.city === "Los Angeles" ? `LA ${team.name}` : team.city;
}
function ordinal(n) {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}

// ---------- data loading ----------

async function loadSlate(date) {
  const games = await bdlAllPages(`/v1/games?start_date=${date}&end_date=${date}&per_page=100`);
  const now = Date.now();
  // Not started: nothing played yet, not final, and the tip-off is still ahead.
  return games.filter((game) => {
    if (game.status === "Final" || (game.period && game.period > 0)) return false;
    const tip = Date.parse(game.datetime || "");
    return Number.isNaN(tip) ? true : tip > now;
  });
}

// One line per player per prop (DraftKings first), over/under markets only.
async function loadLines(games) {
  const lists = await pool(games.map((game) => async () => {
    try { return (await bdl(`/nba/v2/odds/player_props?game_id=${game.id}`)).data; } catch (error) { return []; }
  }), CONFIG.concurrency);
  const picked = {};
  lists.flat()
    .filter((prop) => prop.market && prop.market.type === "over_under" && PROPS[prop.prop_type])
    .forEach((prop) => {
      const key = `${prop.player_id}-${prop.prop_type}`;
      if (!picked[key] || prop.vendor === CONFIG.preferredBook) picked[key] = prop;
    });
  return Object.values(picked);
}

async function loadPlayers(ids) {
  const players = {};
  const answers = await pool(chunk(ids, 100).map((group) => () => bdl(`/v1/players?per_page=100&${group.map((id) => `player_ids[]=${id}`).join("&")}`)), CONFIG.concurrency);
  answers.forEach((json) => json.data.forEach((player) => { players[player.id] = player; }));
  return players;
}

// { playerId: logs newest first } for one season, only games before `before` (a game in progress tonight never counts)
async function loadLogs(ids, season, before) {
  const logs = Object.fromEntries(ids.map((id) => [id, []]));
  const groups = chunk(ids, CONFIG.playersPerLogRequest);
  const answers = await pool(groups.map((group) => async () => {
    try { return await bdlAllPages(`/v1/stats?${group.map((id) => `player_ids[]=${id}`).join("&")}&seasons[]=${season}&per_page=100`); } catch (error) { return []; }
  }), CONFIG.concurrency);
  answers.flat().forEach((log) => {
    if (logs[log.player.id] && String(log.game.date).slice(0, 10) < before) logs[log.player.id].push(log);
  });
  Object.values(logs).forEach((list) => list.sort((a, b) => b.game.date.localeCompare(a.game.date)));
  return logs;
}

// { teamId: { opp_pts, ... } } for the season, or null when the season has no data yet
async function loadAllowed(season) {
  try {
    const rows = await bdlAllPages(`/nba/v1/team_season_averages/general?season=${season}&season_type=regular&type=opponent&per_page=100`);
    if (!rows.length) return null;
    const data = {};
    rows.forEach((row) => {
      data[row.team.id] = {};
      ["opp_pts", "opp_reb", "opp_ast", "opp_fg3m"].forEach((field) => { data[row.team.id][field] = Number(row.stats[field]); });
    });
    return data;
  } catch (error) {
    return null;
  }
}

// { teams: { teamId: { pace, rank, of } } (rank 1 = fastest), league } or null.
async function loadPace(season) {
  try {
    const rows = await bdlAllPages(`/nba/v1/team_season_averages/general?season=${season}&season_type=regular&type=advanced&per_page=100`);
    const list = rows.map((row) => ({ id: row.team.id, pace: Number(row.stats.pace) })).filter((row) => Number.isFinite(row.pace) && row.pace > 0);
    if (!list.length) return null;
    list.sort((a, b) => b.pace - a.pace);
    return {
      teams: Object.fromEntries(list.map((row, index) => [row.id, { pace: row.pace, rank: index + 1, of: list.length }])),
      league: average(list.map((row) => row.pace)),
    };
  } catch (error) {
    return null;
  }
}

async function loadInjuries(teamIds) {
  try {
    const rows = await bdlAllPages(`/v1/player_injuries?${teamIds.map((id) => `team_ids[]=${id}`).join("&")}&per_page=100`);
    const status = {};
    rows.forEach((row) => { if (row.player) status[row.player.id] = row.status || "Out"; });
    return status;
  } catch (error) {
    return {};
  }
}

// ---------- random numbers (seeded, so a prop scores the same every time its inputs are the same) ----------

function seededRandom(seedText) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) { h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { // mulberry32
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(rnd) { return Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()); }
function gamma(k, rnd) { // Marsaglia-Tsang, mean k
  if (k < 1) return gamma(k + 1, rnd) * Math.pow(rnd(), 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x; let v;
    do { x = normal(rnd); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = rnd();
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}
// Poisson draw from a fixed uniform u (inverse CDF), so every step of the score reuses the same random runs.
function poissonFromU(mu, u) {
  let k = 0;
  let p = Math.exp(-mu);
  let cdf = p;
  while (u > cdf && k < 400) { k++; p *= mu / k; cdf += p; }
  return k;
}

// ---------- the projection ----------

// Opponent "allowed" for a prop: rank 1..30 (1 = allows the most), per game, and the league average. null when we can't rank.
function opponentInfo(allowed, oppTeamId, prop) {
  if (!allowed || !allowed[oppTeamId]) return null;
  const totals = Object.entries(allowed).map(([teamId, row]) => [Number(teamId), prop.allowed.reduce((total, field) => total + (row[field] || 0), 0)]);
  if (totals.some(([, value]) => !Number.isFinite(value))) return null;
  totals.sort((a, b) => b[1] - a[1]);
  const index = totals.findIndex(([teamId]) => teamId === oppTeamId);
  if (index < 0) return null;
  const league = average(totals.map(([, value]) => value));
  const perGame = totals[index][1];
  return { rank: index + 1, of: totals.length, perGame, league, mult: 1 + CONFIG.sim.opponentShrink * (perGame / league - 1) };
}

// Pace: tonight's expected pace (both teams) against the player's usual games (his team vs an average team), half the gap.
function paceInfo(pace, teamId, oppTeamId) {
  if (!pace || !pace.teams[teamId] || !pace.teams[oppTeamId]) return null;
  const team = pace.teams[teamId].pace;
  const opp = pace.teams[oppTeamId];
  const raw = ((team + opp.pace) / 2) / ((team + pace.league) / 2);
  return { rank: opp.rank, of: opp.of, pace: round1(opp.pace), mult: 1 + CONFIG.sim.paceShrink * (raw - 1) };
}

// Weighted per-minute rate and minutes over games {v, m} (newest first). weights null = flat.
function rateAndMinutes(games, recency) {
  if (!games.length) return null;
  const w = games.map((_, i) => (recency ? Math.pow(0.5, i / CONFIG.sim.halfLife) : 1));
  const minutes = sum(games.map((g, i) => w[i] * g.m));
  return { rate: minutes > 0 ? sum(games.map((g, i) => w[i] * g.v)) / minutes : 0, minutes: minutes / sum(w) };
}

// Everything about one player + prop that both sides use, worked out once.
function describe(prop, ctx) {
  const toGame = (log) => ({ v: statOf(log, prop.keys), m: minutesOf(log), date: log.game.date });
  const cur = ctx.logs.current.filter(playedInGame).map(toGame);    // newest first
  const prev = ctx.logs.previous.filter(playedInGame).map(toGame);
  const played = [...cur, ...prev];
  if (played.length < CONFIG.minGamesTotal) return null;
  const S = CONFIG.sim;

  // The prior: last season while this season is young, else this season's own flat average.
  const usePrev = cur.length < S.priorUntilGames && prev.length >= S.minPriorGames;
  const prior = usePrev ? rateAndMinutes(prev, false) : rateAndMinutes(cur, false);
  const flat = rateAndMinutes(cur, false);
  const recent = rateAndMinutes(cur, true);
  const share = cur.length / (cur.length + S.priorGames);         // this season's share of the blend
  const blend = (now, key) => (now ? share * now[key] + (1 - share) * prior[key] : prior[key]);
  if (!prior) return null;

  const baseRate = blend(flat, "rate");
  const baseMinutes = blend(flat, "minutes");
  const formRate = blend(recent, "rate");
  const formMinutes = blend(recent, "minutes");

  // Spread pieces: minutes noise (the player's own), rate uncertainty (sample + disagreeing recent games), game-to-game noise.
  const recentMinutes = played.slice(0, S.minutesSd.games).map((g) => g.m);
  const mAvg = average(recentMinutes);
  const ownSd = recentMinutes.length >= 5 ? Math.sqrt(average(recentMinutes.map((m) => (m - mAvg) ** 2))) : S.minutesSd.base;
  const minutesSd = clamp(ownSd, S.minutesSd.min, S.minutesSd.max) * (ctx.gtd ? S.minutesSd.gtd : 1);

  const sampleGames = Math.max(S.rateCv.minGames, cur.length + (usePrev ? S.priorSampleGames : 0));
  const last = cur.slice(0, S.disagree.games);
  const lastRate = last.length === S.disagree.games ? rateAndMinutes(last, false).rate : null;
  const disagree = lastRate !== null && formRate > 0 ? Math.abs(lastRate / formRate - 1) : 0;
  const disagreeCv = clamp((disagree - S.disagree.free) * S.disagree.weight, 0, S.disagree.cap);
  const rateCv = S.rateCv.base + S.rateCv.sample / Math.sqrt(sampleGames) + disagreeCv;

  const base = played.slice(0, 40);                                 // overdispersion: var = mu + mu^2 / k around each game's own minutes
  const baseRateAll = sum(base.map((g) => g.v)) / Math.max(1, sum(base.map((g) => g.m)));
  const mus = base.map((g) => g.m * baseRateAll);
  const excess = average(base.map((g, i) => (g.v - mus[i]) ** 2 - mus[i]));
  const meanMu = average(mus);
  const k = excess > 0.05 ? clamp((meanMu * meanMu) / excess, S.kMin, S.kMax) : S.kMax;

  const l10 = played.slice(0, CONFIG.l10Games).map((g) => g.v);
  return {
    cur, prev, usePrev, share, k,
    baseRate, baseMinutes, formRate, formMinutes, minutesSd, rateCv, disagreeCv,
    lastAvg: last.length === S.disagree.games ? average(last.map((g) => g.v)) : null,
    l10, l10Avg: average(l10),
    seasonAvg: average((cur.length >= 10 || !prev.length ? cur : prev).map((g) => g.v)),
    seasonLabel: cur.length >= 10 || !prev.length ? "this season" : "last season",
    b2bSplit: backToBackSplit(cur.length >= 10 || !prev.length ? cur : prev),
  };
}

// Back-to-back split for the "why": games the day after the player's previous game vs the rest.
function backToBackSplit(games) {
  const dayMs = 24 * 60 * 60 * 1000;
  const b2b = [];
  const rest = [];
  games.forEach((game, index) => {
    const before = games[index + 1];
    const gap = before ? (Date.parse(game.date) - Date.parse(before.date)) / dayMs : null;
    (gap === 1 ? b2b : rest).push(game.v);
  });
  return b2b.length >= CONFIG.why.b2bMinGames && rest.length >= 5 ? { games: b2b.length, b2bAvg: average(b2b), restAvg: average(rest) } : null;
}

// The random runs for one player + prop: minutes noise, rate noise and game noise draws, plus the uniform for the final count.
function makeRuns(seed, k) {
  const rnd = seededRandom(seed);
  return Array.from({ length: CONFIG.sim.runs }, () => ({ zm: normal(rnd), zr: normal(rnd), g: gamma(k, rnd) / k, u: rnd() }));
}

// One simulation pass: { over, under } chances at the line (pushes left out), and the projection when `full`.
function simulate(runs, input, line, full) {
  const [lo, hi] = CONFIG.sim.minutesClamp;
  let over = 0;
  let under = 0;
  let total = 0;
  const values = full ? [] : null;
  runs.forEach((run) => {
    const minutes = clamp(input.minutes + input.minutesSd * run.zm, lo, hi);
    const rate = input.rate * Math.exp(input.rateCv * run.zr - (input.rateCv * input.rateCv) / 2);
    const mu = rate * minutes * input.mult * run.g;
    const x = poissonFromU(mu, run.u);
    if (x > line) over++; else if (x < line) under++;
    total += x;
    if (full) values.push(x);
  });
  const decided = over + under || 1;
  const result = { over: over / decided, under: under / decided };
  if (full) {
    values.sort((a, b) => a - b);
    result.mean = round1(total / runs.length);
    result.p10 = values[Math.floor(values.length * 0.1)];
    result.p90 = values[Math.floor(values.length * 0.9)];
  }
  return result;
}

const toScore = (chance) => 50 + (chance - 0.5) * CONFIG.probToScore;

// Builds the score step by step from the season baseline, so each factor carries the points it added for each side.
function runSteps(prop, line, info, ctx) {
  const runs = makeRuns(`${ctx.playerId}|${prop.code}|${line}`, info.k);
  const S = CONFIG.sim;
  let input = { rate: info.baseRate, minutes: info.baseMinutes, mult: 1, minutesSd: S.minutesSd.base, rateCv: S.rateCv.ref };
  let before = simulate(runs, input, line, false);
  const base = { over: toScore(before.over), under: toScore(before.under) };
  const steps = [];
  const step = (key, label, change, detail = {}) => {
    input = { ...input, ...change };
    const after = simulate(runs, input, line, false);
    steps.push({ key, label, detail, over: toScore(after.over) - toScore(before.over), under: toScore(after.under) - toScore(before.under) });
    before = after;
  };

  step("minutes", "Minutes", { minutes: info.formMinutes }, { now: round1(info.formMinutes), base: round1(info.baseMinutes) });
  step("form", "Recent form", { rate: info.formRate }, { last: info.lastAvg === null ? null : round1(info.lastAvg), games: info.cur.length });
  if (ctx.opponent) step("opponent", "Matchup", { mult: input.mult * ctx.opponent.mult }, { rank: ctx.opponent.rank, of: ctx.opponent.of, perGame: round1(ctx.opponent.perGame) });
  if (ctx.pace) step("pace", "Pace", { mult: input.mult * ctx.pace.mult }, { rank: ctx.pace.rank, of: ctx.pace.of, pace: ctx.pace.pace });
  if (ctx.backToBack) step("b2b", "Back-to-back", { mult: input.mult * S.backToBack });
  step("spread", "Uncertainty", { minutesSd: info.minutesSd, rateCv: info.rateCv }, {
    games: info.cur.length, lastSeason: info.usePrev, disagree: info.disagreeCv > 0, gtd: Boolean(ctx.gtd),
  });

  const projection = simulate(runs, input, line, true);
  return { base, steps, projection };
}

function scoreSide(side, sim) {
  const factors = sim.steps.map((s) => ({ key: s.key, label: s.label, points: round1(s[side]), ...s.detail }));
  const chance = sim.projection[side];
  return {
    score: Math.round(clamp(toScore(chance), CONFIG.min, CONFIG.max)),
    base: round1(sim.base[side]),
    chance: Math.round(chance * 100),
    factors,
  };
}

// ---------- the "why": three sentences from templates, every number real ----------
// 1) recent form (L10 record + average, minutes when they moved) and the projection, 2) the matchup (opponent rank, pace when it
// is extreme), 3) the biggest risk, weighed against the biggest plus. Sentences name the player by last name, never a pronoun.

function pick(options, playerId) { return options[playerId % options.length]; }

const FACTOR_WORD = { base: "the season numbers", minutes: "the minutes", form: "the recent form", opponent: "the matchup", pace: "the pace", spread: "the steady numbers" };

function writeWhy(side, prop, line, info, scored, sim, ctx) {
  const id = ctx.playerId;
  const over = side === "over";
  const f = Object.fromEntries(scored.factors.map((factor) => [factor.key, factor]));
  const last = ctx.lastName;
  const opp = ctx.oppLabel;
  const p = sim.projection;
  const hits = info.l10.filter((v) => (over ? v > line : v < line)).length;

  // 1) recent form + the projection
  const record = over ? `cleared ${line}` : `stayed under ${line}`;
  let s1 = pick([
    `${last} has ${record} in ${hits} of the last ${info.l10.length} games, averaging ${round1(info.l10Avg)}`,
    `${last} has ${record} in ${hits} of the last ${info.l10.length} games, with an average of ${round1(info.l10Avg)} in that span`,
  ], id);
  const m = f.minutes;
  if (m && Math.abs(m.now - m.base) >= CONFIG.why.minutesMention) s1 += `, with minutes trending ${m.now > m.base ? "up" : "down"} (${m.now} projected against ${m.base})`;
  s1 += `. The sim projects ${p.mean} (most games ${p.p10} to ${p.p90}), a ${scored.chance}% chance of going ${over ? "over" : "under"}.`;

  // 2) the matchup
  let s2;
  const o = f.opponent;
  if (o) {
    const most = o.rank <= o.of / 2;
    const nth = most ? o.rank : o.of - o.rank + 1;
    const amount = `${nth === 1 ? "the" : `the ${ordinal(nth)}`} ${most ? "most" : "fewest"}`;
    s2 = nth <= 8
      ? `Tonight's opponent, ${opp}, allows ${amount} ${prop.word} per game this season (${o.perGame})`
      : `Tonight's opponent, ${opp}, sits in the middle of the league in ${prop.word} allowed (${ordinal(o.rank)} of ${o.of}, ${o.perGame} a game)`;
  } else {
    s2 = `There is no clear matchup edge against ${opp} this season`;
  }
  const pace = f.pace;
  if (pace && (pace.rank <= CONFIG.why.paceTop || pace.rank > pace.of - CONFIG.why.paceTop)) {
    const fast = pace.rank <= CONFIG.why.paceTop;
    const helps = fast === over;
    s2 += ` and plays at ${fast ? `a top ${CONFIG.why.paceTop} pace` : `one of the ${CONFIG.why.paceTop} slowest paces`} in the league, so ${fast ? "extra" : "fewer"} possessions ${helps ? "should help" : "work against this pick"}`;
  }
  s2 += ".";

  // 3) the biggest risk, weighed against the biggest plus (the season baseline counts as one of the pieces)
  const pieces = [{ key: "base", points: scored.base - 50 }, ...scored.factors];
  const positives = pieces.filter((piece) => piece.points >= 1).sort((a, b) => b.points - a.points);
  const negatives = pieces.filter((piece) => piece.points <= -1).sort((a, b) => a.points - b.points);
  const best = positives[0];
  const worst = negatives[0];
  let risk;
  if (worst && worst.key === "b2b") {
    const split = info.b2bSplit;
    const cost = split ? round1(split.restAvg - split.b2bAvg) : 0;
    risk = split && cost >= CONFIG.why.b2bMinDiff
      ? `The biggest risk is a back-to-back, which has cost ${last} about ${cost} ${prop.word} a game (${split.games} games, ${info.seasonLabel})`
      : "The biggest risk is the second night of a back-to-back";
  } else if (worst && worst.key === "opponent") {
    risk = `The biggest risk is the matchup: ${opp} ranks ${ordinal(worst.rank)} of ${worst.of} in ${prop.word} allowed`;
  } else if (worst && worst.key === "pace") {
    risk = worst.rank > worst.of / 2
      ? `The biggest risk is the pace: ${opp} plays one of the slower games in the league (${ordinal(worst.rank)} of ${worst.of})`
      : `The biggest risk is the pace: ${opp} plays one of the faster games in the league (${ordinal(worst.rank)} of ${worst.of})`;
  } else if (worst && worst.key === "minutes") {
    risk = `The biggest risk is playing time: ${last}'s minutes project to ${worst.now}, against ${worst.base} on the season`;
  } else if (worst && worst.key === "form") {
    risk = worst.last !== null
      ? `The biggest risk is recent form: the last 3 games averaged ${worst.last}, ${over ? "below" : "above"} the season pace`
      : "The biggest risk is recent form";
  } else if (worst && worst.key === "spread") {
    if (worst.gtd) risk = `The biggest risk is availability: ${last} is a game-time decision (${ctx.injuryStatus}), so the minutes could swing`;
    else if (worst.games < CONFIG.why.smallSample) risk = `The biggest risk is a small sample: only ${worst.games} ${worst.games === 1 ? "game" : "games"} this season, so the range is wide`;
    else if (worst.disagree) risk = `The biggest risk is how much ${last}'s recent games swing (last 3 averaged ${round1(info.lastAvg)}), so the range is wide`;
    else risk = `The biggest risk is how much ${last}'s ${prop.word} swing from game to game`;
  } else if (worst && worst.key === "base") {
    risk = `The biggest risk is the line itself: ${last} ${info.seasonLabel === "last season" ? "averaged" : "averages"} ${round1(info.seasonAvg)} ${info.seasonLabel}, ${info.seasonAvg > line ? "over" : "under"} ${line}`;
  }
  let s3;
  if (risk) {
    s3 = best && best.points > Math.abs(worst.points)
      ? `${risk}, but it isn't enough to outweigh ${FACTOR_WORD[best.key] || "the rest"}.`
      : `${risk}, and it outweighs what is in ${last}'s favor.`;
  } else {
    s3 = `No real red flags: ${last} ${info.seasonLabel === "last season" ? "averaged" : "averages"} ${round1(info.seasonAvg)} ${info.seasonLabel} against a line of ${line}.`;
  }
  return [s1, s2, s3];
}

// ---------- the handler ----------

function reply(statusCode, body, headers = {}) {
  return { statusCode, headers: { "Content-Type": "application/json; charset=utf-8", ...headers }, body: JSON.stringify(body) };
}

const warmCache = {}; // date -> { savedAt, body }: a warm function answers repeat calls (Hunt Score page + Top 5) without recomputing

async function computeHunts(date) {
  const empty = { date, updatedAt: new Date().toISOString(), props: [], topHunts: [] };
  const games = await loadSlate(date);
  if (!games.length) return empty;

  const gameById = Object.fromEntries(games.map((game) => [game.id, game]));
  const lines = await loadLines(games);
  if (!lines.length) return empty;

  const season = seasonOf(date);
  const playerIds = [...new Set(lines.map((line) => line.player_id))];
  const teamIds = [...new Set(games.flatMap((game) => [game.home_team.id, game.visitor_team.id]))];

  const [players, currentLogs, yesterday, injuries] = await Promise.all([
    loadPlayers(playerIds),
    loadLogs(playerIds, season, date),
    bdlAllPages(`/v1/games?start_date=${addDays(date, -1)}&end_date=${addDays(date, -1)}&per_page=100`).catch(() => []),
    loadInjuries(teamIds),
  ]);
  const needLastSeason = playerIds.filter((id) => currentLogs[id].filter(playedInGame).length < CONFIG.sim.priorUntilGames);
  const [previousLogs, allowedNow, paceNow] = await Promise.all([
    needLastSeason.length ? loadLogs(needLastSeason, season - 1, date) : {},
    loadAllowed(season),
    loadPace(season),
  ]);
  const allowed = allowedNow || (await loadAllowed(season - 1)); // same fallback rule as the rest of the site
  const pace = paceNow || (await loadPace(season - 1));

  const playedYesterday = new Set(yesterday.flatMap((game) => [game.home_team.id, game.visitor_team.id]));

  const out = [];
  lines.forEach((entry) => {
    const prop = PROPS[entry.prop_type];
    const player = players[entry.player_id];
    const game = gameById[entry.game_id];
    if (!player || !player.team || !game) return;
    const teamId = player.team.id;
    const home = teamId === game.home_team.id;
    if (!home && teamId !== game.visitor_team.id) return; // team not in this game (just traded, data not updated)
    const oppTeam = home ? game.visitor_team : game.home_team;
    const line = Number(entry.line_value);
    if (!Number.isFinite(line) || line <= 0) return;

    const status = injuries[entry.player_id] || null;
    const injured = Boolean(status && CONFIG.injuredStatuses.test(status));
    const gtd = Boolean(injured && CONFIG.gtdStatuses.test(status) && !/out|doubt/i.test(status));
    const ctx = {
      playerId: entry.player_id,
      logs: { current: currentLogs[entry.player_id] || [], previous: previousLogs[entry.player_id] || [] },
      opponent: opponentInfo(allowed, oppTeam.id, prop),
      pace: paceInfo(pace, teamId, oppTeam.id),
      backToBack: playedYesterday.has(teamId),
      oppLabel: teamLabel(oppTeam),
      lastName: player.last_name,
      gtd,
      injuryStatus: status,
    };
    const info = describe(prop, ctx);
    if (!info) return; // fewer than 5 games in total

    const sim = runSteps(prop, line, info, ctx);
    ["over", "under"].forEach((side) => {
      const scored = scoreSide(side, sim);
      out.push({
        playerId: entry.player_id,
        player: `${player.first_name} ${player.last_name}`,
        team: player.team.abbreviation,
        opp: oppTeam.abbreviation,
        home,
        stat: prop.code,
        side,
        line,
        score: scored.score,
        base: scored.base,       // the season baseline's score; base + every factor's points = the score before rounding
        chance: scored.chance,   // simulated % chance of this side hitting (pushes left out)
        projection: { mean: sim.projection.mean, p10: sim.projection.p10, p90: sim.projection.p90 },
        factors: scored.factors, // key, label, points + the numbers behind each one, for the Hunt Score page
        why: writeWhy(side, prop, line, info, scored, sim, ctx),
        injured,                 // Out / Doubtful / Questionable / Day-To-Day
        gtd,
        injuryStatus: status,
        gameId: game.id,
        tipoff: game.datetime || null,
      });
    });
  });

  out.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const topHunts = [];
  for (const prop of out) {
    if (topHunts.length >= CONFIG.topHunts.max || prop.score < CONFIG.topHunts.minScore) break;
    if (prop.injured || seen.has(prop.playerId)) continue;
    seen.add(prop.playerId);
    topHunts.push(prop);
  }
  return { date, updatedAt: new Date().toISOString(), props: out, topHunts };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return reply(405, { error: "Only GET is allowed." }, { "Cache-Control": "no-store" });
  if (!process.env.BALLDONTLIE_API_KEY) return reply(500, { error: "BALLDONTLIE_API_KEY is not set on the server." }, { "Cache-Control": "no-store" });

  const todayET = etDate();
  const date = (event.queryStringParameters && event.queryStringParameters.date) || todayET;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return reply(400, { error: "date must look like 2026-10-20." }, { "Cache-Control": "no-store" });

  const cacheHeaders = { "Cache-Control": "public, s-maxage=600", "Netlify-CDN-Cache-Control": "public, s-maxage=600, stale-while-revalidate=600" };
  if (date > todayET) return reply(200, { date, updatedAt: new Date().toISOString(), props: [], topHunts: [] }, cacheHeaders); // future dates: an empty list

  const warm = warmCache[date];
  if (warm && Date.now() - warm.savedAt < CONFIG.cacheMinutes * 60 * 1000) return reply(200, warm.body, cacheHeaders);
  try {
    const body = await computeHunts(date);
    warmCache[date] = { savedAt: Date.now(), body };
    return reply(200, body, cacheHeaders);
  } catch (error) {
    return reply(502, { error: String(error.message || error) }, { "Cache-Control": "no-store" });
  }
};

exports.CONFIG = CONFIG; // for dev/hunt-compare.js
