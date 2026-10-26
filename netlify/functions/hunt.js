// LineHunter - netlify/functions/hunt.js
// The Hunt Score engine. GET /api/hunt?date=YYYY-MM-DD (default: today in America/New_York).
//
// For every player prop on that date's games that have not started, it scores the OVER and the UNDER separately
// (start at 50, add the factors below, clamp 0-100, round), writes three plain-English "why" sentences from templates
// (no AI), and returns the list plus the day's top hunts. The BALLDONTLIE key comes from the BALLDONTLIE_API_KEY
// environment variable and never reaches the browser. The CDN shares one calculation for 10 minutes.
//
// BALLDONTLIE endpoints used (the same ones the site already uses through netlify/functions/bdl.js):
//   /v1/games                                       the slate for the date, and yesterday's games (back-to-backs)
//   /nba/v2/odds/player_props?game_id=              the lines
//   /v1/players                                     names and teams
//   /v1/stats?player_ids[]=&seasons[]=              game logs (this season, plus last season when a player has < 10 games)
//   /nba/v1/team_season_averages/general?type=opponent   points / rebounds / assists / threes each team ALLOWS per game
//   /nba/v1/team_season_averages/general?type=advanced   each team's pace (only for the "why" sentences)
//   /v1/player_injuries                             Out / Doubtful / Questionable

const API_ORIGIN = "https://api.balldontlie.io";

