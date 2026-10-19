// LineHunter - js/top-hit-rates.js
// The "Top Hit Rates" card: the players who went over their line most often in their last 10 games.
//   - Homepage (index.html): the next slate of games (today, or the next day with games).
//   - Schedule page (schedule.html): the day picked in the date pager. app.js calls showTopHitRatesForDay().
//
// Uses the shared code in js/stats.js. Needs js/stats.js loaded first.

const TOP_WINDOW = 10;    // L10
const TOP_MIN_GAMES = 8;  // fewer games than this in the window = too small a sample to rank
const TOP_ROW_COUNT = 8;  // how many rows the card shows
const TOP_WINDOWS = [5, 10, 20];  // schedule page: the L5 / L10 / L20 toggle
const TOP_MIN_SAMPLE = 3;         // schedule page: fewer games than this in a window = no row (a real "3/4" still shows)
// Schedule page only: the compact card gets the new row layout, window toggle and sort. The homepage card stays as it was.
const TOP_NEW_LAYOUT = Boolean(document.querySelector("#top-hit-rates.lh-top-compact"));
const TOP_SORTS = [
  { code: "rate", label: "Hit rate" },
  { code: "streak", label: "Streak" },
  { code: "cushion", label: "Cushion" },
  { code: "game", label: "Game" },
];

// The filter pills. "all" mixes every prop; the others match PROP_CODES in js/stats.js.
const TOP_FILTERS = [
  { code: "all", label: "All" },
  { code: "pts", label: "PTS" },
  { code: "reb", label: "REB" },
  { code: "ast", label: "AST" },
  { code: "3pm", label: "3PM" },
  { code: "pra", label: "PRA" },
];

// sessionStorage = a small storage box in the browser that lasts until the tab is closed.
// We save the finished rows there, so coming back to the homepage within 10 minutes shows them
// instantly instead of downloading everything again.
// Each slate is saved under its own key, like "lh-top-hit-rates:2026-10-20".
// The homepage also saves under "lh-top-hit-rates:next", because it doesn't know the date until it asks.
const TOP_CACHE_PREFIX = "lh-top-hit-rates:";
const TOP_CACHE_MINUTES = 10;

let topSlate = null;       // { date: "2026-10-20", rows: [...] } once loaded
let topFilter = "all";     // which pill is selected
let topWindow = 10;        // which of L5 / L10 / L20 is selected (schedule page)
let topSort = "rate";      // which sort is selected (schedule page)
// Filters (schedule page). Nothing is saved: every visit starts from these defaults.
let topSide = "both";          // "over" | "under" | "both" (both = each line shows its stronger side)
let topGame = "all";           // "all" or one game id
let topHideInjured = true;     // hides players listed Out / Questionable (and similar) in the injury data
let topMinGames = 0;           // 0 = off, 5, 10
let topOpenPanel = null;       // "filter" | "sort" | null (desktop dropdown)
let topRequestNumber = 0;  // goes up with every load, so a slow old load can't overwrite a newer one

// ---------- Dates ----------

