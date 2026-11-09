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
//                    (a player traded during last season: only last season's games with his current team, once he has 10)
//   minutes          the same blend on minutes played
//   opponent / pace  multipliers using half the gap between tonight's opponent and the league average
//   zone matchup     PTS / 3PM / PRA only: the player's shots per game in each zone x (the FG% tonight's opponent allows there - the
//                    league's), worth 2 or 3 points a make, as a share of his usual output; half of it, capped at 6% (CONFIG.sim.zone)
//   role             tonight's lineup: with rotation teammates (15+ min) Out / Doubtful, minutes and per-minute output lean on
//                    his past games without them, in proportion to how many there are (CONFIG.sim.role)
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
//                                                   + one page per 5 of those players to spot a trade last season (then that
//                                                   player's full last season, to keep his games with his current team)
//   /nba/v1/team_season_averages/general?type=opponent   points / rebounds / assists / threes each team ALLOWS per game
//   /nba/v1/team_season_averages/general?type=advanced   each team's pace
//   /nba/v1/season_averages/shooting?type=by_zone&player_ids[]=          each player's FGA per game by zone (this + last season)
//   /nba/v1/team_season_averages/shooting?type=by_zone_opponent          the FG% each team allows by zone (the league = all teams)
//   /v1/player_injuries                             Out / Doubtful / Questionable (+ the Out / Doubtful players' logs, this season
//                                                   and last season from Feb 1, for the role step)

const API_ORIGIN = "https://api.balldontlie.io";

// ============================ CONFIG: every weight lives here ============================
const CONFIG = {
  min: 0,
  max: 100,
  probToScore: 100,                            // score = 50 + (chance - 0.5) * 100, so the score is the chance: 65% -> 65
  sim: {
    runs: 2000,                                // simulated games per player + prop (both sides read the same runs)
    halfLife: 5,                               // recency weight halves every 5 games
    priorGames: 5,                             // the prior (last season, or this season's flat average) counts like 5 games
    priorUntilGames: 20,                       // last season is the prior until a player has this many games this season
    minPriorGames: 5,                          // a last season with fewer games is ignored
    opponentShrink: 0.5,                       // use half of the opponent's "allowed vs league" gap
    paceShrink: 0.5,                           // and half of the pace gap
    backToBack: 0.97,                          // second night of a back-to-back: 3% less of everything
    zone: { shrink: 0.5, cap: 0.06, minFga: 4, ownSeasonGames: 10 }, // zone matchup: half the gap, at most +/-6%, players with 4+ FGA
                                               // a game; this season's shot profile once a player has 10 games, else last season's
    minutesSd: { base: 4, min: 3, max: 8, gtd: 1.5, games: 15 }, // minutes noise: the player's own spread over 15 games, x1.5 if GTD
    rateCv: { base: 0.05, sample: 0.3, ref: 0.1, minGames: 1 },  // rate uncertainty = 0.05 + 0.3 / sqrt(games); baseline uses 0.1
    priorSampleGames: 10,                      // a full last season adds this many games to the sample above
    lastSeasonLogsFrom: "02-01",               // last season's game logs only from this day of its spring (L10, spreads); its
                                               // full-season rate and minutes come from one season-averages request instead
    market: { base: 0.2, thin: 0.3,            // pull the projection toward the book's line: 20%, up to 50% with few games this season
      // A big disagreement with the book usually means the book knows something the logs don't (a new starter, a role change):
      // past a 25% gap (the gap over the line, or over the stat's floor for tiny lines) the pull grows to 70% at a 50% gap,
      // and the rate uncertainty widens by up to 0.1.
      gapFree: 0.25, gapFull: 0.5, maxWeight: 0.7, gapCv: 0.1 },
    teamPrior: { minGames: 10 },               // traded during last season: the prior is last season's games with his current
                                               // team once there are 10 (his old team's role and numbers left out)
    // Role: tonight's lineup. Teammates listed Out / Doubtful who usually play 15+ minutes AND have played for the team this
    // season are "missing" (a player out all season is already in the numbers). The player's past regular-season games on this
    // team where at least half of those minutes were also missing are his role games, except his own short nights (under 80%
    // of his usual minutes: injury, a limit, a blowout, a rest night; teammates out should RAISE his minutes, so a game well
    // under his usual is not a lineup game; a late-season game where he played big minutes still counts). Newest count
    // most (weight halves every 10 role games), last season's count half. With 3+ role games, their minutes replace the form
    // minutes in proportion n / (n + 2) and their per-minute output the form rate in proportion n / (n + 6), n = total weight.
    // opponent defense against the player's POSITION (from box scores): what players at his position score against that team vs their own averages, relative to the team's overall number
    position: { off: true, shrink: 0.5, prior: 40, cap: 0.05, minMinutes: 10, minGames: 3 },
    // teammates who are BACK tonight: healthy rotation players who missed 2+ of this player's recent games; his full-lineup games lead the form
    back: { off: true, minAbsent: 2, minFull: 3, minutesPrior: 2, ratePrior: 6, halfLife: 10, shortNight: 0.8, floor: 0.35, minWeight: 0.1, ref: { pts: 14, reb: 6, ast: 4, "3pm": 2, pra: 22 } },
    role: { minMinutes: 15, minMatch: 0.5, minGames: 3, minGamesSamePos: 2, halfLife: 10, lastSeason: 0.5, minutesPrior: 2, ratePrior: 6, shortNight: 0.8,
      // the lineup then vs tonight: other rotation teammates (usually 15+ minutes, from the slate's own game logs) who sat in a
      // role game besides tonight's missing ones. A game where 1 more was out counts half, 2 or more not at all (late-season
      // tank games with everyone resting are not tonight's lineup: Fears' 36 / 36 / 40-point April games)
      extraKeep: [1, 0.5, 0],
      // a missing teammate plays HIS position (Sengun out, Capela the next center): his minutes going up is close to certain,
      // so the role games' minutes are trusted like n / (n + 0.5) instead of n / (n + 2)
      samePosMinutesPrior: 0.5,
      // How much the missing teammates matter: their production of THIS stat per game (points for a points prop, rebounds for a
      // rebounds prop, ...) against a reference. A role player (Santos, 7.2 points) barely moves a star's numbers; a starter does.
      // importance = (production - floor x ref) / (ref - floor x ref), 0 to 1; both Role weights are multiplied by it, and under
      // minWeight there is no Role step at all.
      importance: { floor: 0.35, minWeight: 0.1, ref: { pts: 14, reb: 6, ast: 4, "3pm": 2, pra: 22 } },
      // The player's rate in his role games is compared with his rate in his OTHER games on the team (lift = role rate / other
      // rate), not with the form that already contains the role games, and the lift is applied to the form, scaled by the weights.
      minOther: 3, liftCap: [0.5, 2],
      // "old" = the first Role step (every missing player counts the same); "importance" = the same blend with both weights
      // multiplied by how much the missing players matter; "lift" = importance plus the lift over his other games
      mode: "importance" },
    disagree: { games: 3, free: 0.15, weight: 0.4, cap: 0.12 },  // last 3 games' rate off the projection by more than 15% widens it
    kMin: 3,                                   // game-to-game noise (negative binomial k), estimated from the logs
    kMax: 200,
    minutesClamp: [4, 46],
  },
  l10Games: 10,                                // the record quoted in the first "why" sentence
  minGamesTotal: 5,                            // fewer games than this (this + last season) = prop skipped
  topHunts: { max: 5, minScore: 65 },
  // The nightly "top five" (js: topFive in the answer): the five best-scoring sides after the filters below. Fewer than five when fewer
  // qualify: it never pads the list. Ranked by score, never by edge (edge has not predicted results: dev/hunt-under-check.js).
  topFive: {
    max: 5, minScore: 60,
    perGame: 2, perStat: 2,                    // spread the picks: at most 2 from one game and 2 of the same stat
    // skip a side whose chance is more than this many points above the book's fair chance: on the first six graded nights, candidates
    // within 10 won 60.7% (84) and those further out 47.6% (82), the biggest gaps about 38%. Chosen AFTER seeing those nights, so it is
    // unproven: check it on the nights since Nov 9 (dev/hunt-topfive-record.js) before trusting it.
    maxGap: 10,
    minOdds: -250,                             // skip prices shorter than this (-810 pays almost nothing and one miss erases many wins)
    minGames: 8,                               // games this season behind the numbers (the spread factor's `games`)
    // shown with every pick; update from dev/hunt-calibrate.js when the numbers change
    note: "A score is the model's own chance, and it has run high: through Nov 7, scores of 65 and up won about 57% of the time, not 65%. This is research, not advice.",
  },
  why: { paceTop: 5, b2bMinGames: 3, b2bMinDiff: 0.5, minutesMention: 2, smallSample: 8 },
  retries: 3,                                  // tries after a 429 / 5xx / dropped connection (dev scripts raise it)
  debug: false,                                // dev/hunt-whatif.js only: role games and past results at the line in the answer
  cacheMinutes: 10,                            // a warm function reuses its answer for a date this long (the CDN does the same)

  injuredStatuses: /out|doubt|question|day/i,  // Out, Doubtful, Questionable (the API calls Questionable "Day-To-Day")
  gtdStatuses: /question|day/i,                // the "game-time decision" ones: still scored, tagged GTD, never a top hunt
  preferredBook: "draftkings",
  concurrency: 10,                             // requests in flight at once
  playersPerLogRequest: 5,                     // same grouping the site uses for game logs
};

