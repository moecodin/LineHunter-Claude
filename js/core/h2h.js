// LineHunter - js/core/h2h.js
// Head-to-head game logs: every game between two teams over the last H2H_SEASONS seasons (this one plus the 4 before it,
// regular season and playoffs), with every player's stat line in those games.
//
//   loadH2H(teamId, opponentId)   -> Promise of { games, logsByPlayer }   (the same promise for both team orders)
//   h2hLogsFor(h2h, playerId)     -> that player's lines in those games, newest first, in the same shape as the game logs
//                                    from loadPlayerGameLogs (opponent, isHome...), so hitRateForWindow / pickWindowLogs work on them
//
// Cheap on purpose: the team's games come one request per season (the same URL for every opponent, and cached for a day
// once the season is over), and ONE paged /v1/stats request for all those games' ids covers every player on both teams.
// A player who was on either of the two teams in a game gets that game's line, whichever team they play for now.
// Needs js/core/stats.js (bdlGet, bdlGetAllPages, addOpponentInfo, getTeamAbbreviations, sortNewestFirst, currentSeasonYear).

const H2H_SEASONS = 5;
const h2hLoads = {}; // "lowerTeamId-higherTeamId" -> Promise

function h2hSeasonYears() {
  const current = currentSeasonYear();
  return Array.from({ length: H2H_SEASONS }, (item, index) => current - index);
}

function loadH2H(teamId, opponentId) {
  const key = [teamId, opponentId].sort((a, b) => a - b).join("-");
  if (!h2hLoads[key]) {
    h2hLoads[key] = fetchH2H(teamId, opponentId).catch((error) => { delete h2hLoads[key]; throw error; });
  }
  return h2hLoads[key];
}

async function fetchH2H(teamId, opponentId) {
  // 1. The team's games, one request per season, keeping the finished games against the opponent.
  const seasons = await Promise.all(h2hSeasonYears().map((year) =>
    bdlGetAllPages(`${BDL_BASE}/games?team_ids[]=${teamId}&seasons[]=${year}&per_page=100`)
  ));
  const games = seasons.flat()
    .filter((game) => game.status === "Final" && (game.home_team.id === opponentId || game.visitor_team.id === opponentId))
    .sort((a, b) => b.date.localeCompare(a.date));
  if (games.length === 0) return { games: [], logsByPlayer: {} };

  // 2. One stats request (paged) for all of those games: every player on both teams.
  const [rows, teams] = await Promise.all([
    bdlGetAllPages(`${BDL_BASE}/stats?${games.map((game) => `game_ids[]=${game.id}`).join("&")}&per_page=100`),
    getTeamAbbreviations(),
  ]);
  addOpponentInfo(rows, teams);

  const logsByPlayer = {};
  rows.forEach((row) => { (logsByPlayer[row.player.id] = logsByPlayer[row.player.id] || []).push(row); });
  Object.values(logsByPlayer).forEach(sortNewestFirst);
  return { games, logsByPlayer };
}

// One player's games against one team over the same seasons, WHICHEVER team the player was on (a player traded in this
// summer still gets his games against that opponent). Same shape as loadH2H, so h2hLogsFor works on it. Used by the H2H
// chip on the player page and in both drawers; loadH2H (team pair) stays for the Matchup Analysis card and the Analyzer.
// One /v1/stats request per season (in parallel), memoized per player + opponent.
const playerH2HLoads = {}; // "playerId-opponentId" -> Promise

function loadPlayerH2H(playerId, opponentId) {
  const key = `${playerId}-${opponentId}`;
  if (!playerH2HLoads[key]) {
    playerH2HLoads[key] = fetchPlayerH2H(playerId, Number(opponentId)).catch((error) => { delete playerH2HLoads[key]; throw error; });
  }
  return playerH2HLoads[key];
}

async function fetchPlayerH2H(playerId, opponentId) {
  const [seasons, teams] = await Promise.all([
    Promise.all(h2hSeasonYears().map((year) =>
      bdlGetAllPages(`${BDL_BASE}/stats?player_ids[]=${playerId}&seasons[]=${year}&per_page=100`)
    )),
    getTeamAbbreviations(),
  ]);
  const opponentOf = (row) => (row.game.home_team_id === row.team.id ? row.game.visitor_team_id : row.game.home_team_id);
  const rows = seasons.flat().filter((row) => row.game && row.team && row.game.status === "Final" && opponentOf(row) === opponentId);
  addOpponentInfo(rows, teams);
  sortNewestFirst(rows);
  return { games: rows.map((row) => row.game), logsByPlayer: { [playerId]: rows } };
}

