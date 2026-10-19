// LineHunter - js/core/stats.js
// Shared stats code for every page that shows hit rates (the homepage and game.html).
// Data only, no page drawing, except miniGraph() at the bottom, which builds a small piece of HTML.
//
// What's in here:
//   - bdlGet():              every API request goes through this (adds the key, clear errors)
//   - prop helpers:          "points_assists" -> "pts+ast", pick one line per player
//   - game logs:             fetchPlayerGameLogs() for one player, loadPlayerGameLogs() for many at once
//   - calculateHitRate():    how often a player went OVER a line
//   - pickWindowLogs():      the games in an L5 / L10 / L20 / Season window
//   - hitRateForWindow():    calculateHitRate for one of those windows
//   - formatOdds(), formatStatValue(): number formatting
//
// Every request goes to /api/bdl/... (netlify/functions/bdl.js), which adds the API key on the server. No key lives in the browser.

// Named differently from API_BASE in js/pages/app.js, so this file can sit on the same page without a name clash.
const BDL_BASE = "/api/bdl/v1";
const PROPS_URL = "/api/bdl/nba/v2/odds/player_props";

// Several sportsbooks post a line for the same player and prop.
// We use one per player: this book if it has one, otherwise the first one we find.
const PREFERRED_BOOK = "draftkings";

// The single stats calculateHitRate understands. Combos join them with "+",
// like "pts+reb+ast": the three are added together.
const HIT_RATE_STAT_KEYS = ["pts", "reb", "ast", "fg3m", "stl", "blk", "turnover"];

// "pts+reb" is fine if every piece of it is in the list above.
function isKnownStat(stat) {
  return stat.split("+").every((key) => HIT_RATE_STAT_KEYS.includes(key));
}

// ---------- Requests ----------

// One place for every request: turns bad answers into clear errors. (The key is added by the server, not here.)
async function bdlGet(url) {
  const response = await fetch(url);
  if (response.status === 401) {
    throw new Error("The API said no (401). Your plan may not include this data, or the server's API key is wrong.");
  }
  if (response.status === 429) {
    throw new Error("Too many requests. Wait a minute and try again.");
  }
  if (!response.ok) {
    throw new Error(`The API answered with status ${response.status}`);
  }
  return response.json();
}

// Ask for every page of a list. The API hands out at most 100 items per answer,
// plus meta.next_cursor: a bookmark for "the next page starts here".
// We keep asking until there is no bookmark, which means we have everything.
async function bdlGetAllPages(url) {
  const items = [];
  let cursor = null;

  do {
    const json = await bdlGet(cursor ? `${url}&cursor=${cursor}` : url);
    items.push(...json.data); // ... spreads the list out, so we add each item rather than one big list
    cursor = json.meta && json.meta.next_cursor;
  } while (cursor);

  return items;
}

// [1,2,3,4,5,6,7] in groups of 3 -> [[1,2,3], [4,5,6], [7]]
function splitIntoGroups(list, groupSize) {
  const groups = [];
  for (let i = 0; i < list.length; i += groupSize) {
    groups.push(list.slice(i, i + groupSize));
  }
  return groups;
}

// "player_ids[]=1&player_ids[]=2"
function playerIdParams(playerIds) {
  return playerIds.map((id) => `player_ids[]=${id}`).join("&");
}

// Names, teams and positions for many players: up to 100 per request.
// Returns players[237] = { first_name, last_name, position, team: {...} }
async function fetchPlayers(playerIds) {
  const groups = splitIntoGroups(playerIds, 100);
  const answers = await Promise.all(
    groups.map((group) => bdlGet(`${BDL_BASE}/players?per_page=100&${playerIdParams(group)}`))
  );

  const players = {};
  answers.forEach((json) => json.data.forEach((player) => {
    players[player.id] = player;
  }));
  return players;
}

// ---------- Seasons and props ----------

// BALLDONTLIE names a season by the year it starts. From September on, the new season's year is "current".
function currentSeasonYear() {
  const today = new Date();
  return today.getMonth() >= 8 ? today.getFullYear() : today.getFullYear() - 1;
}