// The date on this computer, written like the API writes dates: "2026-10-16".
// (toISOString() would use London time, which can already be "tomorrow" in the evening.)
function localDateString(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function daysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

// "2026-10-20" -> "Tue, Oct 20", or "Today"
function slateDateLabel(isoDate) {
  if (isoDate === localDateString(new Date())) return "Today";
  // Noon, so the date can't slip to the day before in any time zone.
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

// ---------- Cache ----------

function readTopCache(key) {
  // try/catch: some browsers block storage (private windows, strict settings). Then we just download.
  try {
    const saved = JSON.parse(sessionStorage.getItem(TOP_CACHE_PREFIX + key));
    if (!saved) return null;

    const ageInMinutes = (Date.now() - saved.savedAt) / 60000;
    const sameDay = saved.today === localDateString(new Date()); // after midnight the slate may change
    if (ageInMinutes > TOP_CACHE_MINUTES || !sameDay) return null;
    // Saved before the Hit List existed (no "legs" yet)? Download again so the Hit List has its data.
    if (saved.slate && !saved.slate.noGames && !Array.isArray(saved.slate.legs)) return null;
    if (saved.slate && saved.slate.legs && saved.slate.legs.length && saved.slate.legs[0].vsN === undefined) return null; // older leg format
    if (saved.slate && Array.isArray(saved.slate.legs) && !Array.isArray(saved.slate.teamLegs)) return null; // saved before team totals
    if (saved.slate && Array.isArray(saved.slate.legs) && !Array.isArray(saved.slate.fan)) return null;       // saved before the fan cards
    // saved before the opponent id (BBQ Chicken) and the 30-point streaks (Chicken Nuggets)?
    if (saved.slate && saved.slate.fan && saved.slate.fan.length && (saved.slate.fan[0].oppId === undefined || saved.slate.fan[0].nuggets === undefined || saved.slate.fan[0].fg === undefined)) return null;

    // saved before the per-window numbers (L5 / L10 / L20)?
    if (saved.slate && Array.isArray(saved.slate.rows) && saved.slate.rows.length && (!saved.slate.rows[0].w || !saved.slate.rows[0].w[5].over)) return null;
    if (saved.slate && Array.isArray(saved.slate.rows) && saved.slate.injuries === undefined) return null; // saved before the injury filter

    return saved.slate;
  } catch (error) {
    return null;
  }
}

function writeTopCache(key, slate) {
  try {
    // sessionStorage only holds text, so JSON.stringify turns the object into text first.
    sessionStorage.setItem(TOP_CACHE_PREFIX + key, JSON.stringify({
      savedAt: Date.now(),
      today: localDateString(new Date()),
      slate,
    }));
  } catch (error) {
    // Storage full or blocked: not a problem, we'll just download again next time.
  }
}

// ---------- Loading ----------

// Today's games, or the first day in the next two weeks that has games.
async function findNextSlate() {
  const games = await bdlGetAllPages(
    `${BDL_BASE}/games?start_date=${localDateString(new Date())}&end_date=${localDateString(daysFromNow(14))}&per_page=100`
  );
  if (games.length === 0) return null;

  // "2026-10-20" style dates sort in date order, so the first one after sorting is the soonest.
  const firstDate = games.map((game) => game.date).sort()[0];
  return { date: firstDate, games: games.filter((game) => game.date === firstDate) };
}

// "vs DET" if the player's team is at home, "@ DET" if they're the visitors.
function matchupText(teamAbbreviation, game) {
  if (teamAbbreviation === game.home_team.abbreviation) return `vs ${game.visitor_team.abbreviation}`;
  if (teamAbbreviation === game.visitor_team.abbreviation) return `@ ${game.home_team.abbreviation}`;
  return `${game.visitor_team.abbreviation} @ ${game.home_team.abbreviation}`; // traded player, team not updated yet
}

// Highest hit rate first. Ties: more games first, then the bigger cushion over the line.
function compareTopRows(a, b) {
  if (a.hitRate !== b.hitRate) return b.hitRate - a.hitRate;
  if (a.totalGames !== b.totalGames) return b.totalGames - a.totalGames;
  return (b.average - b.line) - (a.average - a.line);
}

// Download everything for one day's games and work out every row.
// slate = { date: "2026-10-20", games: [...] }. Returns { date, rows } (rows is empty if no props yet).
async function buildTopHitRates(slate) {
  // 1. Every prop for those games. The API takes one game per request, so all games at once.
  const propLists = await Promise.all(slate.games.map((game) =>
    bdlGet(`${PROPS_URL}?game_id=${game.id}`)
      .then((json) => json.data)
      .catch(() => []) // one game failing shouldn't hide the others
  ));

  // 2. One line per player per prop, only the five props this card covers (Points, Rebounds, Assists, 3PM, P+R+A).
  const lines = pickOneLinePerPlayer(propLists.flat()).filter((prop) => propCode(prop.prop_type));
  if (lines.length === 0) return { date: slate.date, rows: [], legs: [], teamLegs: [], fan: [], injuries: {} };

  // 3. Names and game logs for every player, both at the same time.
  //    loadPlayerGameLogs asks for many players per request, and adds last season for anyone
  //    with fewer than 10 games this season (the 2026 -> 2025 fallback).
  const playerIds = [...new Set(lines.map((prop) => prop.player_id))];
  const teamIds = [...new Set(slate.games.flatMap((game) => [game.home_team.id, game.visitor_team.id]))];
  const [players, loaded, injuryList] = await Promise.all([
    fetchPlayers(playerIds),
    loadPlayerGameLogs(playerIds, Math.max(...TOP_WINDOWS)), // enough history for L20 (adds last season where needed)
    // The injury report for both teams of every game (one request). null if it failed: then nobody is hidden.
    bdlGetAllPages(`${BDL_BASE}/player_injuries?${teamIds.map((id) => `team_ids[]=${id}`).join("&")}&per_page=100`).catch(() => null),
  ]);
  // { playerId: "Out" } for everyone on the report
  const injuries = {};
  (injuryList || []).forEach((item) => {
    if (item.player) injuries[item.player.id] = item.status || "Out";
  });

  const gamesById = {};
  slate.games.forEach((game) => {
    gamesById[game.id] = game;
  });

  // 4. L10 hit rate for every line, against that player's own line.
  const rows = lines.map((prop) => {
    const line = Number(prop.line_value);
    const statKey = propStatKey(prop.prop_type);
    const logs = loaded.logsByPlayer[prop.player_id];
    const result = hitRateForWindow(logs, statKey, line, TOP_WINDOW, loaded.showingCurrentSeason);

    // Numbers for each window of the toggle, for both sides of the line.
    //   over: a game is a hit when the stat is above the line; under: below it (a push is neither).
    //   cushion = average margin past the line on that side (over: average - line, under: line - average).
    const w = {};
    TOP_WINDOWS.forEach((size) => {
      const part = hitRateForWindow(logs, statKey, line, size, loaded.showingCurrentSeason);
      const side = (name) => {
        let streak = 0;
        for (const game of part.games) { // newest first
          if (game.overUnder !== name) break;
          streak += 1;
        }
        const hits = part.games.filter((game) => game.overUnder === name).length;
        const margin = part.totalGames ? (name === "over" ? part.average - line : line - part.average) : null;
        return {
          hits, streak,
          hitRate: part.totalGames ? Math.round((hits / part.totalGames) * 1000) / 10 : null,
          cushion: margin === null ? null : Math.round(margin * 10) / 10,
        };
      };
      // For the under side the mini graph swaps the colors, so a colored bar always means "hit".
      const flipped = part.games.map((game) => ({ ...game, overUnder: game.overUnder === "over" ? "under" : game.overUnder === "under" ? "over" : game.overUnder }));
      w[size] = { totalGames: part.totalGames, games: part.games, underGames: flipped, over: side("over"), under: side("under") };
    });
    // Homepage: L10 with at least 8 games. Schedule page: any window with at least TOP_MIN_SAMPLE games.
    if (TOP_NEW_LAYOUT ? !TOP_WINDOWS.some((size) => w[size].totalGames >= TOP_MIN_SAMPLE) : result.totalGames < TOP_MIN_GAMES) return null;

    const player = players[prop.player_id];
    const team = player && player.team ? player.team.abbreviation : "";
    const game = gamesById[prop.game_id];
    return {
      gameId: prop.game_id,
      playerId: prop.player_id,
      name: player ? `${player.first_name} ${player.last_name}` : `Player #${prop.player_id}`,
      team,
      matchup: matchupText(team, game),
      tip: game ? (game.datetime || game.date) : "",
      gameLabel: game ? `${game.visitor_team.abbreviation} @ ${game.home_team.abbreviation}` : "",
      code: propCode(prop.prop_type),
      line,
      hits: result.hits,
      totalGames: result.totalGames,
      hitRate: result.hitRate,
      average: result.average,
      games: result.games, // for the mini graph
      w,
    };
  }).filter(Boolean); // drops the nulls (small samples)

  rows.sort(compareTopRows);

  // The Hit List (js/hit-list.js) reads the same downloaded logs: one "leg" per line, with the facts it needs.
  const legs = lines.map((prop) => {
    const player = players[prop.player_id];
    const team = player && player.team ? player.team.abbreviation : "";
    return buildHitListLeg(prop, loaded.logsByPlayer[prop.player_id], loaded.showingCurrentSeason, {
      name: player ? `${player.first_name} ${player.last_name}` : `Player #${prop.player_id}`,
      team,
      game: gamesById[prop.game_id],
    });
  }).filter(Boolean);

  return {
    date: slate.date, rows, injuries, legs, teamLegs: buildTeamLegs(slate, loaded.logsByPlayer),
    fan: buildFanPlayers(lines, players, loaded, gamesById), // for research mode's Hot Players and Streaks cards
  };
}

// Research mode's cards (js/fanCards.js) need no betting lines, only each player's recent box scores, so this reads
// the same game logs already downloaded for the rows above. One entry per player on the slate (players with a posted
// prop are the ones the page already has logs for):
//   st[code] = { l5, season, vals }  l5 / season = average of the last 5 games / the season (null if too few games),
//                                     vals = the last 10 values, newest first (for the mini graph)
//   streaks  = how many games in a row, from the latest, hit 20+ PTS, 10+ REB, 8+ AST, 3+ 3PM
const FAN_STATS = [
  { code: "pts", key: "pts" },
  { code: "reb", key: "reb" },
  { code: "ast", key: "ast" },
  { code: "3pm", key: "fg3m" },
  { code: "pra", key: "pts+reb+ast" },
];
const FAN_MIN_GAMES = 5; // L5 and season averages need at least 5 games

function buildFanPlayers(lines, players, loaded, gamesById) {
  // { l5Made, l5Att } or { seasonMade, seasonAtt }
  const fgTotals = (list, prefix) => ({
    [`${prefix}Made`]: list.reduce((total, log) => total + (log.fgm ?? 0), 0),
    [`${prefix}Att`]: list.reduce((total, log) => total + (log.fga ?? 0), 0),
  });
  const gameForPlayer = {};
  lines.forEach((prop) => { gameForPlayer[prop.player_id] = prop.game_id; });
  const average = (values) => (values.length >= FAN_MIN_GAMES ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const streakOf = (values, minimum) => {
    let count = 0;
    for (const value of values) {
      if (value < minimum) break;
      count += 1;
    }
    return count;
  };

  return Object.keys(gameForPlayer).map((id) => {
    const logs = loaded.logsByPlayer[id];
    const player = players[id];
    if (!logs || !player) return null;

    const games = pickWindowLogs(logs, Infinity, loaded.showingCurrentSeason);            // newest first
    const seasonGames = pickWindowLogs(logs, "season", loaded.showingCurrentSeason);
    if (games.length < FAN_MIN_GAMES) return null;

    const st = {};
    FAN_STATS.forEach((stat) => {
      const values = games.map((log) => statValue(log, stat.key));
      st[stat.code] = {
        l5: average(values.slice(0, 5)),
        season: average(seasonGames.map((log) => statValue(log, stat.key))),
        vals: values.slice(0, 10),
      };
    });
    const valuesOf = (key) => games.map((log) => statValue(log, key));
    const team = player.team ? player.team.abbreviation : "";
    const game = gamesById[gameForPlayer[id]];
    // Tonight's opponent (BBQ Chicken ranks that team's defense).
    let oppId = null;
    if (game && team === game.home_team.abbreviation) oppId = game.visitor_team.id;
    if (game && team === game.visitor_team.abbreviation) oppId = game.home_team.id;
    // Current run of 30+ point games, and the average points in those games (Chicken Nuggets).
    const pointValues = valuesOf("pts");
    const nuggetCount = streakOf(pointValues, 30);
    const nuggetAverage = nuggetCount ? pointValues.slice(0, nuggetCount).reduce((sum, value) => sum + value, 0) / nuggetCount : 0;
    return {
      playerId: Number(id),
      name: `${player.first_name} ${player.last_name}`,
      team,
      gameId: gameForPlayer[id],
      matchup: matchupText(team, game),
      oppId,
      st,
      nuggets: { count: nuggetCount, avg: nuggetAverage },
      // Field goals made / attempted over the last 5 games and over the season (Brick City compares the two percentages).
      fg: { ...fgTotals(games.slice(0, 5), "l5"), ...fgTotals(seasonGames, "season") },
      streaks: { pts: streakOf(valuesOf("pts"), 20), reb: streakOf(valuesOf("reb"), 10), ast: streakOf(valuesOf("ast"), 8), fg3m: streakOf(valuesOf("fg3m"), 3) },
    };
  }).filter(Boolean);
}

// Team totals for the Hit List's "Light It Up" card, worked out from the player logs we already downloaded
// (no extra requests). Every stat line says which team the player was on and the final score of that game,
// so putting the lines of a team's players together rebuilds the team's recent games.
const TEAM_FORM_MAX_GAMES = 5; // the "recent form" window
const TEAM_FORM_MIN_GAMES = 3; // fewer games than this = no pick for that team

function buildTeamLegs(slate, logsByPlayer) {
  const gamesByTeam = {}; // teamId -> { gameId: { date, points } }, one entry per game
  Object.values(logsByPlayer).forEach(({ current, previous }) => {
    [...current, ...previous].forEach((log) => {
      const points = log.team.id === log.game.home_team_id ? log.game.home_team_score : log.game.visitor_team_score;
      if (!points) return; // no final score
      gamesByTeam[log.team.id] = gamesByTeam[log.team.id] || {};
      gamesByTeam[log.team.id][log.game.id] = { date: log.game.date, points };
    });
  });

  const teamLegs = [];
  slate.games.forEach((game) => {
    [[game.home_team, game.visitor_team, "vs"], [game.visitor_team, game.home_team, "@"]].forEach(([team, opponent, prefix]) => {
      const recent = Object.values(gamesByTeam[team.id] || {})
        .sort((a, b) => b.date.localeCompare(a.date)) // newest first
        .slice(0, TEAM_FORM_MAX_GAMES);
      if (recent.length < TEAM_FORM_MIN_GAMES) return;

      // The mark they cleared every time: their lowest score in the window, rounded down to a multiple of 5.
      const lowest = Math.min(...recent.map((entry) => entry.points));
      teamLegs.push({
        gameId: game.id,
        teamId: team.id,
        // "Detroit", but the two LA teams need their names ("LA Clippers")
        label: team.city === "Los Angeles" ? `LA ${team.name}` : team.city,
        matchup: `${prefix} ${opponent.abbreviation}`,
        mark: Math.floor(lowest / 5) * 5,
        games: recent.length,
      });
    });
  });
  return teamLegs;
}

// The facts the Hit List needs about ONE line (a player's prop for tonight).
// Games are newest first, every game this player has in the downloaded seasons (this one, then last).
function buildHitListLeg(prop, logs, showingCurrentSeason, { name, team, game }) {
  const code = propCode(prop.prop_type);
  const line = Number(prop.line_value);
  const rows = calculateHitRate(pickWindowLogs(logs, Infinity, showingCurrentSeason), propStatKey(prop.prop_type), line, "all").games;
  if (rows.length < 5) return null; // under 5 games can't make any category

  const count = (list, side) => list.filter((row) => row.overUnder === side).length;
  // How many games in a row, from the newest, went this way ("over" or "under").
  const streak = (list, side) => {
    let length = 0;
    for (const row of list) {
      if (row.overUnder !== side) break;
      length += 1;
    }
    return length;
  };
  const odds = (value) => (value === undefined || value === null || value === "" || Number.isNaN(Number(value)) ? null : Number(value));

  // Home or away tonight? (null if the player's team isn't one of the two, like a just-traded player)
  let isHome = null;
  if (game && team === game.home_team.abbreviation) isHome = true;
  if (game && team === game.visitor_team.abbreviation) isHome = false;

  // Past games against tonight's opponent (up to the last 10), from the seasons we downloaded.
  let opponent = "";
  if (game && isHome !== null) opponent = isHome ? game.visitor_team.abbreviation : game.home_team.abbreviation;
  const versus = opponent ? rows.filter((row) => row.opponent === opponent).slice(0, 10) : [];

  const last5 = rows.slice(0, 5);
  const last10 = rows.slice(0, 10);
  const venue = isHome === null ? [] : rows.filter((row) => (row.homeAway === "home") === isHome).slice(0, 10);

  return {
    gameId: prop.game_id,
    playerId: prop.player_id,
    name,
    team,
    matchup: game ? matchupText(team, game) : "",
    isHome,
    code,
    line,
    overOdds: odds(prop.market.over_odds),
    underOdds: odds(prop.market.under_odds),
    n10: last10.length,
    over10: count(last10, "over"),
    under10: count(last10, "under"),
    over5: count(last5, "over"),
    under5: count(last5, "under"),
    overStreak: streak(rows, "over"),
    underStreak: streak(rows, "under"),
    venueN: venue.length,          // up to the last 10 games at tonight's venue (home or away)
    venueOvers: count(venue, "over"),
    vsN: versus.length,            // up to the last 10 games against tonight's opponent
    vsOvers: count(versus, "over"),
  };
}

// ---------- Drawing ----------

// "Top Hit Rates" in big white letters, with the date after it in blue.
function setTopTitle(isoDate) {
  const date = isoDate ? ` <span class="lh-top-title-date">· ${slateDateLabel(isoDate)}</span>` : "";
  document.getElementById("topHitRatesTitle").innerHTML = `Top Hit Rates${date}`;
  const hitListTitle = document.getElementById("hitlistTitle"); // the Hit List card shares the slate
  if (hitListTitle) hitListTitle.innerHTML = `Hit List${date}`;
  const hotTitle = document.getElementById("hotPlayersTitle");   // research mode's cards share it too
  if (hotTitle) hotTitle.innerHTML = `Hot Players${date}`;
  const streaksTitle = document.getElementById("streaksTitle");
  if (streaksTitle) streaksTitle.innerHTML = `Streaks${date}`;
}

// Grey placeholder rows while loading, shaped like the real rows.
function renderTopSkeleton() {
  const row = `
    <div class="lh-top-row placeholder-glow" aria-hidden="true">
      <div class="lh-top-player"><span class="placeholder col-7 rounded"></span><br><span class="placeholder col-4 rounded"></span></div>
      <div class="lh-top-prop"><span class="placeholder col-10 rounded"></span></div>
      <div class="lh-top-graph"><span class="placeholder col-12 rounded"></span></div>
      <div class="lh-top-hit"><span class="placeholder col-9 rounded"></span></div>
    </div>`;
  const list = document.getElementById("topHitRatesList");
  list.setAttribute("aria-busy", "true");
  list.innerHTML = row.repeat(5);
  if (typeof showHitListLoading === "function") showHitListLoading();
  if (typeof showFanLoading === "function") showFanLoading();
}

function renderTopMessage(html) {
  document.getElementById("topHitRatesPills").hidden = true;
  const controls = document.getElementById("topHitRatesControls");
  if (controls) controls.hidden = true;
  const chipBox = document.getElementById("topHitRatesChips");
  if (chipBox) chipBox.hidden = true;
  const list = document.getElementById("topHitRatesList");
  list.removeAttribute("aria-busy");
  list.innerHTML = `<div class="lh-top-message">${html}</div>`;
  if (typeof showHitListMessage === "function") showHitListMessage(html);
  if (typeof showFanMessage === "function") showFanMessage(html);
}

// ---------- Schedule page: controls (window, Filter, Sort), chips and the rows ----------

const TOP_SORT_LABELS = Object.fromEntries(TOP_SORTS.map((sort) => [sort.code, sort.label]));
const isPhone = () => window.matchMedia("(max-width: 575.98px)").matches;

// Hidden by "Hide injured": anyone on the report except players listed as probable / available.
function isInjuredOut(playerId) {
  const status = topSlate && topSlate.injuries ? topSlate.injuries[playerId] : null;
  return Boolean(status) && !/probable|available/i.test(status);
}

// The filter chips: [{ label, remove() }]
function activeTopChips() {
  const chips = [];
  if (topSide !== "both") chips.push({ label: topSide === "over" ? "Overs only" : "Unders only", remove: () => { topSide = "both"; } });
  if (topGame !== "all") {
    const match = topSlate.rows.find((row) => String(row.gameId) === String(topGame));
    chips.push({ label: match ? match.gameLabel : "One game", remove: () => { topGame = "all"; } });
  }
  if (topHideInjured) chips.push({ label: "Hiding injured", remove: () => { topHideInjured = false; } });
  if (topMinGames) chips.push({ label: `${topMinGames}+ games`, remove: () => { topMinGames = 0; } });
  return chips;
}

function renderTopChips() {
  const box = document.getElementById("topHitRatesChips");
  const chips = activeTopChips();
  box.hidden = chips.length === 0;
  box.innerHTML = chips.map((chip, index) => `<button type="button" class="lh-top-chip" data-chip="${index}" aria-label="Remove: ${chip.label}">${chip.label} <span aria-hidden="true">✕</span></button>`).join("")
    + (chips.length ? `<button type="button" class="lh-top-clear" data-clear>Clear all</button>` : "");
  box.querySelectorAll("[data-chip]").forEach((button) => button.addEventListener("click", () => {
    chips[Number(button.dataset.chip)].remove();
    refreshTopUi();
  }));
  const clear = box.querySelector("[data-clear]");
  if (clear) clear.addEventListener("click", () => {
    topSide = "both"; topGame = "all"; topHideInjured = false; topMinGames = 0;
    refreshTopUi();
  });
}

// Option buttons for the panels: [{ value, label }], with the active one marked.
function topOptions(name, options, active) {
  return `<div class="lh-top-opts" role="group">${options.map((option) =>
    `<button type="button" class="lh-top-opt${String(option.value) === String(active) ? " active" : ""}" data-set="${name}" data-value="${option.value}" aria-pressed="${String(option.value) === String(active)}">${option.label}</button>`).join("")}</div>`;
}

function topPanelHtml(kind) {
  if (kind === "sort") {
    return `<div class="lh-top-opts lh-top-opts--list">${TOP_SORTS.map((sort) =>
      `<button type="button" class="lh-top-opt${sort.code === topSort ? " active" : ""}" data-set="sort" data-value="${sort.code}">${sort.label}</button>`).join("")}</div>`;
  }
  const games = [];
  topSlate.rows.forEach((row) => {
    if (row.gameLabel && !games.some((game) => String(game.value) === String(row.gameId))) games.push({ value: row.gameId, label: row.gameLabel, tip: row.tip });
  });
  games.sort((a, b) => new Date(a.tip) - new Date(b.tip));
  return `
    <div class="lh-top-field"><span class="lh-label text-muted">Side</span>
      ${topOptions("side", [{ value: "over", label: "Over" }, { value: "under", label: "Under" }, { value: "both", label: "Both" }], topSide)}</div>
    <div class="lh-top-field"><span class="lh-label text-muted">Game</span>
      <select class="form-select form-select-sm" data-set="game" aria-label="Game">
        <option value="all">All games</option>
        ${games.map((game) => `<option value="${game.value}"${String(game.value) === String(topGame) ? " selected" : ""}>${game.label}</option>`).join("")}
      </select></div>
    <div class="lh-top-field"><label class="form-check form-switch mb-0">
      <input class="form-check-input" type="checkbox" role="switch" data-set="injured"${topHideInjured ? " checked" : ""}>
      <span class="form-check-label">Hide injured</span></label></div>
    <div class="lh-top-field"><span class="lh-label text-muted">Minimum games</span>
      ${topOptions("min", [{ value: 0, label: "Off" }, { value: 5, label: "5+" }, { value: 10, label: "10+" }], topMinGames)}</div>`;
}

// A change inside a panel (desktop dropdown or phone sheet).
function onTopPanelChange(element) {
  const value = element.type === "checkbox" ? element.checked : element.dataset.value ?? element.value;
  const name = element.dataset.set;
  if (name === "side") topSide = value;
  if (name === "game") topGame = value;
  if (name === "injured") topHideInjured = value;
  if (name === "min") topMinGames = Number(value);
  if (name === "sort") { topSort = value; closeTopPanel(); }
  refreshTopUi();
}

function fillTopPanel(host, kind) {
  host.innerHTML = topPanelHtml(kind);
  host.querySelectorAll("button[data-set]").forEach((button) => button.addEventListener("click", () => onTopPanelChange(button)));
  host.querySelectorAll("select[data-set], input[data-set]").forEach((input) => input.addEventListener("change", () => onTopPanelChange(input)));
}

// Closes the open dropdown (desktop) or bottom sheet (phones).
function closeTopPanel() {
  topOpenPanel = null;
  document.querySelectorAll("#topHitRatesControls [data-bs-toggle='dropdown']").forEach((toggle) => bootstrap.Dropdown.getInstance(toggle)?.hide());
  const sheet = document.getElementById("topHitRatesSheet");
  if (sheet) bootstrap.Offcanvas.getInstance(sheet)?.hide();
}

// Phones: the same panel content in a bottom sheet.
function openTopSheet(kind) {
  let sheet = document.getElementById("topHitRatesSheet");
  if (!sheet) {
    sheet = document.createElement("div");
    sheet.id = "topHitRatesSheet";
    sheet.className = "offcanvas offcanvas-bottom lh-sheet";
    sheet.tabIndex = -1;
    sheet.innerHTML = `<div class="offcanvas-header"><h2 class="offcanvas-title lh-label" id="topHitRatesSheetTitle"></h2>
      <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button></div>
      <div class="offcanvas-body"></div>`;
    sheet.setAttribute("aria-labelledby", "topHitRatesSheetTitle");
    document.body.appendChild(sheet);
  }
  topOpenPanel = kind;
  sheet.querySelector(".offcanvas-title").textContent = kind === "sort" ? "Sort" : "Filter";
  fillTopPanel(sheet.querySelector(".offcanvas-body"), kind);
  bootstrap.Offcanvas.getOrCreateInstance(sheet).show();
}

// Redraw everything that depends on the controls (after any change).
function refreshTopUi() {
  renderTopControls();
  renderTopChips();
  renderTopRows();
  const menu = topOpenPanel && !isPhone() ? document.getElementById(`topHitRatesMenu-${topOpenPanel}`) : null;
  if (menu) fillTopPanel(menu, topOpenPanel);
  const sheet = document.getElementById("topHitRatesSheet");
  if (topOpenPanel && isPhone() && sheet) fillTopPanel(sheet.querySelector(".offcanvas-body"), topOpenPanel);
}

// The controls row: L5 / L10 / L20 with the Filter and Sort buttons right beside it, as one group.
function renderTopControls() {
  const pills = document.getElementById("topHitRatesPills");
  let bar = document.getElementById("topHitRatesControls");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "topHitRatesControls";
    bar.className = "lh-top-controls";
    // Each button is its own Bootstrap dropdown: the menu opens right under it, with its right edge on the button's right edge.
    const dropdown = (kind, icon, label) => `
      <div class="dropdown">
        <button type="button" class="btn btn-ghost btn-sm lh-top-ctl" data-bs-toggle="dropdown" data-bs-auto-close="outside"
                data-bs-offset="0,6" data-panel="${kind}" aria-expanded="false"><i class="bi ${icon}" aria-hidden="true"></i> ${label}</button>
        <div class="dropdown-menu dropdown-menu-start lh-top-panel" id="topHitRatesMenu-${kind}"></div>
      </div>`;
    bar.innerHTML = `
      <div class="lh-window-toggle btn-group" role="group" aria-label="Window"></div>
      ${dropdown("filter", "bi-funnel", "Filter")}
      ${dropdown("sort", "bi-arrow-down-up", `<span data-sort-label></span>`)}`;
    const chips = document.createElement("div");
    chips.id = "topHitRatesChips";
    chips.className = "lh-top-chips";
    pills.parentNode.insertBefore(bar, pills);
    pills.parentNode.insertBefore(chips, pills);
    bar.querySelectorAll("[data-panel]").forEach((button) => {
      const kind = button.dataset.panel;
      const menu = document.getElementById(`topHitRatesMenu-${kind}`);
      // Phones use the bottom sheet instead of the dropdown.
      button.addEventListener("show.bs.dropdown", (event) => {
        if (isPhone()) { event.preventDefault(); openTopSheet(kind); return; }
        topOpenPanel = kind;
        fillTopPanel(menu, kind);
      });
      button.addEventListener("hidden.bs.dropdown", () => { if (topOpenPanel === kind) topOpenPanel = null; });
    });
  }
  bar.hidden = false;
  bar.querySelector("[data-sort-label]").textContent = `Sort: ${TOP_SORT_LABELS[topSort]}`;

  const group = bar.querySelector(".lh-window-toggle");
  group.innerHTML = "";
  TOP_WINDOWS.forEach((size) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = size === topWindow ? "btn btn-ghost active" : "btn btn-ghost";
    button.setAttribute("aria-pressed", String(size === topWindow));
    button.textContent = `L${size}`;
    button.addEventListener("click", () => {
      topWindow = size;
      refreshTopUi();
    });
    group.appendChild(button);
  });
  // The card's subtitle and corner label follow the window.
  const card = document.getElementById("top-hit-rates");
  const subtitle = card.querySelector(".card-header .small");
  if (subtitle) subtitle.textContent = `Players who hit their line most often in their last ${topWindow} games`;
  const corner = card.querySelector(".card-header .lh-label");
  if (corner) corner.textContent = `L${topWindow}`;
}

function renderTopPills() {
  const pills = document.getElementById("topHitRatesPills");
  pills.hidden = false;
  pills.innerHTML = "";
  if (TOP_NEW_LAYOUT) { renderTopControls(); renderTopChips(); }

  TOP_FILTERS.forEach((filter) => {
    const item = document.createElement("li");
    item.className = "nav-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = filter.code === topFilter ? "nav-link active text-nowrap" : "nav-link text-nowrap";
    button.textContent = filter.label;
    button.addEventListener("click", () => {
      topFilter = filter.code;
      renderTopPills();
      renderTopRows();
    });

    item.appendChild(button);
    pills.appendChild(item);
  });
}

// Schedule page: the rows for the selected window, filtered and sorted. Full samples (a player with the whole window of games)
// always rank above short ones. Hit rate ties: larger sample first, then longer streak.
function sortedWindowRows() {
  const items = topSlate.rows
    .filter((row) => topFilter === "all" || row.code === topFilter)
    .filter((row) => topGame === "all" || String(row.gameId) === String(topGame))
    .filter((row) => !(topHideInjured && isInjuredOut(row.playerId)))
    .map((row) => {
      const win = row.w[topWindow];
      // "Both": each line shows the side that hit more often (the over on a tie).
      const side = topSide === "both" ? (win.under.hitRate > win.over.hitRate ? "under" : "over") : topSide;
      return { row, side, stats: { ...win[side], totalGames: win.totalGames, games: side === "under" ? win.underGames : win.games } };
    })
    .filter((item) => item.stats.totalGames >= Math.max(TOP_MIN_SAMPLE, topMinGames));

  const full = (item) => (item.stats.totalGames >= topWindow ? 1 : 0);
  const byRate = (a, b) => (b.stats.hitRate - a.stats.hitRate)
    || (b.stats.totalGames - a.stats.totalGames)
    || (b.stats.streak - a.stats.streak);
  const compare = {
    rate: byRate,
    streak: (a, b) => (b.stats.streak - a.stats.streak) || byRate(a, b),
    cushion: (a, b) => (b.stats.cushion - a.stats.cushion) || byRate(a, b),
    game: byRate,
  }[topSort];
  items.sort((a, b) => (full(b) - full(a)) || compare(a, b));

  const top = items.slice(0, TOP_ROW_COUNT);
  if (topSort === "game") {
    // Same top rows, grouped by matchup in tip-off order (best hit rate first inside a game).
    top.sort((a, b) => (new Date(a.row.tip) - new Date(b.row.tip)) || (a.row.gameId - b.row.gameId) || (full(b) - full(a)) || byRate(a, b));
  }
  return top;
}

// Prop names in full words for the ticket stub (the combo stays "PRA").
const TOP_PROP_WORDS = { pts: "Points", reb: "Rebounds", ast: "Assists", "3pm": "Threes Made", pra: "PRA" };

// One row = one "bet ticket": a stub (side, line, prop, hit rate) | perforation | player, graph, hit count.
// The right end of every ticket is left empty on purpose: room for "Add to pick" and best odds later.
function topRowHtml({ row, side, stats }) {
  let hitClass = "";
  if (stats.hitRate >= 60) hitClass = "lh-hit--good";
  if (stats.hitRate <= 40) hitClass = "lh-hit--bad";
  const cushion = topSort === "cushion" && stats.cushion !== null
    ? `<span class="lh-top-cushion" title="Average margin past the line">${stats.cushion > 0 ? "+" : ""}${stats.cushion.toFixed(1)}</span>` : "";
  const streak = topSort === "streak" ? `<span class="lh-top-cushion" title="Current run of hits">${stats.streak}🔥</span>` : "";
  const sideWord = side === "under" ? "Under" : "Over";

  return `
    <a class="lh-top-row lh-top-row--v2" href="game.html?id=${row.gameId}&player=${row.playerId}&prop=${row.code}">
      <div class="lh-ticket">
        <div class="lh-ticket-stub">
          <div class="lh-top-prop"><strong class="lh-top-side lh-top-side--${side}">${sideWord}</strong> ${row.line} ${TOP_PROP_WORDS[row.code] || row.code.toUpperCase()}</div>
          <div class="lh-top-rate ${hitClass}">${Math.round(stats.hitRate)}%<span>L${topWindow}</span></div>
        </div>
        <div class="lh-ticket-main">
          <div class="lh-top-player">
            <span class="lh-top-name" title="${row.name}">${row.name}</span>
            <span class="lh-top-meta">${teamBadgeForMatchup(row.team, row.matchup)} <span class="lh-top-matchup">${row.matchup}</span>${cushion}${streak}</span>
          </div>
          <div class="lh-top-count ${hitClass}">${stats.hits}/${stats.totalGames}</div>
          <div class="lh-top-graph">${miniGraph(stats.games)}</div>
        </div>
      </div>
    </a>`;
}

function renderTopRows() {
  if (TOP_NEW_LAYOUT) {
    const list = document.getElementById("topHitRatesList");
    list.removeAttribute("aria-busy");
    const items = sortedWindowRows();
    if (items.length === 0) {
      list.innerHTML = `<div class="lh-top-message text-muted">No players with ${TOP_MIN_SAMPLE}+ games for this prop yet.</div>`;
      return;
    }
    list.innerHTML = items.map(topRowHtml).join("");
    if (typeof limitRowsOnPhones === "function") limitRowsOnPhones(list, ".lh-top-row");
    return;
  }

  const rows = topSlate.rows
    .filter((row) => topFilter === "all" || row.code === topFilter)
    .slice(0, TOP_ROW_COUNT);

  const list = document.getElementById("topHitRatesList");
  list.removeAttribute("aria-busy");

  if (rows.length === 0) {
    list.innerHTML = `<div class="lh-top-message text-muted">No players with ${TOP_MIN_GAMES}+ games for this prop yet.</div>`;
    return;
  }

  // Each row is one big link to the game page, which opens the drawer for this player and prop.
  list.innerHTML = rows.map((row) => {
    let hitClass = "";
    if (row.hitRate >= 60) hitClass = "lh-hit--good";
    if (row.hitRate <= 40) hitClass = "lh-hit--bad";

    return `
      <a class="lh-top-row" href="game.html?id=${row.gameId}&player=${row.playerId}&prop=${row.code}">
        <div class="lh-top-player">
          <span class="fw-semibold">${row.name}</span> ${teamBadgeForMatchup(row.team, row.matchup)}
          <div class="small text-muted">${row.matchup}</div>
        </div>
        <div class="lh-top-prop">${row.code.toUpperCase()} o${row.line}</div>
        <div class="lh-top-graph">${miniGraph(row.games)}</div>
        <div class="lh-top-hit ${hitClass}">${row.hits}/${row.totalGames} <span>(${Math.round(row.hitRate)}%)</span></div>
      </a>`;
  }).join("");
  if (typeof limitRowsOnPhones === "function") limitRowsOnPhones(list, ".lh-top-row"); // phones: 3 rows + "Show more" (js/moreRows.js)
}

// The carousel slide's "Coming soon" pill becomes a link to this card once there's data.
function updateSlideLink() {
  const pill = document.getElementById("hitRatesSlideCta");
  if (!pill) return;
  pill.outerHTML = `<a href="#top-hit-rates" class="lh-slide-link">See top hit rates <span>→</span></a>`;
}

function showTopSlate(slate) {
  topSlate = slate;
  setTopTitle(slate.date);

  if (slate.noGames) {
    renderTopMessage(`<span class="text-muted">No games scheduled for this day.</span>`);
    return;
  }

  if (slate.rows.length === 0) {
    const when = slate.date ? ` for ${slateDateLabel(slate.date)}` : "";
    renderTopMessage(`<span class="lh-coming-soon">Coming soon</span><div class="small text-muted mt-2">No prop lines posted${when} yet.</div>`);
    return;
  }

  if (topGame !== "all" && !slate.rows.some((row) => String(row.gameId) === String(topGame))) topGame = "all"; // another day was picked
  renderTopPills();
  renderTopRows();
  updateSlideLink();
  if (typeof showHitList === "function") showHitList(slate);
  if (typeof showFanCards === "function") showFanCards(slate);
  if (typeof refreshQuickLookTopProps === "function") refreshQuickLookTopProps(); // schedule page: open Quick looks fill in their top prop
}

// The shared loading steps for both pages.
//   cacheKey:  where to look in sessionStorage first ("next" or a date)
//   titleDate: the date to show in the header while loading (null if we don't know it yet)
//   getSlate:  how to find the games: returns { date, games }, or null if there are none
async function loadTopHitRates({ cacheKey, titleDate, getSlate }) {
  if (!document.getElementById("top-hit-rates")) return;
  const requestNumber = ++topRequestNumber;

  // Saved in the last 10 minutes? Show it straight away, no downloads.
  const cached = readTopCache(cacheKey);
  if (cached) {
    showTopSlate(cached);
    return;
  }

  setTopTitle(titleDate);
  renderTopSkeleton();
  try {
    const slate = await getSlate();

    // The homepage only learns the date now. Maybe the schedule page already saved that day?
    const savedForDate = slate && slate.date !== cacheKey ? readTopCache(slate.date) : null;

    const result = savedForDate
      || (slate ? await buildTopHitRates(slate) : { date: titleDate, rows: [], noGames: Boolean(titleDate) });

    // On the schedule page you can click to another day while this one is still loading.
    // If a newer load has started since, drop this result instead of showing the wrong day.
    if (requestNumber !== topRequestNumber) return;

    writeTopCache(cacheKey, result);
    if (result.date && result.date !== cacheKey) writeTopCache(result.date, result); // the homepage's slate, saved by date too
    showTopSlate(result);
  } catch (error) {
    if (requestNumber !== topRequestNumber) return;
    console.error(error);
    renderTopMessage(`<span class="text-muted">Couldn't load hit rates right now. Try again in a minute.</span>`);
  }
}

// Schedule page: called by app.js with the picked day ("2026-10-20") and the games it already downloaded.
function showTopHitRatesForDay(day, games) {
  return loadTopHitRates({
    cacheKey: day,
    titleDate: day,
    getSlate: async () => (games.length ? { date: day, games } : null),
  });
}

// Homepage: the next slate. The card there has data-slate="next".
// (On the schedule page app.js decides the day, so nothing starts here.)
if (document.querySelector('#top-hit-rates[data-slate="next"]')) {
  loadTopHitRates({ cacheKey: "next", titleDate: null, getSlate: findNextSlate });
}