// The id of the team called opponentAbbreviation in a game (drawers know the opponent by its abbreviation), or null.
function h2hTeamIdIn(game, opponentAbbreviation) {
  if (!game || !opponentAbbreviation) return null;
  if (game.home_team && game.home_team.abbreviation === opponentAbbreviation) return game.home_team.id;
  if (game.visitor_team && game.visitor_team.abbreviation === opponentAbbreviation) return game.visitor_team.id;
  return null;
}

function h2hLogsFor(h2h, playerId) {
  return (h2h && h2h.logsByPlayer[playerId]) || [];
}

// ---------- Shared by the player page and both drawers ----------

// The chip group's choices. H2H is added by the page once it knows the opponent (see h2hSplitOptions).
const SPLIT_CHOICES = [
  { label: "All", value: "all" },
  { label: "Home", value: "home" },
  { label: "Away", value: "away" },
];

// All / Home / Away, plus H2H when there is an opponent. noGames = the player has no games against that team: the pill is greyed out
// with the reason on hover / tap.
function h2hSplitOptions(opponentAbbreviation, noGames) {
  if (!opponentAbbreviation) return SPLIT_CHOICES;
  return [...SPLIT_CHOICES, {
    label: "H2H",
    value: "h2h",
    disabled: noGames,
    title: noGames ? `No games against ${opponentAbbreviation} in the last ${H2H_SEASONS} seasons` : `Games against ${opponentAbbreviation}, last ${H2H_SEASONS} seasons`,
  }];
}

// A player's games for one split. logs = { current, previous } (newest first). Returns { logs, showingCurrentSeason }:
// showingCurrentSeason is true for H2H ("Season" there = every game in the 5-season range) and null otherwise (the caller keeps its own).
function splitGames(logs, split, h2hLogs) {
  if (split === "h2h") return { logs: { current: h2hLogs || [], previous: [] }, showingCurrentSeason: true };
  if (split === "home" || split === "away") {
    const keep = (log) => (split === "home") === log.isHome;
    return { logs: { current: logs.current.filter(keep), previous: logs.previous.filter(keep) }, showingCurrentSeason: null };
  }
  return { logs, showingCurrentSeason: null };
}

// Under the hit rate while H2H is on: "vs BOS · 12 games since 2022-23" (all of the player's games in the 5 seasons, not just the
// window), with a "Small sample" tag under 8 games. Empty when there are no games.
function h2hNoteHtml(opponentAbbreviation, h2hLogs) {
  const played = (h2hLogs || []).filter(playedInGame);
  if (!opponentAbbreviation || played.length === 0) return "";
  const firstYear = Math.min(...played.map((log) => log.game.season));
  const since = `${firstYear}-${String((firstYear + 1) % 100).padStart(2, "0")}`;
  return `<div class="lh-h2h-note">vs ${opponentAbbreviation} · ${played.length} game${played.length === 1 ? "" : "s"} since ${since}${played.length < 8 ? ` <span class="lh-sample-tag">Small sample</span>` : ""}</div>`;
}

// The H2H data for the two teams of one game (drawers know the game, not the team ids).
async function loadH2HForGame(gameId) {
  const json = await bdlGet(`${BDL_BASE}/games/${gameId}`);
  return loadH2H(json.data.home_team.id, json.data.visitor_team.id);
}

// One player's games against the opponent in one game (named by abbreviation), whichever team he played for.
async function loadPlayerH2HForGame(playerId, gameId, opponentAbbreviation) {
  const json = await bdlGet(`${BDL_BASE}/games/${gameId}`);
  const opponentId = h2hTeamIdIn(json.data, opponentAbbreviation);
  if (opponentId === null) throw new Error(`No ${opponentAbbreviation} in game ${gameId}`);
  return loadPlayerH2H(playerId, opponentId);
}