// Prop type words -> the stat names in a game log.
const PROP_WORD_TO_STAT = {
  points: "pts",
  rebounds: "reb",
  assists: "ast",
  threes: "fg3m",
  steals: "stl",
  blocks: "blk",
  turnovers: "turnover",
};

// "points" -> "pts", "points_rebounds_assists" -> "pts+reb+ast"
// Returns null for props we can't add up from a box score, like "double_double".
function propStatKey(propType) {
  const stats = propType.split("_").map((word) => PROP_WORD_TO_STAT[word]);
  if (stats.includes(undefined)) return null;
  return stats.join("+");
}

// Short codes for links like game.html?id=1&player=2&prop=pts, and labels like "PTS o24.5".
const PROP_CODES = {
  pts: "points",
  reb: "rebounds",
  ast: "assists",
  "3pm": "threes",
  pra: "points_rebounds_assists",
};

// "threes" -> "3pm" (or null if it has no short code)
function propCode(propType) {
  return Object.keys(PROP_CODES).find((code) => PROP_CODES[code] === propType) || null;
}

// From every prop the API sent, keep simple over/under lines, ONE per player per prop type,
// preferring PREFERRED_BOOK. ("milestone" markets like "25+ points" are skipped.)
function pickOneLinePerPlayer(props) {
  // "picked" works like a dictionary: picked["237-points"] = that line
  const picked = {};
  props
    .filter((prop) => prop.market.type === "over_under")
    .forEach((prop) => {
      const key = `${prop.player_id}-${prop.prop_type}`;
      if (!picked[key] || prop.vendor === PREFERRED_BOOK) {
        picked[key] = prop;
      }
    });
  return Object.values(picked); // turn the dictionary back into a list
}

// ---------- Game logs ----------

// Each game record only has team ids (like 20), not abbreviations (like "NYK").
// So we download the team list once and keep it: abbreviations[20] = "NYK".
// We keep the *promise* (the download in progress), not just the finished list.
// That way, if several downloads need it at the same moment, they all wait on the same single request.
let teamAbbreviationsPromise = null;

function getTeamAbbreviations() {
  if (!teamAbbreviationsPromise) {
    teamAbbreviationsPromise = bdlGet(`${BDL_BASE}/teams`).then((json) => {
      const abbreviations = {};
      json.data.forEach((team) => {
        abbreviations[team.id] = team.abbreviation;
      });
      return abbreviations;
    });
    // If the download fails, forget it so the next call can try again.
    teamAbbreviationsPromise.catch(() => {
      teamAbbreviationsPromise = null;
    });
  }
  return teamAbbreviationsPromise;
}

// Add two easy-to-use fields to each game: who the opponent was, and home or away.
// log.team is the player's team in that game, which stays right even if the player was traded mid-season.
function addOpponentInfo(logs, teams) {
  logs.forEach((log) => {
    const isHome = log.game.home_team_id === log.team.id;
    const opponentId = isHome ? log.game.visitor_team_id : log.game.home_team_id;
    log.isHome = isHome;
    log.opponent = teams[opponentId] || "???";
  });
}

// Newest first. Dates look like "2026-04-12", and text in that format sorts in date order.
// b before a = biggest (latest) first.
function sortNewestFirst(logs) {
  return logs.sort((a, b) => b.game.date.localeCompare(a.game.date));
}

// The API writes minutes as text: "34", "05", or "00" when the player sat out.
// Some records use "34:12" (minutes:seconds), so we check every part.
// The player played if any part is above zero.
function playedInGame(log) {
  if (!log.min) return false; // missing or empty = did not play
  return log.min.split(":").some((part) => Number(part) > 0);
}

// "pts" -> log.pts
// "pts+reb+ast" -> log.pts + log.reb + log.ast
function statValue(log, stat) {
  return stat
    .split("+")
    .reduce((sum, key) => sum + (log[key] ?? 0), 0); // ?? 0 = use 0 if the number is missing
}