// The props we score. propType -> { code, stat key in a game log, opponent "allowed" fields }
const PROPS = {
  points: { code: "pts", keys: ["pts"], allowed: ["opp_pts"], word: "points", gapFloor: 8 },
  rebounds: { code: "reb", keys: ["reb"], allowed: ["opp_reb"], word: "rebounds", gapFloor: 4 },
  assists: { code: "ast", keys: ["ast"], allowed: ["opp_ast"], word: "assists", gapFloor: 3 },
  threes: { code: "3pm", keys: ["fg3m"], allowed: ["opp_fg3m"], word: "threes", gapFloor: 2 },
  points_rebounds_assists: { code: "pra", keys: ["pts", "reb", "ast"], allowed: ["opp_pts", "opp_reb", "opp_ast"], word: "points, rebounds and assists", gapFloor: 12 },
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

// A data request that failed for good (after its retries) is skipped so one bad request doesn't take the whole slate down, but it
// is counted: the answer says `partial` (and is not cached) when any were skipped, instead of quietly scoring without that data.
let skipped = [];
const noteSkipped = (error) => { skipped.push(String((error && error.message) || error).slice(0, 120)); };

async function bdl(pathAndQuery, attempt = 0) {
  let response;
  try {
    response = await fetch(`${API_ORIGIN}${pathAndQuery}`, { headers: { Authorization: process.env.BALLDONTLIE_API_KEY } });
  } catch (error) { // a dropped connection: retry (a failed logs request would otherwise quietly score a player without his data)
    if (attempt < CONFIG.retries) { await sleep(500 * (attempt + 1)); return bdl(pathAndQuery, attempt + 1); }
    throw error;
  }
  if ((response.status === 429 || response.status >= 500) && attempt < CONFIG.retries) { // too many requests / a server hiccup: wait a moment and retry
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

// dev/hunt-snapshot.js + dev/hunt-grade.js only (never set on the site): `record` collects what the engine downloaded that can't be
// fetched again later (the slate as it stood, every book's props, the injury report), `replay` feeds a saved copy back in.
const io = { record: null, replay: null };

async function loadSlate(date) {
  if (io.replay) return io.replay.games;
  const slate = await loadSlateLive(date);
  if (io.record) io.record.games = slate;
  return slate;
}

async function loadSlateLive(date) {
  const games = await bdlAllPages(`/v1/games?start_date=${date}&end_date=${date}&per_page=100`);
  const now = Date.now();
  // Not started: nothing played yet, not final, and the tip-off is still ahead.
  return games.filter((game) => {
    if (game.status === "Final" || (game.period && game.period > 0)) return false;
    const tip = Date.parse(game.datetime || "");
    return Number.isNaN(tip) ? true : tip > now;
  });
}

// One line per player per prop (DraftKings first), over/under markets only, and only markets with at least one price.
// Each line gets `priced` = which sides some book prices at that exact line; a side no book prices is never scored.
async function loadLines(games) {
  const lists = await pool(games.map((game) => async () => {
    if (io.replay) return io.replay.props[game.id] || [];
    try { return (await bdl(`/nba/v2/odds/player_props?game_id=${game.id}`)).data; } catch (error) { noteSkipped(error); return []; }
  }), CONFIG.concurrency);
  if (io.record) io.record.props = Object.fromEntries(games.map((game, i) => [game.id, lists[i]]));
  const hasPrice = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  const markets = lists.flat()
    .filter((prop) => prop.market && prop.market.type === "over_under" && PROPS[prop.prop_type])
    .filter((prop) => hasPrice(prop.market.over_odds) || hasPrice(prop.market.under_odds));
  const picked = {};
  markets.forEach((prop) => {
    const key = `${prop.player_id}-${prop.prop_type}`;
    if (!picked[key] || prop.vendor === CONFIG.preferredBook) picked[key] = prop;
  });
  return Object.values(picked).map((entry) => {
    const same = markets.filter((prop) => prop.player_id === entry.player_id && prop.prop_type === entry.prop_type
      && Number(prop.line_value) === Number(entry.line_value));
    // the price of each side at this line: the picked book's (DraftKings first), else the first book that prices it
    const price = (key) => {
      const own = hasPrice(entry.market[key]) ? entry : same.find((prop) => hasPrice(prop.market[key]));
      return own ? { odds: Number(own.market[key]), vendor: own.vendor } : null;
    };
    const prices = { over: price("over_odds"), under: price("under_odds") };
    // every book that prices each side at this line, for "best price" (the top five shows them)
    const books = { over: [], under: [] };
    [entry, ...same.filter((prop) => prop !== entry)].forEach((prop) => {
      ["over", "under"].forEach((side) => { if (hasPrice(prop.market[`${side}_odds`])) books[side].push({ vendor: prop.vendor, odds: Number(prop.market[`${side}_odds`]) }); });
    });
    return { ...entry, priced: { over: Boolean(prices.over), under: Boolean(prices.under) }, prices, books };
  });
}

async function loadPlayers(ids) {
  const players = {};
  const answers = await pool(chunk(ids, 100).map((group) => () => bdl(`/v1/players?per_page=100&${group.map((id) => `player_ids[]=${id}`).join("&")}`)), CONFIG.concurrency);
  answers.forEach((json) => json.data.forEach((player) => { players[player.id] = player; }));
  return players;
}

// { playerId: logs newest first } for one season, only games before `before` (a game in progress tonight never counts)
async function loadLogs(ids, season, before, from = null) {
  const logs = Object.fromEntries(ids.map((id) => [id, []]));
  const groups = chunk(ids, CONFIG.playersPerLogRequest);
  const answers = await pool(groups.map((group) => async () => {
    try { return await bdlAllPages(`/v1/stats?${group.map((id) => `player_ids[]=${id}`).join("&")}&seasons[]=${season}${from ? `&start_date=${from}` : ""}&per_page=100`); } catch (error) { noteSkipped(error); return []; }
  }), CONFIG.concurrency);
  answers.flat().forEach((log) => {
    if (logs[log.player.id] && String(log.game.date).slice(0, 10) < before) logs[log.player.id].push(log);
  });
  Object.values(logs).forEach((list) => list.sort((a, b) => b.game.date.localeCompare(a.game.date)));
  return logs;
}

// { playerId: last season's per-game numbers { gp, min, pts, reb, ast, fg3m } } from one request per 100 players
async function loadSeasonAverages(ids, season) {
  const result = {};
  const answers = await pool(chunk(ids, 100).map((group) => async () => {
    try {
      return await bdlAllPages(`/nba/v1/season_averages/general?season=${season}&season_type=regular&type=base&per_page=100&${group.map((id) => `player_ids[]=${id}`).join("&")}`);
    } catch (error) { noteSkipped(error); return []; }
  }), CONFIG.concurrency);
  answers.flat().forEach((row) => {
    const stats = row.stats || {};
    const min = typeof stats.min === "string" && stats.min.includes(":") ? minutesOf({ min: stats.min }) : Number(stats.min);
    if (row.player && Number(stats.gp) > 0 && min > 0) {
      result[row.player.id] = { gp: Number(stats.gp), min, pts: Number(stats.pts) || 0, reb: Number(stats.reb) || 0, ast: Number(stats.ast) || 0, fg3m: Number(stats.fg3m) || 0 };
    }
  });
  return result;
}

// Players traded during `season`: { playerId: { games: logs with his current team (newest first), other: "PHI" } }, only when
// he has CONFIG.sim.teamPrior.minGames of them. One page per 5 players spots a second team (any page order works: a traded
// player has many games with each team); only the traded players then get their full season, one paged request per 5.
async function loadTeamChanges(ids, season, before, players) {
  const current = (id) => players[id] && players[id].team && players[id].team.id;
  const pages = await pool(chunk(ids, CONFIG.playersPerLogRequest).map((group) => async () => {
    try { return (await bdl(`/v1/stats?${group.map((id) => `player_ids[]=${id}`).join("&")}&seasons[]=${season}&per_page=100`)).data; } catch (error) { noteSkipped(error); return []; }
  }), CONFIG.concurrency);
  const traded = [...new Set(pages.flat().filter((log) => log.team && current(log.player.id) && log.team.id !== current(log.player.id)).map((log) => log.player.id))];
  if (!traded.length) return {};
  const full = await loadLogs(traded, season, before);
  const result = {};
  traded.forEach((id) => {
    const games = full[id].filter((log) => log.team && log.team.id === current(id) && playedInGame(log));
    if (games.length < CONFIG.sim.teamPrior.minGames) return; // a summer move, or too few games with the new team: no change
    const other = [...new Set(full[id].filter((log) => log.team && log.team.id !== current(id)).map((log) => log.team.abbreviation).filter(Boolean))];
    result[id] = { games, team: players[id].team.abbreviation, other: other.join(" / ") };
  });
  return result;
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
    noteSkipped(error);
    return null;
  }
}

// ---------- position defense (box scores) ----------
// { teamId: { all: {pts:{a,e,n}...}, G|F|C: {...} } }: for every player-game against a team (10+ min, player with 3+ earlier games), his stat
// and his own average before that game. a / e = actual / expected sums, so a / e = how much more (or less) than usual players score against them.
async function loadPositionDefense(season, before) {
  const P = CONFIG.sim.position;
  if (P.off) return null;
  try {
    const rows = (await bdlAllPages(`/v1/stats?seasons[]=${season}&start_date=${season}-10-01&end_date=${before}&per_page=100`))
      .filter((r) => r.player && r.team && r.game && !r.game.postseason && String(r.game.date).slice(0, 10) < before && minutesOf(r) > 0);
    const byPlayer = {};
    rows.forEach((r) => { (byPlayer[r.player.id] = byPlayer[r.player.id] || []).push(r); });
    const out = {};
    const keys = ["pts", "reb", "ast", "fg3m"];
    Object.values(byPlayer).forEach((list) => {
      list.sort((a, b) => a.game.date.localeCompare(b.game.date));
      const group = posGroup(list[0].player.position)[0] || null;
      list.forEach((r, i) => {
        if (i < P.minGames || minutesOf(r) < P.minMinutes) return;
        const earlier = list.slice(0, i);
        const oppId = r.game.home_team_id === r.team.id ? r.game.visitor_team_id : r.game.home_team_id;
        const team = (out[oppId] = out[oppId] || {});
        [(team.all = team.all || {}), group ? (team[group] = team[group] || {}) : null].filter(Boolean).forEach((bucket) => {
          keys.forEach((key) => {
            const cell = (bucket[key] = bucket[key] || { a: 0, e: 0, n: 0 });
            cell.a += r[key] || 0; cell.e += average(earlier.map((x) => x[key] || 0)); cell.n++;
          });
        });
      });
    });
    return out;
  } catch (error) {
    noteSkipped(error);
    return null;
  }
}

// multiplier for one prop: the position's ratio against the team's overall ratio, shrunk by the sample and capped
function positionInfo(defense, oppTeamId, group, prop) {
  const P = CONFIG.sim.position;
  const team = defense && defense[oppTeamId];
  const letter = (group || "")[0];
  if (!team || !letter || !team[letter]) return null;
  const ratio = (bucket) => {
    const a = sum(prop.keys.map((k) => (bucket[k] || {}).a || 0));
    const e = sum(prop.keys.map((k) => (bucket[k] || {}).e || 0));
    return e > 0 ? a / e : null;
  };
  const pos = ratio(team[letter]);
  const all = ratio(team.all);
  if (!pos || !all) return null;
  const n = (team[letter][prop.keys[0]] || {}).n || 0;
  const rel = pos / all;
  const mult = clamp(1 + P.shrink * (n / (n + P.prior)) * (rel - 1), 1 - P.cap, 1 + P.cap);
  return { mult, rel, n, group: letter };
}

// ---------- zones (the zone matchup step) ----------
// Five zones; the player's left and right corner 3s are added together because the opponent numbers combine them.
const ZONES = [
  { key: "ra", label: "at the rim", points: 2, player: ["restricted_area"], opp: "restricted_area" },
  { key: "paint", label: "in the paint", points: 2, player: ["in_the_paint_(non-ra)"], opp: "in_the_paint_(non-ra)" },
  { key: "mid", label: "from mid-range", points: 2, player: ["mid-range"], opp: "mid-range" },
  { key: "c3", label: "from the corners", points: 3, player: ["left_corner_3", "right_corner_3"], opp: "corner_3" },
  { key: "atb", label: "above the break", points: 3, player: ["above_the_break_3"], opp: "above_the_break_3" },
];

// { playerId: { ra: fga per game, paint, mid, c3, atb } } for one season, from one request per 100 players.
async function loadPlayerZones(ids, season) {
  const result = {};
  const answers = await pool(chunk(ids, 100).map((group) => async () => {
    try {
      return await bdlAllPages(`/nba/v1/season_averages/shooting?season=${season}&season_type=regular&type=by_zone&per_page=100&${group.map((id) => `player_ids[]=${id}`).join("&")}`);
    } catch (error) { noteSkipped(error); return []; }
  }), CONFIG.concurrency);
  answers.flat().forEach((row) => {
    if (!row.player || !row.stats) return;
    const zones = {};
    ZONES.forEach((zone) => { zones[zone.key] = sum(zone.player.map((field) => Number(row.stats[`${field}_fga`]) || 0)); });
    if (sum(Object.values(zones)) > 0) result[row.player.id] = zones;
  });
  return result;
}

// { teams: { teamId: { ra: fg% allowed, ... } }, league: { ra: fg%, ... }, ranks: { teamId: { ra: 1..30 (1 = allows the highest) } } }
// or null when the season has no data. The league = every team's makes allowed / attempts allowed (attempt-weighted).
async function loadZoneDefense(season) {
  try {
    const rows = await bdlAllPages(`/nba/v1/team_season_averages/shooting?season=${season}&season_type=regular&type=by_zone_opponent&per_page=100`);
    if (!rows.length) return null;
    const teams = {};
    const league = {};
    ZONES.forEach((zone) => {
      let made = 0;
      let tried = 0;
      rows.forEach((row) => {
        const fga = Number(row.stats[`${zone.opp}_opp_fga`]) || 0;
        const fgm = Number(row.stats[`${zone.opp}_opp_fgm`]) || 0;
        made += fgm;
        tried += fga;
        teams[row.team.id] = teams[row.team.id] || {};
        teams[row.team.id][zone.key] = fga > 0 ? fgm / fga : null;
      });
      league[zone.key] = tried > 0 ? made / tried : null;
    });
    return { teams, league };
  } catch (error) {
    noteSkipped(error);
    return null;
  }
}

// The zone matchup for one player + prop tonight, or null (rebounds / assists, no shot data, too few shots, no opponent data).
// points = the extra points a game his shot diet would score against this defense vs a league-average one (threes: extra makes);
// mult is applied to the projection (half of points / his usual output, capped).
function zoneInfo(prop, zones, defense, oppTeamId, perGame) {
  if (!["pts", "3pm", "pra"].includes(prop.code) || !zones || !defense || !defense.teams[oppTeamId] || !(perGame > 0)) return null;
  const Z = CONFIG.sim.zone;
  const threesOnly = prop.code === "3pm";
  const used = ZONES.filter((zone) => !threesOnly || zone.points === 3);
  if (sum(ZONES.map((zone) => zones[zone.key] || 0)) < Z.minFga) return null;
  const pieces = used.map((zone) => {
    const opp = defense.teams[oppTeamId][zone.key];
    const lg = defense.league[zone.key];
    if (opp === null || lg === null || opp === undefined || lg === undefined) return { zone, value: 0 };
    const madeMore = (zones[zone.key] || 0) * (opp - lg);
    return { zone, value: threesOnly ? madeMore : madeMore * zone.points, gapPct: (opp - lg) * 100 };
  });
  const points = sum(pieces.map((piece) => piece.value));
  const mult = 1 + clamp((Z.shrink * points) / perGame, -Z.cap, Z.cap);
  const biggest = [...pieces].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
  return { mult, points: round1(points), zone: biggest && biggest.value ? biggest.zone.label : null, gap: biggest && biggest.gapPct !== undefined ? round1(biggest.gapPct) : null };
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
    noteSkipped(error);
    return null;
  }
}

// { status: { playerId: "Out" }, rows: the injury report rows (player with team_id, status) } for the slate's teams
async function loadInjuries(teamIds) {
  try {
    const rows = io.replay ? io.replay.injuries : await bdlAllPages(`/v1/player_injuries?${teamIds.map((id) => `team_ids[]=${id}`).join("&")}&per_page=100`);
    if (io.record) io.record.injuries = rows;
    const status = {};
    rows.forEach((row) => { if (row.player) status[row.player.id] = row.status || "Out"; });
    return { status, rows: rows.filter((row) => row.player) };
  } catch (error) {
    noteSkipped(error);
    return { status: {}, rows: [] };
  }
}

// ---------- role (tonight's lineup) ----------

// { teamId: [{ last, minutes, seasons: Set, played: Set of game ids }] }: each team's players listed Out / Doubtful tonight who
// usually play CONFIG.sim.role.minMinutes+ (this season once they have 3 games, else last season from Feb 1). A missing player
// counts in this season (he is on the team now) and in last season when he played 5+ games for the team then.
async function loadMissing(injuryRows, teamIds, season, before) {
  const out = injuryRows.filter((row) => /out|doubt/i.test(row.status || "Out") && teamIds.includes(row.player.team_id));
  if (!out.length) return {};
  const ids = [...new Set(out.map((row) => row.player.id))];
  const [now, last] = await Promise.all([
    loadLogs(ids, season, before),
    loadLogs(ids, season - 1, before, `${season}-${CONFIG.sim.lastSeasonLogsFrom}`),
  ]);
  const byTeam = {};
  out.forEach((row) => {
    const teamId = row.player.team_id;
    const mine = (list) => (list[row.player.id] || []).filter((log) => log.team && log.team.id === teamId && playedInGame(log));
    const thisSeason = mine(now);
    const lastSeason = mine(last);
    if (!thisSeason.length) return; // out all season: his absence is already in everyone's numbers
    const usual = average((thisSeason.length >= 3 ? thisSeason : [...thisSeason, ...lastSeason]).map(minutesOf));
    if (!(usual >= CONFIG.sim.role.minMinutes)) return;
    const basis = thisSeason.length >= 3 ? thisSeason : [...thisSeason, ...lastSeason]; // his per-game production, for how much he matters
    const perGame = (key) => average(basis.map((log) => log[key] || 0)) || 0;
    (byTeam[teamId] = byTeam[teamId] || []).push({
      id: row.player.id, last: row.player.last_name, minutes: usual, group: posGroup(row.player.position),
      prod: { pts: perGame("pts"), reb: perGame("reb"), ast: perGame("ast"), fg3m: perGame("fg3m") },
      seasons: new Set([season, ...(lastSeason.length >= 5 ? [season - 1] : [])]),
      played: new Set([...thisSeason, ...lastSeason].map((log) => log.game.id)),
    });
  });
  return byTeam;
}

// The positions a player is listed at, as letters: "F-C" -> "FC", "G" -> "G" (two players share a position when any letter matches:
// Sengun "F-C" out, Capela "C" next in line)
const posGroup = (position) => String(position || "").toUpperCase().replace(/[^GFC]/g, "");
const sharesPosition = (a, b) => Boolean(a) && Boolean(b) && [...a].some((letter) => b.includes(letter));

// The player's role games for tonight's lineup -> { minutes, rate, n, games, out } or null (nobody missing, or no such games).
// { teamId: [{ id, last, minutes, seasons, played }] }: each team's rotation (players of the slate with 15+ usual minutes for the
// team), from the logs the engine already downloaded; a player counts in a season when he played 5+ games for the team then
// (this season: any game), so a player who joined or left is not "absent" in games from before.
function buildRotation(playerIds, players, currentLogs, previousLogs, season) {
  const byTeam = {};
  playerIds.forEach((id) => {
    const player = players[id];
    const teamId = player && player.team && player.team.id;
    if (!teamId) return;
    const mine = (logs) => (logs || []).filter((log) => log.team && log.team.id === teamId && playedInGame(log) && !log.game.postseason);
    const now = mine(currentLogs[id]);
    const last = mine(previousLogs[id]);
    const usual = average([...now, ...last].map(minutesOf));
    if (!(usual >= CONFIG.sim.role.minMinutes)) return;
    (byTeam[teamId] = byTeam[teamId] || []).push({
      id, last: player.last_name, minutes: usual,
      prod: { pts: average((now.length ? now : last).map((log) => log.pts || 0)) || 0, reb: average((now.length ? now : last).map((log) => log.reb || 0)) || 0, ast: average((now.length ? now : last).map((log) => log.ast || 0)) || 0, fg3m: average((now.length ? now : last).map((log) => log.fg3m || 0)) || 0 },
      seasons: new Set([...(now.length ? [season] : []), ...(last.length >= 5 ? [season - 1] : [])]),
      played: new Set([...now, ...last].map((log) => log.game.id)),
    });
  });
  return byTeam;
}

// Teammates who are BACK tonight -> { minutes, rate, n, importance, ... } or null. A "returner" is a healthy rotation teammate who missed
// 2+ of this player's own games this season; the player's games WITH every returner are his full-lineup numbers, which lead the form
// when recent games were played without them (Maxey with Embiid and Edgecombe out vs back).
function backInfo(prop, logs, teamId, missing, season, rotation, ownId, usualFormGames) {
  const B = CONFIG.sim.back;
  if (B.off) return null;
  const own = logs.current.filter((log) => log.team && log.team.id === teamId && playedInGame(log) && !log.game.postseason)
    .sort((a, b) => b.game.date.localeCompare(a.game.date));
  if (own.length < B.minFull + B.minAbsent) return null;
  const usual = average(own.map(minutesOf));
  const missingIds = new Set((missing || []).map((m) => m.id));
  const returners = rotation.filter((r) => r.id !== ownId && !missingIds.has(r.id) && r.seasons.has(season)
    && own.filter((log) => !r.played.has(log.game.id)).length >= B.minAbsent);
  if (!returners.length) return null;
  const full = [];
  let absentGames = 0;
  own.forEach((log, i) => {
    if (minutesOf(log) < B.shortNight * usual) return;
    const away = returners.filter((r) => !r.played.has(log.game.id));
    if (away.length) { if (i < 10) absentGames++; return; }
    full.push({ w: Math.pow(0.5, i / B.halfLife), v: statOf(log, prop.keys), m: minutesOf(log) });
  });
  if (full.length < B.minFull || !absentGames) return null;
  const production = sum(returners.map((r) => sum(prop.keys.map((key) => r.prod[key] || 0))));
  const ref = B.ref[prop.code];
  const importance = clamp((production - B.floor * ref) / (ref - B.floor * ref), 0, 1);
  if (importance < B.minWeight) return null;
  const n = sum(full.map((g) => g.w));
  const minutesTotal = sum(full.map((g) => g.w * g.m));
  return {
    minutes: minutesTotal / n, rate: minutesTotal > 0 ? sum(full.map((g) => g.w * g.v)) / minutesTotal : 0,
    n, games: full.length, absentGames, importance, back: returners.map((r) => r.last).join(", "),
    minutesWeight: n / (n + B.minutesPrior), rateWeight: n / (n + B.ratePrior),
  };
}

function roleInfo(prop, logs, teamId, missing, season, group, rotation = [], ownId = null) {
  if (!missing || !missing.length) return null;
  const R = CONFIG.sim.role;
  const own = [...logs.current, ...logs.previous].filter((log) => log.team && log.team.id === teamId && playedInGame(log) && !log.game.postseason)
    .sort((a, b) => b.game.date.localeCompare(a.game.date));
  if (!own.length) return null;
  const usual = average(own.map(minutesOf));
  const games = [];
  const skipped = []; // CONFIG.debug: games without tonight's missing players that did not count, and why
  own.forEach((log) => {
    if (minutesOf(log) < R.shortNight * usual) {
      if (CONFIG.debug) {
        const counted = missing.filter((m) => m.seasons.has(log.game.season));
        const without = counted.filter((m) => !m.played.has(log.game.id)).map((m) => m.last);
        if (without.length) skipped.push({ log, without, why: `short night (${round1(minutesOf(log))} of his usual ${round1(usual)} min)` });
      }
      return;
    }
    const counted = missing.filter((m) => m.seasons.has(log.game.season));
    const total = sum(counted.map((m) => m.minutes));
    if (!total) return;
    const match = sum(counted.filter((m) => !m.played.has(log.game.id)).map((m) => m.minutes)) / total;
    if (match < R.minMatch) return;
    // other rotation teammates absent that night (the player himself and tonight's missing players do not count)
    const missingIds = new Set(missing.map((m) => m.id));
    const extras = rotation.filter((r) => r.id !== ownId && !missingIds.has(r.id) && r.seasons.has(log.game.season) && !r.played.has(log.game.id));
    const keep = R.extraKeep[Math.min(extras.length, R.extraKeep.length - 1)];
    const without = counted.filter((m) => !m.played.has(log.game.id)).map((m) => m.last);
    if (!keep) {
      if (CONFIG.debug) skipped.push({ log, without, why: `lineup differs (${extras.length} others out: ${extras.map((r) => r.last).join(", ")})` });
      return;
    }
    const weight = match * keep * Math.pow(0.5, games.length / R.halfLife) * (log.game.season === season ? 1 : R.lastSeason);
    games.push({ weight, v: statOf(log, prop.keys), m: minutesOf(log), log, without, extras: extras.map((r) => r.last) });
  });
  // how much the missing teammates matter for this stat (production per game, against a reference for the stat)
  const imp = R.importance;
  const production = sum(missing.map((m) => sum(prop.keys.map((key) => m.prod[key] || 0))));
  const ref = imp.ref[prop.code];
  const importance = clamp((production - imp.floor * ref) / (ref - imp.floor * ref), 0, 1);
  const samePosMissing = missing.some((m) => sharesPosition(m.group, group));
  const minGames = samePosMissing ? R.minGamesSamePos : R.minGames; // a missing teammate at his position: 2 matching games are enough
  if (games.length < minGames) {
    if (!CONFIG.debug) return null;
    const row = (g, why) => ({ date: g.log.game.date.slice(0, 10), lastSeason: g.log.game.season !== season, min: round1(minutesOf(g.log)), v: statOf(g.log, prop.keys), without: g.without, why });
    return { miss: {
      out: missing.map((m) => m.last).join(", "),
      reason: `${games.length} role ${games.length === 1 ? "game" : "games"}, ${minGames} needed`,
      games: [...games.map((g) => row(g, "counted")), ...skipped.map((g) => row(g, g.why))].sort((a, b) => b.date.localeCompare(a.date)),
      loadedFrom: `last season's logs from ${season}-${CONFIG.sim.lastSeasonLogsFrom} on`,
    } };
  }
  if (R.mode !== "old" && importance < imp.minWeight) {
    if (!CONFIG.debug) return null;
    return { miss: { out: missing.map((m) => m.last).join(", "), reason: `the missing players produce little ${prop.word} (${round1(production)} a game, weight ${Math.round(importance * 100)}%)`, games: [], loadedFrom: "" } };
  }
  const n = sum(games.map((g) => g.weight));
  const minutesTotal = sum(games.map((g) => g.weight * g.m));
  // his rate in the games that are NOT role games (recency weighted, last season half)
  const roleLogs = new Set(games.map((g) => g.log));
  const others = own.filter((log) => !roleLogs.has(log) && minutesOf(log) >= R.shortNight * usual)
    .map((log, i) => ({ w: Math.pow(0.5, i / CONFIG.sim.halfLife) * (log.game.season === season ? 1 : R.lastSeason), v: statOf(log, prop.keys), m: minutesOf(log) }));
  const otherMinutes = sum(others.map((o) => o.w * o.m));
  const otherRate = others.length >= R.minOther && otherMinutes > 0 ? sum(others.map((o) => o.w * o.v)) / otherMinutes : null;
  const samePos = samePosMissing;
  const minutesPrior = samePos ? R.samePosMinutesPrior : R.minutesPrior;
  return {
    minutes: minutesTotal / n,
    rate: minutesTotal > 0 ? sum(games.map((g) => g.weight * g.v)) / minutesTotal : 0,
    n, games: games.length, out: missing.map((m) => m.last).join(", "),
    minutesWeight: n / (n + minutesPrior), rateWeight: n / (n + R.ratePrior), samePos, importance, otherRate, production,
    // the role games themselves, for dev/hunt-whatif.js only (CONFIG.debug)
    list: CONFIG.debug ? games.map((g) => ({
      date: g.log.game.date.slice(0, 10), lastSeason: g.log.game.season !== season, min: round1(g.m), v: g.v, without: g.without, extras: g.extras,
      oppId: g.log.game.home_team_id === teamId ? g.log.game.visitor_team_id : g.log.game.home_team_id,
    })) : undefined,
  };
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
  const avg = ctx.lastSeasonAvg;                                   // last season's per-game numbers (season averages)
  const prevGames = avg ? avg.gp : prev.length;
  const usePrev = cur.length < S.priorUntilGames && prevGames >= S.minPriorGames;
  const fromAverages = usePrev && avg && avg.min > 0 ? { rate: statOf(avg, prop.keys) / avg.min, minutes: avg.min } : null;
  // a player traded during last season: only his games with his current team (his old role left out)
  const teamGames = usePrev && ctx.teamPrior ? ctx.teamPrior.games.map(toGame) : null;
  const prior = usePrev ? (teamGames && rateAndMinutes(teamGames, false)) || fromAverages || rateAndMinutes(prev, false) : rateAndMinutes(cur, false);
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
    cur, prev, usePrev, share, k, marketWeight: S.market.base + (S.market.thin * S.priorGames) / (S.priorGames + cur.length),
    baseRate, baseMinutes, formRate, formMinutes, minutesSd, rateCv, disagreeCv,
    lastAvg: last.length === S.disagree.games ? average(last.map((g) => g.v)) : null,
    l10, l10Avg: average(l10),
    seasonAvg: cur.length >= 10 || !prev.length ? average(cur.map((g) => g.v)) : teamGames ? average(teamGames.map((g) => g.v)) : (fromAverages ? statOf(avg, prop.keys) : average(prev.map((g) => g.v))),
    seasonLabel: cur.length >= 10 || !prev.length ? "this season" : teamGames ? `last season with ${ctx.teamPrior.team}` : "last season",
    teamPrior: teamGames ? { team: ctx.teamPrior.team, games: teamGames.length, other: ctx.teamPrior.other } : null,
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

// The average of the simulated games' expected values (no count noise): the projection's mean, cheaply.
function expectedMean(runs, input) {
  const [lo, hi] = CONFIG.sim.minutesClamp;
  let total = 0;
  runs.forEach((run) => {
    const minutes = clamp(input.minutes + input.minutesSd * run.zm, lo, hi);
    total += input.rate * Math.exp(input.rateCv * run.zr - (input.rateCv * input.rateCv) / 2) * minutes * input.mult * run.g;
  });
  return total / runs.length;
}

// American odds -> the chance they imply ("−300" -> 75%, "+240" -> 29%)
const impliedChance = (odds) => (odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100));
// The book's fair chance of each side: both sides' implied chances scaled to add up to 100% (the book's cut taken out). With
// one side priced, its implied chance minus half a typical cut (4.5% in all).
function fairChances(prices) {
  const o = prices.over ? impliedChance(prices.over.odds) : null;
  const u = prices.under ? impliedChance(prices.under.odds) : null;
  if (o !== null && u !== null) return { over: o / (o + u), under: u / (o + u) };
  return { over: o !== null ? o - 0.0225 : null, under: u !== null ? u - 0.0225 : null };
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
  if (ctx.role) {
    const r = ctx.role;
    const R = CONFIG.sim.role;
    // minutes: lean on the role games in proportion to how many there are AND how much the missing players matter
    const imp = R.mode === "old" ? 1 : r.importance;
    const minutesW = r.minutesWeight * imp;
    const minutes = minutesW * r.minutes + (1 - minutesW) * input.minutes;
    // rate: blend toward his role-game rate with the same two weights; mode "lift": the lift of his role games over his other
    // games applied to the form instead
    const base = r.otherRate > 0 ? r.otherRate : input.rate;
    const lift = base > 0 ? clamp(r.rate / base, R.liftCap[0], R.liftCap[1]) : 1;
    const rate = R.mode === "lift" ? input.rate * (1 + (lift - 1) * r.rateWeight * imp) : input.rate + (r.rate - input.rate) * r.rateWeight * imp;
    step("role", "Role", { minutes, rate }, { out: r.out, games: r.games, from: round1(input.minutes), minutes: round1(minutes), samePos: r.samePos, weight: Math.round(r.importance * 100), lift: round1(lift * 100) / 100, ...(r.list ? { list: r.list, roleMinutes: round1(r.minutes), roleRate36: round1(r.rate * 36), otherRate36: r.otherRate === null ? null : round1(r.otherRate * 36), from36: round1(input.rate * 36), rate36: round1(rate * 36) } : {}) });
  }
  if (ctx.back) {
    const b = ctx.back;
    const minutesW = b.minutesWeight * b.importance;
    const rateW = b.rateWeight * b.importance;
    const from = input.minutes;
    step("back", "Teammates back", { minutes: minutesW * b.minutes + (1 - minutesW) * input.minutes, rate: input.rate + (b.rate - input.rate) * rateW },
      { back: b.back, games: b.games, absent: b.absentGames, from: round1(from), weight: Math.round(b.importance * 100) });
  }
  if (ctx.opponent) step("opponent", "Matchup", { mult: input.mult * ctx.opponent.mult }, { rank: ctx.opponent.rank, of: ctx.opponent.of, perGame: round1(ctx.opponent.perGame) });
  if (ctx.position) step("position", "Position matchup", { mult: input.mult * ctx.position.mult }, { group: ctx.position.group, rel: Math.round(ctx.position.rel * 1000) / 1000, games: ctx.position.n });
  if (ctx.zone) step("zone", "Zone matchup", { mult: input.mult * ctx.zone.mult }, { extra: ctx.zone.points, zone: ctx.zone.zone, gap: ctx.zone.gap });
  if (ctx.pace) step("pace", "Pace", { mult: input.mult * ctx.pace.mult }, { rank: ctx.pace.rank, of: ctx.pace.of, pace: ctx.pace.pace });
  if (ctx.backToBack) step("b2b", "Back-to-back", { mult: input.mult * S.backToBack });
  // dev what-if steps only: a multiplier, or `set` = new input values (minutes, rate)
  (ctx.extra || []).forEach((e) => step(e.key, e.label, e.set || { mult: input.mult * e.mult }, e.detail || {}));
  // The book's line carries information the logs don't (a new role, a rotation change): pull the projection part of the way there.
  const simMean = expectedMean(runs, input);
  let gapCv = 0;
  if (simMean > 0) {
    // how far apart we are (relative to the line, or the stat's floor for tiny lines) decides how much the line is trusted
    const M = S.market;
    const gap = Math.abs(simMean - line) / Math.max(line, prop.gapFloor || 0);
    const big = clamp((gap - M.gapFree) / (M.gapFull - M.gapFree), 0, 1);
    const weight = info.marketWeight + (Math.max(M.maxWeight, info.marketWeight) - info.marketWeight) * big;
    gapCv = M.gapCv * big;
    const target = (1 - weight) * simMean + weight * line;
    step("market", "Book line", { mult: (input.mult * target) / simMean }, { line, sim: round1(simMean), weight: Math.round(weight * 100), gap: Math.round(gap * 100) });
  }
  step("spread", "Uncertainty", { minutesSd: info.minutesSd, rateCv: info.rateCv + gapCv }, {
    games: info.cur.length, lastSeason: info.usePrev, disagree: info.disagreeCv > 0, gtd: Boolean(ctx.gtd), bookGap: gapCv > 0,
  });

  const projection = simulate(runs, input, line, true);
  return { base, steps, projection, input, runs }; // input + runs: the top five re-asks the same simulation at other lines
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

const FACTOR_WORD = { role: "the bigger role", zone: "the zone matchup", market: "the book line", base: "the season numbers", minutes: "the minutes", form: "the recent form", opponent: "the matchup", pace: "the pace", spread: "the steady numbers" };

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
  } else if (worst && worst.key === "zone") {
    // extra > 0 = the defense leaks where he shoots (a risk for the under), < 0 = it is stingy there (a risk for the over)
    const where = worst.zone ? `${last}'s shots ${worst.zone}` : `where ${last} shoots`;
    risk = worst.extra > 0
      ? `The biggest risk is the zone matchup: ${opp} gives up more than most teams on ${where}`
      : `The biggest risk is the zone matchup: ${opp} defends ${where} better than most teams`;
  } else if (worst && worst.key === "pace") {
    risk = worst.rank > worst.of / 2
      ? `The biggest risk is the pace: ${opp} plays one of the slower games in the league (${ordinal(worst.rank)} of ${worst.of})`
      : `The biggest risk is the pace: ${opp} plays one of the faster games in the league (${ordinal(worst.rank)} of ${worst.of})`;
  } else if (worst && worst.key === "role") {
    risk = `The biggest risk is the lineup: with ${worst.out} out, ${last} projects to ${worst.minutes} minutes (${worst.from} before)`;
  } else if (worst && worst.key === "minutes") {
    risk = `The biggest risk is playing time: ${last}'s minutes project to ${worst.now}, against ${worst.base} on the season`;
  } else if (worst && worst.key === "form") {
    risk = worst.last !== null
      ? `The biggest risk is recent form: the last 3 games averaged ${worst.last}, ${over ? "below" : "above"} the season pace`
      : "The biggest risk is recent form";
  } else if (worst && worst.key === "market") {
    risk = `The biggest risk is that the book sees it differently: its line of ${line} sits ${worst.line > worst.sim ? "above" : "below"} the sim's ${worst.sim} before the line is factored in`;
  } else if (worst && worst.key === "spread") {
    if (worst.bookGap) risk = `The biggest risk is the gap to the book: a line this far from the sim usually means news the logs don't show yet (a new role, a lineup change)`;
    else if (worst.gtd) risk = `The biggest risk is availability: ${last} is a game-time decision (${ctx.injuryStatus}), so the minutes could swing`;
    else if (worst.games < CONFIG.why.smallSample) risk = `The biggest risk is a small sample: only ${worst.games} ${worst.games === 1 ? "game" : "games"} this season, so the range is wide`;
    else if (worst.disagree) risk = `The biggest risk is how much ${last}'s recent games swing (last 3 averaged ${round1(info.lastAvg)}), so the range is wide`;
    else risk = `The biggest risk is how much ${last}'s ${prop.word} swing from game to game`;
  } else if (worst && worst.key === "base") {
    risk = `The biggest risk is the line itself: ${last} ${info.seasonLabel.startsWith("last season") ? "averaged" : "averages"} ${round1(info.seasonAvg)} ${info.seasonLabel}, ${info.seasonAvg > line ? "over" : "under"} ${line}`;
  }
  let s3;
  if (risk) {
    s3 = best && best.points > Math.abs(worst.points)
      ? `${risk}, but it isn't enough to outweigh ${FACTOR_WORD[best.key] || "the rest"}.`
      : `${risk}, and it outweighs what is in ${last}'s favor.`;
  } else {
    s3 = `No real red flags: ${last} ${info.seasonLabel.startsWith("last season") ? "averaged" : "averages"} ${round1(info.seasonAvg)} ${info.seasonLabel} against a line of ${line}.`;
  }
  return [s1, s2, s3];
}