// ============================ CONFIG: every weight lives here ============================
const CONFIG = {
  base: 50,
  min: 0,
  max: 100,
  l10: { weight: 40, games: 10 },              // (L10 hit rate - 0.5) * 40
  season: { weight: 20, minGames: 10 },        // (season hit rate - 0.5) * 20; under minGames this season -> last season
  lineVsAvg: { weight: 0.5, cap: 8 },          // % gap between the L10 average and the line, * 0.5, capped at +-8
  opponent: { best: 8, worst: -8 },            // rank 1 (allows the most) = best for an over ... rank 30 = worst
  minutes: { weight: 1.5, cap: 6, recentGames: 5 },  // (L5 avg minutes - season avg minutes) * 1.5, capped at +-6
  backToBack: -4,                              // the team played yesterday
  minGamesTotal: 5,                            // fewer games than this (this + last season) = prop skipped
  // Deviation from the brief (it flips only the line and opponent factors for unders). These two are fatigue / role signals,
  // so with the flags on they flip too: more minutes HELP an over and HURT an under. Set to false for the literal brief.
  flipMinutesForUnder: true,
  flipBackToBackForUnder: true,
  topHunts: { max: 5, minScore: 65 },
  why: { paceTop: 5, b2bMinGames: 3, b2bMinDiff: 0.5, minutesMention: 2 }, // pace rank 1-5 / 26-30 is mentioned; B2B split needs 3+ games

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
const average = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

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

// { playerId: logs newest first } for one season
async function loadLogs(ids, season) {
  const logs = Object.fromEntries(ids.map((id) => [id, []]));
  const groups = chunk(ids, CONFIG.playersPerLogRequest);
  const answers = await pool(groups.map((group) => async () => {
    try { return await bdlAllPages(`/v1/stats?${group.map((id) => `player_ids[]=${id}`).join("&")}&seasons[]=${season}&per_page=100`); } catch (error) { return []; }
  }), CONFIG.concurrency);
  answers.flat().forEach((log) => { if (logs[log.player.id]) logs[log.player.id].push(log); });
  Object.values(logs).forEach((list) => list.sort((a, b) => b.game.date.localeCompare(a.game.date)));
  return logs;
}

// { teamId: { opp_pts, ... , name } } for the season, or null when the season has no data yet
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

// { teamId: { pace, rank, of } } (rank 1 = fastest), or null. Only used in the "why" sentences, never in the score.
async function loadPace(season) {
  try {
    const rows = await bdlAllPages(`/nba/v1/team_season_averages/general?season=${season}&season_type=regular&type=advanced&per_page=100`);
    const list = rows.map((row) => ({ id: row.team.id, pace: Number(row.stats.pace) })).filter((row) => Number.isFinite(row.pace));
    if (!list.length) return null;
    list.sort((a, b) => b.pace - a.pace);
    return Object.fromEntries(list.map((row, index) => [row.id, { pace: row.pace, rank: index + 1, of: list.length }]));
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

// ---------- scoring ----------

// Opponent rank 1..30 for a prop (1 = allows the most). Returns null when we can't rank cleanly.
function opponentRank(allowed, oppTeamId, prop) {
  if (!allowed || !allowed[oppTeamId]) return null;
  const totals = Object.entries(allowed).map(([teamId, row]) => [Number(teamId), prop.allowed.reduce((sum, field) => sum + (row[field] || 0), 0)]);
  if (totals.some(([, value]) => !Number.isFinite(value))) return null;
  totals.sort((a, b) => b[1] - a[1]);
  const index = totals.findIndex(([teamId]) => teamId === oppTeamId);
  return index < 0 ? null : { rank: index + 1, of: totals.length, perGame: totals[index][1] };
}

// Everything the scorer needs about one player-prop, worked out once and used for both sides.
function describe(prop, line, ctx) {
  const { current, previous } = ctx.logs;
  const played = [...current, ...previous].filter(playedInGame);          // newest first, both seasons
  if (played.length < CONFIG.minGamesTotal) return null;

  const valueOf = (log) => statOf(log, prop.keys);
  const l10 = played.slice(0, CONFIG.l10.games).map(valueOf);
  const currentPlayed = current.filter(playedInGame);
  const seasonLogs = currentPlayed.length >= CONFIG.season.minGames ? currentPlayed : (previous.filter(playedInGame).length ? previous.filter(playedInGame) : currentPlayed);
  const season = seasonLogs.map(valueOf);
  const l5Minutes = average(played.slice(0, CONFIG.minutes.recentGames).map(minutesOf));
  const seasonMinutes = average(seasonLogs.map(minutesOf));

  // Back-to-back split for the "why": games played the day after the player's previous game vs the rest (same season logs).
  const dayMs = 24 * 60 * 60 * 1000;
  const b2bValues = [];
  const restValues = [];
  seasonLogs.forEach((log, index) => {
    const previous = seasonLogs[index + 1]; // newest first: the game before
    const gap = previous ? (Date.parse(log.game.date) - Date.parse(previous.game.date)) / dayMs : null;
    (gap === 1 ? b2bValues : restValues).push(valueOf(log));
  });
  const b2bSplit = b2bValues.length >= CONFIG.why.b2bMinGames && restValues.length >= 5
    ? { games: b2bValues.length, b2bAvg: average(b2bValues), restAvg: average(restValues) } : null;

  const run = (values, side) => values.filter((v) => (side === "over" ? v > line : v < line)).length;
  return {
    l10, season, l10Avg: average(l10), l5Minutes, seasonMinutes, b2bSplit,
    seasonLabel: seasonLogs === currentPlayed ? "this season" : "last season",
    count: (side) => ({ l10: run(l10, side), season: run(season, side) }),
  };
}

function scoreSide(side, prop, line, info, ctx) {
  const sign = side === "over" ? 1 : -1;
  const factors = [];
  const add = (key, label, points, detail = {}) => factors.push({ key, label, points: round1(points), ...detail });

  const hits = info.count(side);
  const l10Rate = info.l10.length ? hits.l10 / info.l10.length : 0.5;
  add("l10", "Last 10 games", (l10Rate - 0.5) * CONFIG.l10.weight, { hits: hits.l10, games: info.l10.length });

  const seasonRate = info.season.length ? hits.season / info.season.length : 0.5;
  add("season", "Season hit rate", (seasonRate - 0.5) * CONFIG.season.weight, { hits: hits.season, games: info.season.length, which: info.seasonLabel });

  const gapPct = ((info.l10Avg - line) / line) * 100 * sign;               // positive = the average favors this side
  add("line", "Line vs recent average", clamp(gapPct * CONFIG.lineVsAvg.weight, -CONFIG.lineVsAvg.cap, CONFIG.lineVsAvg.cap), { average: round1(info.l10Avg), line });

  if (ctx.opponent) {                                                       // skipped when the API gives no ranking
    const { rank, of } = ctx.opponent;
    const forOver = CONFIG.opponent.best + ((CONFIG.opponent.worst - CONFIG.opponent.best) * (rank - 1)) / (of - 1);
    add("opponent", "Opponent", forOver * sign, { rank, of, perGame: round1(ctx.opponent.perGame) });
  }

  if (info.l5Minutes !== null && info.seasonMinutes !== null) {
    const raw = clamp((info.l5Minutes - info.seasonMinutes) * CONFIG.minutes.weight, -CONFIG.minutes.cap, CONFIG.minutes.cap);
    add("minutes", "Minutes trend", side === "under" && CONFIG.flipMinutesForUnder ? -raw : raw, { l5: round1(info.l5Minutes), season: round1(info.seasonMinutes) });
  }

  if (ctx.backToBack) {
    add("b2b", "Back-to-back", side === "under" && CONFIG.flipBackToBackForUnder ? -CONFIG.backToBack : CONFIG.backToBack);
  }

  const total = factors.reduce((sum, f) => sum + f.points, 0);
  return { score: Math.round(clamp(CONFIG.base + total, CONFIG.min, CONFIG.max)), factors, hits, sign };
}

// ---------- the "why": three sentences from templates, every number real ----------
// 1) recent form (L10 record + average, minutes when they moved), 2) the matchup (opponent rank, pace when it is extreme),
// 3) the biggest risk, weighed against the biggest plus. Sentences name the player by last name, never "the player" or a pronoun.

function pick(options, playerId) { return options[playerId % options.length]; }

const FACTOR_WORD = { l10: "the recent form", season: "the season rate", line: "the line", opponent: "the matchup", minutes: "the minutes trend" };

function writeWhy(side, prop, line, info, scored, ctx) {
  const id = ctx.playerId;
  const over = side === "over";
  const f = Object.fromEntries(scored.factors.map((factor) => [factor.key, factor]));
  const nGames = info.l10.length;
  const last = ctx.lastName;
  const opp = ctx.oppLabel;
  const avg = round1(info.l10Avg);

  // 1) recent form
  const record = over ? `cleared ${line}` : `stayed under ${line}`;
  let s1 = pick([
    `${last} has ${record} in ${f.l10.hits} of the last ${nGames} games, averaging ${avg} over that stretch`,
    `${last} has ${record} in ${f.l10.hits} of the last ${nGames} games, with an average of ${avg} in that span`,
  ], id);
  const minutes = f.minutes && Math.abs(f.minutes.l5 - f.minutes.season) >= CONFIG.why.minutesMention ? f.minutes : null;
  if (minutes) s1 += `, and ${last}'s minutes are ${minutes.l5 > minutes.season ? "up" : "down"} to ${minutes.l5} a game over the last 5 (${minutes.season} on the season)`;
  s1 += ".";

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
  const pace = ctx.oppPace;
  if (pace && (pace.rank <= CONFIG.why.paceTop || pace.rank > pace.of - CONFIG.why.paceTop)) {
    const fast = pace.rank <= CONFIG.why.paceTop;
    const helps = fast === over;
    s2 += ` and plays at ${fast ? `a top ${CONFIG.why.paceTop} pace` : `one of the ${CONFIG.why.paceTop} slowest paces`} in the league, so ${fast ? "extra" : "fewer"} possessions ${helps ? "should help" : "work against this pick"}`;
  }
  s2 += ".";

  // 3) the biggest risk, weighed against the biggest plus
  const positives = scored.factors.filter((factor) => factor.points >= 1).sort((a, b) => b.points - a.points);
  const negatives = scored.factors.filter((factor) => factor.points <= -1).sort((a, b) => a.points - b.points);
  const best = positives[0];
  const worst = negatives[0];
  let risk;
  if (worst && worst.key === "b2b") {
    const split = info.b2bSplit;
    const cost = split ? round1(split.restAvg - split.b2bAvg) : 0;
    risk = split && cost >= CONFIG.why.b2bMinDiff
      ? `The one concern is a back-to-back, which has cost ${last} about ${cost} ${prop.word} a game (${split.games} games, ${info.seasonLabel})`
      : "The one concern is the second night of a back-to-back";
  } else if (worst && worst.key === "opponent") {
    risk = `The one concern is the matchup: ${opp} ranks ${ordinal(worst.rank)} of ${worst.of} in ${prop.word} allowed`;
  } else if (worst && worst.key === "minutes") {
    risk = `The one concern is playing time: ${worst.l5} minutes a game over the last 5, against ${worst.season} on the season`;
  } else if (worst && worst.key === "l10") {
    risk = `The one concern is recent form: only ${worst.hits} of the last ${worst.games} games ${over ? "went over" : "stayed under"}`;
  } else if (worst && worst.key === "season") {
    risk = `The one concern is the bigger picture: ${worst.hits} of ${worst.games} games ${over ? "cleared" : "stayed under"} this line (${worst.which})`;
  } else if (worst && worst.key === "line") {
    risk = `The one concern is the line itself: ${line} sits ${round1(Math.abs(worst.average - line))} ${over ? "above" : "below"} the recent average of ${worst.average}`;
  }
  let s3;
  if (risk) {
    s3 = best && best.points > Math.abs(worst.points)
      ? `${risk}, but it isn't enough to outweigh ${FACTOR_WORD[best.key] || "the rest"}.`
      : `${risk}, and it outweighs what is in ${last}'s favor.`;
  } else if (f.season && f.season.games) {
    s3 = `No real red flags: ${f.season.hits} of ${f.season.games} games ${over ? "cleared" : "stayed under"} this line (${f.season.which}).`;
  } else {
    s3 = `No real red flags: the line of ${line} sits ${round1(Math.abs(info.l10Avg - line))} ${info.l10Avg > line ? "below" : "above"} the recent average.`;
  }
  return [s1, s2, s3];
}

// ---------- the handler ----------

function reply(statusCode, body, headers = {}) {
  return { statusCode, headers: { "Content-Type": "application/json; charset=utf-8", ...headers }, body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return reply(405, { error: "Only GET is allowed." }, { "Cache-Control": "no-store" });
  if (!process.env.BALLDONTLIE_API_KEY) return reply(500, { error: "BALLDONTLIE_API_KEY is not set on the server." }, { "Cache-Control": "no-store" });

  const todayET = etDate();
  const date = (event.queryStringParameters && event.queryStringParameters.date) || todayET;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return reply(400, { error: "date must look like 2026-10-20." }, { "Cache-Control": "no-store" });

  const cacheHeaders = { "Cache-Control": "public, s-maxage=600", "Netlify-CDN-Cache-Control": "public, s-maxage=600, stale-while-revalidate=600" };
  const empty = { date, updatedAt: new Date().toISOString(), props: [], topHunts: [] };
  if (date > todayET) return reply(200, empty, cacheHeaders); // future dates: an empty list

  try {
    const games = await loadSlate(date);
    if (!games.length) return reply(200, empty, cacheHeaders);

    const gameById = Object.fromEntries(games.map((game) => [game.id, game]));
    const lines = await loadLines(games);
    if (!lines.length) return reply(200, empty, cacheHeaders);

    const season = seasonOf(date);
    const playerIds = [...new Set(lines.map((line) => line.player_id))];
    const teamIds = [...new Set(games.flatMap((game) => [game.home_team.id, game.visitor_team.id]))];

    const [players, currentLogs, yesterday, injuries] = await Promise.all([
      loadPlayers(playerIds),
      loadLogs(playerIds, season),
      bdlAllPages(`/v1/games?start_date=${addDays(date, -1)}&end_date=${addDays(date, -1)}&per_page=100`).catch(() => []),
      loadInjuries(teamIds),
    ]);
    const needLastSeason = playerIds.filter((id) => currentLogs[id].filter(playedInGame).length < CONFIG.season.minGames);
    const [previousLogs, allowedNow, paceNow] = await Promise.all([
      needLastSeason.length ? loadLogs(needLastSeason, season - 1) : {},
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

      const logs = { current: currentLogs[entry.player_id] || [], previous: (previousLogs[entry.player_id]) || [] };
      const info = describe(prop, line, { logs });
      if (!info) return; // fewer than 5 games in total

      const ctx = {
        playerId: entry.player_id,
        opponent: opponentRank(allowed, oppTeam.id, prop),
        backToBack: playedYesterday.has(teamId),
        oppLabel: teamLabel(oppTeam),
        oppPace: pace ? pace[oppTeam.id] || null : null,
        lastName: player.last_name,
      };
      const status = injuries[entry.player_id] || null;
      ["over", "under"].forEach((side) => {
        const scored = scoreSide(side, prop, line, info, ctx);
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
          factors: scored.factors, // key, label, points + the numbers behind each one (hits / games, average, rank ...) for the Hunt Score page
          why: writeWhy(side, prop, line, info, scored, ctx),
          injured: Boolean(status && CONFIG.injuredStatuses.test(status)),   // Out / Doubtful / Questionable / Day-To-Day
          gtd: Boolean(status && CONFIG.injuredStatuses.test(status) && CONFIG.gtdStatuses.test(status) && !/out|doubt/i.test(status)),
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

    return reply(200, { date, updatedAt: new Date().toISOString(), props: out, topHunts }, cacheHeaders);
  } catch (error) {
    return reply(502, { error: String(error.message || error) }, { "Cache-Control": "no-store" });
  }
};