// Every game ONE player played in a season, newest first. (Used by dev/hitrate-test.html.)
async function fetchPlayerGameLogs(playerId, season = currentSeasonYear() - 1) {
  // Ask for the team list at the same time as the stats, instead of waiting for one then the other.
  const [logs, teams] = await Promise.all([
    bdlGetAllPages(`${BDL_BASE}/stats?player_ids[]=${playerId}&seasons[]=${season}&per_page=100`),
    getTeamAbbreviations(),
  ]);
  addOpponentInfo(logs, teams);
  return sortNewestFirst(logs);
}

// How many players share one request. One request can ask for many players (player_ids[] list),
// but their games come back 100 at a time, one page after another. Each page needs the bookmark
// from the page before, so one huge group would be one long, slow chain of pages.
// Groups of 5 = a few pages each, and all groups download at the same time.
const PLAYERS_PER_REQUEST = 5;

// Every game MANY players played in a season. Returns logsByPlayer[237] = [...newest first]
async function fetchGameLogsForPlayers(playerIds, season) {
  const groups = splitIntoGroups(playerIds, PLAYERS_PER_REQUEST);
  const [groupLogs, teams] = await Promise.all([
    Promise.all(groups.map((group) =>
      bdlGetAllPages(`${BDL_BASE}/stats?${playerIdParams(group)}&seasons[]=${season}&per_page=100`)
        // If one group fails, those players show "–" and every other group still loads.
        .catch((error) => {
          console.warn(`Stats unavailable for players ${group.join(", ")}:`, error);
          return [];
        })
    )),
    getTeamAbbreviations(),
  ]);

  // Every player starts with an empty list, so players with no games still get one.
  const logsByPlayer = {};
  playerIds.forEach((id) => {
    logsByPlayer[id] = [];
  });

  groupLogs.flat().forEach((log) => {
    if (logsByPlayer[log.player.id]) logsByPlayer[log.player.id].push(log);
  });

  Object.values(logsByPlayer).forEach((logs) => {
    addOpponentInfo(logs, teams);
    sortNewestFirst(logs);
  });
  return logsByPlayer;
}

// This season's games for every player, plus last season's for anyone with fewer than
// gamesNeeded played games this season (the 2026 -> 2025 fallback).
// Returns {
//   logsByPlayer: { 237: { current: [...newest first], previous: [...newest first] } },
//   showingCurrentSeason: false when nobody has played this season yet ("Season" then means last season)
// }
async function loadPlayerGameLogs(playerIds, gamesNeeded) {
  const season = currentSeasonYear();
  const current = await fetchGameLogsForPlayers(playerIds, season);

  // Only the players who need it get last season's games.
  const needLastSeason = playerIds.filter((id) => current[id].filter(playedInGame).length < gamesNeeded);
  const previous = needLastSeason.length
    ? await fetchGameLogsForPlayers(needLastSeason, season - 1)
    : {};

  const logsByPlayer = {};
  playerIds.forEach((id) => {
    logsByPlayer[id] = { current: current[id], previous: previous[id] || [] };
  });

  return {
    logsByPlayer,
    showingCurrentSeason: playerIds.some((id) => current[id].some(playedInGame)),
  };
}

// ---------- Hit rate against a line ----------