// ---------- the top five: selection + the written case ----------

// The five best-scoring sides after the filters in CONFIG.topFive: not injured, 8+ games behind the numbers, one per player, at most
// 2 per game and 2 per stat. Works on any list of scored sides (live ones, or the ones dev/hunt-snapshot.js saved), so the record of
// past top fives can be rebuilt from the snapshots. Fewer than five when fewer qualify.
const gamesBehind = (p) => { const spread = (p.factors || []).find((factor) => factor.key === "spread"); return spread && Number.isFinite(spread.games) ? spread.games : 0; };
function selectTopFive(sides) {
  const T = CONFIG.topFive;
  const ranked = sides.filter((p) => !p.injured && p.score >= T.minScore && gamesBehind(p) >= T.minGames && !(Number.isFinite(p.odds) && p.odds < T.minOdds) && !(Number.isFinite(p.edge) && p.edge > T.maxGap))
    .sort((a, b) => (b.score - a.score) || (b.chance - a.chance));
  const players = new Set();
  const perGame = {};
  const perStat = {};
  const picked = [];
  for (const p of ranked) {
    if (picked.length >= T.max) break;
    if (players.has(p.playerId) || (perGame[p.gameId] || 0) >= T.perGame || (perStat[p.stat] || 0) >= T.perStat) continue;
    players.add(p.playerId);
    perGame[p.gameId] = (perGame[p.gameId] || 0) + 1;
    perStat[p.stat] = (perStat[p.stat] || 0) + 1;
    picked.push(p);
  }
  return picked;
}