// games:      game logs, newest first
// stat:       a key from HIT_RATE_STAT_KEYS, or a combo like "pts+reb+ast"
// line:       the betting line, like 24.5
// windowSize: 5, 10, 20, or "all" = how many of the most recent games to look at
function calculateHitRate(games, stat, line, windowSize) {
  if (!isKnownStat(stat)) {
    throw new Error(`Unknown stat "${stat}". Use these, alone or joined with "+": ${HIT_RATE_STAT_KEYS.join(", ")}`);
  }

  // 1. Drop games where the player didn't play. A 0 from the bench would unfairly count as an "under".
  const played = games.filter(playedInGame);

  // 2. Keep only the most recent games. The list is newest first, so that's the front of it.
  const recent = windowSize === "all" ? played : played.slice(0, windowSize);

  // 3. Turn each game into one simple row.
  const rows = recent.map((log) => {
    const value = statValue(log, stat);

    let overUnder = "push"; // exactly on the line: neither over nor under
    if (value > line) overUnder = "over";
    if (value < line) overUnder = "under";

    return {
      gameId: log.game.id,
      date: log.game.date,
      opponent: log.opponent,
      homeAway: log.isHome ? "home" : "away",
      value,
      overUnder,
      // Extra details for tooltips: each stat in a combo, minutes played, and the final score
      // from the player's team's side.
      parts: stat.split("+").map((key) => ({ key, value: log[key] ?? 0 })), // [{ key: "pts", value: 18 }, ...]
      minutes: Number(String(log.min).split(":")[0]) || 0,                  // "34:12" -> 34
      teamScore: log.isHome ? log.game.home_team_score : log.game.visitor_team_score,
      opponentScore: log.isHome ? log.game.visitor_team_score : log.game.home_team_score,
    };
  });

  // 4. Count and average.
  const totalGames = rows.length;
  const hits = rows.filter((row) => row.overUnder === "over").length;
  const sum = rows.reduce((total, row) => total + row.value, 0);

  // With zero games there's nothing to divide by, so we return null ("no data")
  // instead of a misleading 0%.
  const round1 = (number) => Math.round(number * 10) / 10; // 63.333 -> 63.3

  return {
    hits,
    totalGames,
    hitRate: totalGames ? round1((hits / totalGames) * 100) : null,
    average: totalGames ? round1(sum / totalGames) : null,
    games: rows,
  };
}

// The played games in a window, newest first. The window rules every page uses:
//   5 / 10 / 20 -> the most recent games, this season first, then last season behind them
//   "season"    -> this season's games, or last season's if nobody has played this season yet
// logs = one player's { current, previous } from loadPlayerGameLogs.
function pickWindowLogs(logs, windowSize, showingCurrentSeason) {
  const { current = [], previous = [] } = logs || {};

  if (windowSize === "season") {
    return (showingCurrentSeason ? current : previous).filter(playedInGame);
  }

  // Both lists are newest first, so this season's games come first and last season fills in behind them.
  return [...current, ...previous].filter(playedInGame).slice(0, windowSize);
}

// calculateHitRate for a window (see pickWindowLogs). The player page's game log table uses
// pickWindowLogs directly, so the table and the hit rate always cover exactly the same games.
function hitRateForWindow(logs, stat, line, windowSize, showingCurrentSeason) {
  return calculateHitRate(pickWindowLogs(logs, windowSize, showingCurrentSeason), stat, line, "all");
}

// ---------- Number formatting ----------

// American odds: show a + in front of positive numbers (+120), leave negatives as they are (-110).
function formatOdds(odds) {
  if (odds === null || odds === undefined) return "–";
  return odds > 0 ? `+${odds}` : `${odds}`;
}

// 23.25 -> "23.3", null -> "–"
function formatStatValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return Number(value).toFixed(1);
}

// ---------- Mini bar graph (shared HTML) ----------

// One plain <span> per game, oldest on the left. Needs the .lh-mini-graph styles in css/styles.css.
// Each bar's height is a percent of this player's best game in the window, so the tallest bar fills the box.
// games = calculateHitRate(...).games (newest first), or anything with { value, overUnder }.
function miniGraph(games) {
  if (games.length === 0) return `<span class="text-muted">–</span>`;

  const oldestFirst = [...games].reverse();
  const highest = Math.max(...oldestFirst.map((game) => game.value), 1); // at least 1, so we never divide by 0

  const bars = oldestFirst.map((game) => {
    // Math.max(..., 4) keeps a 0 visible as a short stub instead of nothing.
    const height = Math.max((game.value / highest) * 100, 4);
    const label = game.date ? ` title="${game.date} ${game.homeAway === "away" ? "@" : ""}${game.opponent}: ${game.value}"` : "";
    return `<span class="lh-mini-bar lh-mini-bar--${game.overUnder}" style="height: ${height}%"${label}></span>`;
  }).join("");

  const overs = games.filter((game) => game.overUnder === "over").length;
  return `<div class="lh-mini-graph" role="img" aria-label="${overs} of ${games.length} games over the line">${bars}</div>`;
}