const VENDOR_NAMES = { draftkings: "DraftKings", fanduel: "FanDuel", betrivers: "BetRivers", caesars: "Caesars", betparx: "betPARX", ballybet: "Bally Bet", fanatics: "Fanatics", betmgm: "BetMGM", espnbet: "ESPN BET" };
const vendorName = (vendor) => VENDOR_NAMES[String(vendor).toLowerCase()] || String(vendor);
const americanText = (odds) => (odds > 0 ? `+${odds}` : `${odds}`);
// every book's price for a side, best payout first: [{ vendor, name, odds }]
function bookList(list) {
  return (list || []).slice().sort((a, b) => (b.odds > 0 ? b.odds : 10000 / -b.odds) - (a.odds > 0 ? a.odds : 10000 / -a.odds))
    .map((book) => ({ vendor: book.vendor, name: vendorName(book.vendor), odds: book.odds }));
}
const STAT_LABEL = { pts: "PTS", reb: "REB", ast: "AST", "3pm": "3PM", pra: "PRA" };

// The written case for one pick: what supports it, what could go wrong, what would change it. Every number comes from the engine's own
// inputs; sentences name the player by last name and never use a pronoun (same rule as `why`).
function buildAnalysis(item, d) {
  const { prop, line, info, ctx, sim, scored, books } = d;
  const over = item.side === "over";
  const sideWord = over ? "over" : "under";
  const word = prop.word;
  const last = ctx.lastName;
  const opp = ctx.oppLabel;
  const f = Object.fromEntries(scored.factors.map((factor) => [factor.key, factor]));
  const p = sim.projection;
  const input = sim.input;
  const hitsOf = (values) => values.filter((v) => (over ? v > line : v < line)).length;
  const cur = info.cur.map((g) => g.v);
  const season = { hit: hitsOf(cur), n: cur.length, avg: round1(average(cur)) };
  const l10 = { hit: hitsOf(info.l10), n: info.l10.length, avg: round1(info.l10Avg) };
  const label = `${STAT_LABEL[prop.code]}`;

  // ----- the case -----
  const caseFor = [];
  caseFor.push(`${last} has ${over ? "gone over" : "stayed under"} ${line} in ${l10.hit} of the last ${l10.n} games (averaging ${l10.avg}) and ${season.hit} of ${season.n} games this season (average ${season.avg}).`);
  caseFor.push(`The simulation projects ${p.mean} ${word} (most games ${p.p10} to ${p.p90}), a ${scored.chance}% chance of going ${sideWord}. The book's price implies about ${item.fair}%.`);
  const minutes = round1(input.minutes);
  if (f.role && Math.abs(f.role.minutes - f.role.from) >= 1) caseFor.push(`With ${f.role.out} out, ${last} projects to about ${f.role.minutes} minutes (${f.role.from} otherwise), based on ${f.role.games} past games without ${f.role.out}.`);
  else if (f.role) caseFor.push(`With ${f.role.out} out, ${last}'s role is adjusted using ${f.role.games} past games without ${f.role.out}; the minutes stay near ${minutes}.`);
  else caseFor.push(`${last} projects to about ${minutes} minutes${f.minutes && Math.abs(f.minutes.now - f.minutes.base) >= CONFIG.why.minutesMention ? `, ${f.minutes.now > f.minutes.base ? "up" : "down"} from ${f.minutes.base} on the season` : ""}.`);
  if (f.opponent) {
    const o = f.opponent;
    const extreme = o.rank <= 8 || o.rank > o.of - 8;
    const allowsMost = o.rank <= o.of / 2;
    caseFor.push(`${opp} ranks ${ordinal(o.rank)} of ${o.of} in ${word} allowed per game (${o.perGame}).${extreme ? (allowsMost === over ? " That helps this pick." : " That works against this pick.") : " That is close to the middle of the league, so it moves little."}`);
  }
  if (f.pace && (f.pace.rank <= CONFIG.why.paceTop || f.pace.rank > f.pace.of - CONFIG.why.paceTop)) {
    const fast = f.pace.rank <= CONFIG.why.paceTop;
    caseFor.push(`${opp} plays at ${fast ? "one of the fastest" : "one of the slowest"} paces in the league (${ordinal(f.pace.rank)} of ${f.pace.of}), which ${fast === over ? "helps" : "works against"} this pick.`);
  }
  if (f.zone && Math.abs(f.zone.points) >= 1) caseFor.push(`The shot-zone matchup ${f.zone.points > 0 ? "helps" : "hurts"} this pick by about ${Math.abs(f.zone.points)} points of score.`);
  if (books && books.length) {
    const sorted = bookList(books);
    caseFor.push(`Best price: ${sorted[0].name} ${americanText(sorted[0].odds)}${sorted.length > 1 ? ` (${sorted.slice(1, 4).map((b) => `${b.name} ${americanText(b.odds)}`).join(", ")})` : ""}.`);
  }

  // ----- what could go wrong -----
  const wrong = [];
  wrong.push(`This is not a lock: about ${100 - scored.chance}% of the simulated games went the other way.`);
  const perMinute = input.rate * input.mult;
  const needed = perMinute > 0 && !(prop.code === "3pm" && line < 2.5) && line >= 3.5 ? Math.round(line / perMinute) : null;
  const needsOk = needed && needed >= 8 && needed <= 46;
  const recentMinutes = info.cur.slice(0, 10).map((g) => g.m);
  if (needsOk && recentMinutes.length >= 5) {
    wrong.push(`Minutes are the main swing: at ${perMinute < 1 ? Math.round(perMinute * 100) / 100 : round1(perMinute)} ${word} a minute, ${last} needs about ${needed} minutes to reach ${line}. The last ${recentMinutes.length} games ranged from ${Math.round(Math.min(...recentMinutes))} to ${Math.round(Math.max(...recentMinutes))}.`);
  }
  if (line <= 2.5 && (prop.code === "3pm" || prop.code === "ast" || prop.code === "reb")) wrong.push(`On a line this small one or two ${prop.code === "3pm" ? "makes" : "plays"} decide it, so a single hot night can flip it.`);
  if (scored.chance - item.fair >= 10) wrong.push(`Our chance (${scored.chance}%) is well above what the book's price implies (${item.fair}%). So far a gap that big has not been a reliable sign: on the nights we have graded, the biggest gaps did not win more often.`);
  if (item.fair - scored.chance >= 3) wrong.push(`The book is more confident than the simulation: its price implies about ${item.fair}% against our ${scored.chance}%.`);
  if (Number.isFinite(item.odds) && item.odds <= -200) wrong.push(`At ${americanText(item.odds)} a win pays little and a miss costs a lot.`);
  if (ctx.gtd) wrong.push(`${last} is listed ${ctx.injuryStatus}. The pick assumes normal minutes if cleared.`);
  if (f.role && f.role.points >= 2) wrong.push(`Part of this rests on ${f.role.out} being out: without that boost the score would be about ${Math.round(item.score - f.role.points)}.`);
  if (info.cur.length < 15) wrong.push(`Only ${info.cur.length} games this season behind the numbers${info.usePrev ? ", so last season fills in part of the picture" : ""}.`);
  if (info.lastAvg !== null && p.mean >= 3 && Math.abs(info.lastAvg - p.mean) / p.mean > 0.15) wrong.push(`The last 3 games averaged ${round1(info.lastAvg)}, away from the projection of ${p.mean}.`);
  if (ctx.backToBack) {
    const cost = info.b2bSplit && info.b2bSplit.games >= 3 ? info.b2bSplit.restAvg - info.b2bSplit.b2bAvg : 0;
    wrong.push(`This is the second night of a back-to-back${cost >= CONFIG.why.b2bMinDiff ? `, which has cost ${last} about ${round1(cost)} ${word} a game` : ""}.`);
  }
  scored.factors.filter((factor) => factor.points <= -2 && ["opponent", "pace", "zone", "form", "minutes"].includes(factor.key) && !(factor.key === "opponent" && f.opponent && f.opponent.rank <= f.opponent.of / 2 !== over)).slice(0, 2)
    .forEach((factor) => wrong.push(`${FACTOR_WORD[factor.key].replace(/^./, (c) => c.toUpperCase())} works against this pick (${round1(factor.points)} points of score).`));
  if (minutes >= 24) wrong.push(over ? `A blowout can cut ${last}'s minutes in the fourth quarter.` : `A close game or overtime adds minutes and chances.`);

  // ----- what would change it -----
  const change = [];
  if (needsOk) change.push(over
    ? `If ${last} plays under about ${needed} minutes, the over is out of reach at this rate.`
    : `If ${last} plays well over about ${needed} minutes, the under is in danger; the line is reachable at this rate once the minutes pass ${needed}.`);
  const against = over ? line + 1 : line - 1;
  const toward = over ? line - 1 : line + 1;
  const chanceAt = (l) => Math.round(simulate(sim.runs, input, l, false)[item.side] * 100);
  const moves = [];
  if (against > 0) moves.push(`if the line moves a point against this pick (${against}), the chance drops to about ${chanceAt(against)}%`);
  if (toward > 0) moves.push(`a point in its favor (${toward}) lifts it to about ${chanceAt(toward)}%`);
  if (moves.length) change.push(`${moves.join("; ").replace(/^./, (c) => c.toUpperCase())}.`);
  if (f.role && f.role.points >= 2) change.push(`If ${f.role.out} is ruled in, the Role step goes away and the score falls to about ${Math.round(item.score - f.role.points)}.`);
  change.push("Late news (an injury, a rest day, a lineup change) is not in these numbers until the next refresh. Check the injury report near tip-off.");

  const nameLine = `${item.player} ${over ? "Over" : "Under"} ${line} ${label}`;
  return {
    headline: `${nameLine} ${item.home ? "vs" : "@"} ${item.opp}`,
    summary: `${scored.chance}% in the simulation; ${over ? "over" : "under"} in ${l10.hit} of the last ${l10.n} games.`,
    numbers: { score: item.score, chance: scored.chance, fair: item.fair, projection: p.mean, p10: p.p10, p90: p.p90, projectedMinutes: minutes, perMinute: round1(perMinute), minutesNeeded: needed },
    record: { last10: l10, season: { ...season, label: info.seasonLabel }, last3Avg: info.lastAvg === null ? null : round1(info.lastAvg) },
    case: caseFor,
    couldGoWrong: wrong,
    whatWouldChange: change,
  };
}

// ---------- the handler ----------

function reply(statusCode, body, headers = {}) {
  return { statusCode, headers: { "Content-Type": "application/json; charset=utf-8", ...headers }, body: JSON.stringify(body) };
}

let whatIf = null; // dev/hunt-whatif.js only: ({ playerId, stat, line, info }) -> extra steps [{ key, label, mult | set, detail }] or null
const warmCache = {}; // date -> { savedAt, body }: a warm function answers repeat calls (Hunt Score page + Top 5) without recomputing

async function computeHunts(date) {
  skipped = [];
  const empty = { date, updatedAt: new Date().toISOString(), props: [], topHunts: [], topFive: [] };
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
  // Shooting players' shot profiles: this season for players with enough games, last season for the rest.
  const ownZoneIds = playerIds.filter((id) => !needLastSeason.includes(id) || currentLogs[id].filter(playedInGame).length >= CONFIG.sim.zone.ownSeasonGames);
  const lastZoneIds = playerIds.filter((id) => !ownZoneIds.includes(id));
  const [previousLogs, lastSeasonAvgs, allowedNow, paceNow, zonesNow, zonesLast, zoneDefNow, teamChanges, missingByTeam, positionDefense] = await Promise.all([
    needLastSeason.length ? loadLogs(needLastSeason, season - 1, date, `${season}-${CONFIG.sim.lastSeasonLogsFrom}`) : {},
    needLastSeason.length ? loadSeasonAverages(needLastSeason, season - 1) : {},
    loadAllowed(season),
    loadPace(season),
    ownZoneIds.length ? loadPlayerZones(ownZoneIds, season) : {},
    lastZoneIds.length ? loadPlayerZones(lastZoneIds, season - 1) : {},
    loadZoneDefense(season),
    needLastSeason.length ? loadTeamChanges(needLastSeason, season - 1, date, players) : {},
    CONFIG.sim.role.off ? {} : loadMissing(injuries.rows, teamIds, season, date),
    loadPositionDefense(season, date),
  ]);
  const allowed = allowedNow || (await loadAllowed(season - 1)); // same fallback rule as the rest of the site
  const pace = paceNow || (await loadPace(season - 1));
  const zoneDefense = zoneDefNow || (await loadZoneDefense(season - 1));
  const playerZones = { ...zonesLast, ...zonesNow };

  const playedYesterday = new Set(yesterday.flatMap((game) => [game.home_team.id, game.visitor_team.id]));
  const rotationByTeam = buildRotation(playerIds, players, currentLogs, previousLogs, season);

  const out = [];
  const detailOf = new WeakMap(); // each scored side -> the numbers behind it (for the top five's write-up)
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

    const status = injuries.status[entry.player_id] || null;
    const injured = Boolean(status && CONFIG.injuredStatuses.test(status));
    const gtd = Boolean(injured && CONFIG.gtdStatuses.test(status) && !/out|doubt/i.test(status));
    const ctx = {
      playerId: entry.player_id,
      logs: { current: currentLogs[entry.player_id] || [], previous: previousLogs[entry.player_id] || [] },
      lastSeasonAvg: lastSeasonAvgs[entry.player_id] || null,
      teamPrior: teamChanges[entry.player_id] || null,
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
    ctx.zone = zoneInfo(prop, playerZones[entry.player_id], zoneDefense, oppTeam.id, info.baseRate * info.baseMinutes);
    const role = roleInfo(prop, ctx.logs, teamId, (missingByTeam[teamId] || []).filter((m) => m.id !== entry.player_id), season, posGroup(player.position), rotationByTeam[teamId] || [], entry.player_id);
    ctx.role = role && !role.miss ? role : null;
    ctx.roleMiss = role && role.miss ? role.miss : null; // CONFIG.debug only
    ctx.position = positionInfo(positionDefense, oppTeam.id, posGroup(player.position), prop);
    ctx.back = ctx.role ? null : backInfo(prop, ctx.logs, teamId, (missingByTeam[teamId] || []).filter((m) => m.id !== entry.player_id), season, rotationByTeam[teamId] || [], entry.player_id);
    ctx.extra = whatIf ? whatIf({ playerId: entry.player_id, stat: prop.code, line, info }) : null;

    const sim = runSteps(prop, line, info, ctx);
    const fair = fairChances(entry.prices);
    ["over", "under"].filter((side) => entry.priced[side]).forEach((side) => {
      const scored = scoreSide(side, sim);
      const item = {
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
        odds: entry.prices[side].odds, book: entry.prices[side].vendor, // the price of this side (American odds)
        fair: Math.round(fair[side] * 100),            // the book's fair chance of this side (its cut taken out), %
        edge: scored.chance - Math.round(fair[side] * 100), // our chance minus the book's: what the price leaves on the table
        projection: { mean: sim.projection.mean, p10: sim.projection.p10, p90: sim.projection.p90 },
        teamPrior: info.teamPrior,
        ...(ctx.roleMiss ? { roleMiss: ctx.roleMiss } : {}), // dev/hunt-whatif.js only: teammates out but no Role step, and why
        // dev/hunt-whatif.js only: how his past games (this season + last season's logs) finished against this line
        ...(CONFIG.debug ? { history: { over: [...info.cur, ...info.prev].filter((g) => g.v > line).length, under: [...info.cur, ...info.prev].filter((g) => g.v < line).length } } : {}),  // traded during last season: { team, games, other } = the prior used only his games with team
        factors: scored.factors, // key, label, points + the numbers behind each one, for the Hunt Score page
        why: writeWhy(side, prop, line, info, scored, sim, ctx),
        injured,                 // Out / Doubtful / Questionable / Day-To-Day
        gtd,
        injuryStatus: status,
        gameId: game.id,
        tipoff: game.datetime || null,
      };
      out.push(item);
      detailOf.set(item, { prop, line, info, ctx, sim, scored, entry, books: entry.books ? entry.books[side] : [], game });
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
  const chosen = selectTopFive(out);
  const topFive = chosen.map((item, i) => ({ rank: i + 1, ...item, books: bookList(detailOf.get(item).books), analysis: buildAnalysis(item, detailOf.get(item)) }));
  return { date, updatedAt: new Date().toISOString(), props: out, topHunts, topFive, topFiveNote: CONFIG.topFive.note, ...(skipped.length ? { partial: skipped.length, skipped: skipped.slice(0, 5) } : {}) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return reply(405, { error: "Only GET is allowed." }, { "Cache-Control": "no-store" });
  if (!process.env.BALLDONTLIE_API_KEY) return reply(500, { error: "BALLDONTLIE_API_KEY is not set on the server." }, { "Cache-Control": "no-store" });

  const todayET = etDate();
  const date = (event.queryStringParameters && event.queryStringParameters.date) || todayET;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return reply(400, { error: "date must look like 2026-10-20." }, { "Cache-Control": "no-store" });

  const cacheHeaders = { "Cache-Control": "public, s-maxage=600", "Netlify-CDN-Cache-Control": "public, s-maxage=600, stale-while-revalidate=600" };
  if (date > todayET) return reply(200, { date, updatedAt: new Date().toISOString(), props: [], topHunts: [], topFive: [] }, cacheHeaders); // future dates: an empty list

  const warm = warmCache[date];
  if (warm && Date.now() - warm.savedAt < CONFIG.cacheMinutes * 60 * 1000) return reply(200, warm.body, cacheHeaders);
  try {
    const body = await computeHunts(date);
    if (body.partial) return reply(200, body, { "Cache-Control": "no-store" }); // some data was skipped: never cached, the next request tries again
    warmCache[date] = { savedAt: Date.now(), body };
    return reply(200, body, cacheHeaders);
  } catch (error) {
    return reply(502, { error: String(error.message || error) }, { "Cache-Control": "no-store" });
  }
};

exports.CONFIG = CONFIG; // for dev/hunt-compare.js
exports.selectTopFive = selectTopFive; // for dev/hunt-topfive-record.js
// For dev/hunt-whatif.js: extra multiplier steps for one prop, run inside the real simulation. Never set on the site.
// For dev/hunt-snapshot.js and dev/hunt-grade.js: score a date while recording the inputs, or from saved inputs (no cache).
exports.computeWith = async (date, { record = false, replay = null } = {}) => {
  io.record = record ? {} : null;
  io.replay = replay;
  try {
    const body = await computeHunts(date);
    return { body, inputs: io.record };
  } finally {
    io.record = null;
    io.replay = null;
  }
};
exports.setWhatIf = (fn) => { whatIf = fn; Object.keys(warmCache).forEach((date) => delete warmCache[date]); };
