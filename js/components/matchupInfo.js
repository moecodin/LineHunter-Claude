// LineHunter - js/matchupInfo.js
// The "Matchup Info" card on game.html, next to the game header: arena, coaches, last 5, home / road record,
// rest days and the last meeting. (Last 5 is drawn under each team's name in the header card.) Away team on the left, home team on the right, labels in the middle.
//
// Real API shapes (checked against live responses):
//   Games:     GET /v1/games?team_ids[]=20&seasons[]=2025&per_page=100  (paginated)
//              team_ids[] matches games where EITHER listed team played, so "games between two teams" are filtered here.
//              Each game: { id, date: "2025-10-22", season, status: "Final", postseason, home_team_score, visitor_team_score,
//                           home_team: {id, abbreviation, ...}, visitor_team: {...} }
//   Standings: GET /v1/standings?season=2025 -> 30 rows { team: {id, ...}, wins, losses, home_record: "31-9", road_record: "28-13" }
//              A season with no games comes back as { data: [] }.
//
// Needs js/stats.js (bdlGet, bdlGetAllPages) and js/teams.js (TEAM_INFO).

const MATCHUP_CACHE_MS = 10 * 60 * 1000;
const STANDINGS_CACHE_MS = 60 * 60 * 1000;
const MATCHUP_LAST_N = 5;      // "Last 5"
const MATCHUP_MAX_REST = 21;   // a gap longer than this days is the offseason: show "–"

// ---------- Cache ----------

function matchupCacheRead(key, maxAge) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    return saved && Date.now() - saved.savedAt < maxAge ? saved.data : null;
  } catch (error) {
    return null;
  }
}

function matchupCacheWrite(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch (error) {
    // storage full or blocked: it just won't be cached
  }
}

// ---------- Data ----------

// Every FINISHED game one team played in a season, slimmed down: [{ id, date, home, away, homeScore, awayScore }] (ids = team ids).
async function fetchTeamGames(teamId, season) {
  const key = `lh-team-games:${teamId}:${season}`;
  const cached = matchupCacheRead(key, MATCHUP_CACHE_MS);
  if (cached) return cached;

  const games = await bdlGetAllPages(`${BDL_BASE}/games?team_ids[]=${teamId}&seasons[]=${season}&per_page=100`);
  const slim = games.filter((game) => game.status === "Final").map((game) => ({
    id: game.id,
    date: game.date.slice(0, 10),
    home: game.home_team.id,
    away: game.visitor_team.id,
    homeAbbr: game.home_team.abbreviation,
    awayAbbr: game.visitor_team.abbreviation,
    homeScore: game.home_team_score,
    awayScore: game.visitor_team_score,
  }));
  matchupCacheWrite(key, slim);
  return slim;
}

// The standings for a season as { teamId: { home: "31-9", road: "28-13" } }, or null if the season has no games yet.
async function fetchStandings(season) {
  const key = `lh-standings:${season}`;
  const cached = matchupCacheRead(key, STANDINGS_CACHE_MS);
  if (cached) return cached.empty ? null : cached.records;

  const json = await bdlGet(`${BDL_BASE}/standings?season=${season}`);
  const records = {};
  (json.data || []).forEach((row) => {
    records[row.team.id] = { home: row.home_record, road: row.road_record };
  });
  const empty = Object.keys(records).length === 0;
  matchupCacheWrite(key, empty ? { empty: true } : { records });
  return empty ? null : records;
}

// ---------- Numbers ----------

// Whole days from one "2026-10-20" date to another.
function daysBetween(fromDate, toDate) {
  const toUtc = (text) => Date.UTC(Number(text.slice(0, 4)), Number(text.slice(5, 7)) - 1, Number(text.slice(8, 10)));
  return Math.round((toUtc(toDate) - toUtc(fromDate)) / 86400000);
}

// One team's finished games before the selected game, newest first, as seen from that team: { date, won, opponent }.
function teamResults(games, teamId, beforeDate) {
  return games
    .filter((game) => game.date < beforeDate && (game.home === teamId || game.away === teamId))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((game) => {
      const isHome = game.home === teamId;
      const own = isHome ? game.homeScore : game.awayScore;
      const other = isHome ? game.awayScore : game.homeScore;
      return { date: game.date, won: own > other, opponent: isHome ? game.awayAbbr : game.homeAbbr, isHome };
    });
}

// "Apr 6" (with the year for old games)
function shortGameDate(isoDate, withYear) {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("en-US", withYear ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
}

// ---------- Drawing ----------

// One row: away value | label | home value.
function infoRow(label, awayHtml, homeHtml) {
  return `
    <div class="lh-mi-row">
      <div class="lh-mi-away">${awayHtml}</div>
      <div class="lh-mi-label">${label}</div>
      <div class="lh-mi-home">${homeHtml}</div>
    </div>`;
}

function lastFiveHtml(results) {
  if (results === null) return `<span class="text-muted">…</span>`;
  const last = results.slice(0, MATCHUP_LAST_N);
  if (last.length === 0) return `<span class="text-muted">–</span>`;
  const wins = last.filter((game) => game.won).length;
  // Oldest on the left, newest on the right.
  const dots = [...last].reverse().map((game) =>
    `<span class="lh-mi-dot ${game.won ? "is-win" : "is-loss"}" title="${game.won ? "W" : "L"} ${game.isHome ? "vs" : "@"} ${game.opponent} · ${shortGameDate(game.date)}"></span>`).join("");
  return `<span class="lh-mi-dots">${dots}</span> <span class="lh-mi-record">${wins}–${last.length - wins}</span>`;
}

function restHtml(results, gameDate) {
  if (results === null) return `<span class="text-muted">…</span>`;
  if (results.length === 0) return `<span class="text-muted">–</span>`;
  const days = daysBetween(results[0].date, gameDate);
  if (days > MATCHUP_MAX_REST) return `<span class="text-muted">–</span>`;
  return `${days} ${days === 1 ? "day" : "days"}${days === 1 ? ` <span class="lh-mi-b2b" title="Back-to-back: played yesterday">B2B</span>` : ""}`;
}

function renderMatchupInfo(game, data) {
  const away = game.visitor_team.abbreviation;
  const home = game.home_team.abbreviation;
  const awayInfo = TEAM_INFO[away] || {};
  const homeInfo = TEAM_INFO[home] || {};
  const arena = homeInfo.arena ? `${homeInfo.arena} · ${homeInfo.city}` : `${game.home_team.city}`;

  // Records: the home team's HOME record and the away team's ROAD record.
  let awayRecord = `<span class="text-muted">…</span>`;
  let homeRecord = awayRecord;
  let recordLabel = "Road · Home";
  if (data.records !== undefined) {
    const mine = (id, field) => (data.records && data.records[id] ? data.records[id][field] : null);
    awayRecord = mine(game.visitor_team.id, "road") || `<span class="text-muted">–</span>`;
    homeRecord = mine(game.home_team.id, "home") || `<span class="text-muted">–</span>`;
    if (data.records && data.recordSeasonLabel) recordLabel = `Road · Home <span class="lh-mi-note">${data.recordSeasonLabel}</span>`;
  }

  let meeting = `<span class="text-muted">Loading last meeting…</span>`;
  if (data.meeting !== undefined) {
    if (data.meeting === null) {
      meeting = `<span class="text-muted">No earlier meeting found</span>`;
    } else {
      const m = data.meeting;
      const homeWon = m.homeScore > m.awayScore;
      const [winner, loser] = homeWon ? [m.homeAbbr, m.awayAbbr] : [m.awayAbbr, m.homeAbbr];
      const [high, low] = homeWon ? [m.homeScore, m.awayScore] : [m.awayScore, m.homeScore];
      meeting = `${shortGameDate(m.date, m.olderSeason)} · <strong>${winner} ${high}–${low} ${loser}</strong>${m.olderSeason ? ` <span class="lh-mi-note">Last season</span>` : ""}`;
    }
  }

  // Last 5 sits under each team's name in the game header card (see renderGameHeader in game.js).
  const formAway = document.getElementById("formAway");
  const formHome = document.getElementById("formHome");
  if (formAway) formAway.innerHTML = lastFiveHtml(data.awayResults === undefined ? null : data.awayResults);
  if (formHome) formHome.innerHTML = lastFiveHtml(data.homeResults === undefined ? null : data.homeResults);

  document.getElementById("matchup-info-body").innerHTML = `
    <div class="card-body p-3 d-flex flex-column justify-content-center">
      <div class="lh-mi-top"><i class="bi bi-geo-alt" aria-hidden="true"></i> ${arena}</div>
      <div class="lh-mi-teams"><span>${away}</span><span></span><span>${home}</span></div>
      ${infoRow("Coach", awayInfo.coach || "–", homeInfo.coach || "–")}
      ${infoRow(recordLabel, awayRecord, homeRecord)}
      ${infoRow("Rest", restHtml(data.awayResults === undefined ? null : data.awayResults, game.date.slice(0, 10)), restHtml(data.homeResults === undefined ? null : data.homeResults, game.date.slice(0, 10)))}
      <div class="lh-mi-bottom"><span class="lh-label">Last meeting</span> ${meeting}</div>
    </div>`;
}

// ---------- Loading ----------

// The finished games for both teams before the selected game. Looks back to the previous season only if
// this season doesn't have enough (5 games each, and a meeting between the two).
async function loadMatchupInfo(game) {
  if (!document.getElementById("matchup-info-body")) return;
  const data = {};
  renderMatchupInfo(game, data); // the arena and coaches show right away; the rest fills in below

  const gameDate = game.date.slice(0, 10);
  const season = game.season;
  const homeId = game.home_team.id;
  const awayId = game.visitor_team.id;

  try {
    // Standings: this season's records, or last season's if the season has no games yet.
    const standingsPromise = (async () => {
      let records = await fetchStandings(season);
      let label = "";
      if (!records) {
        records = await fetchStandings(season - 1);
        label = "Last season";
      }
      data.records = records;
      data.recordSeasonLabel = label;
      renderMatchupInfo(game, data);
    })().catch((error) => {
      console.warn("Standings unavailable:", error);
      data.records = null;
      renderMatchupInfo(game, data);
    });

    // Both teams' games this season, then last season if either is short on games or there's no meeting yet.
    const [homeGames, awayGames] = await Promise.all([fetchTeamGames(homeId, season), fetchTeamGames(awayId, season)]);
    const needsMore = (games, teamId) => teamResults(games, teamId, gameDate).length < MATCHUP_LAST_N;
    const meetingThisSeason = (games) => games.some((item) => item.date < gameDate && ((item.home === homeId && item.away === awayId) || (item.home === awayId && item.away === homeId)));
    let allHome = homeGames;
    let allAway = awayGames;
    const lookBack = needsMore(homeGames, homeId) || needsMore(awayGames, awayId) || !meetingThisSeason(homeGames);
    if (lookBack) {
      const [homeOld, awayOld] = await Promise.all([fetchTeamGames(homeId, season - 1), fetchTeamGames(awayId, season - 1)]);
      allHome = [...homeGames, ...homeOld];
      allAway = [...awayGames, ...awayOld];
    }

    data.homeResults = teamResults(allHome, homeId, gameDate);
    data.awayResults = teamResults(allAway, awayId, gameDate);

    // Last meeting: the most recent finished game with both teams in it, before this game.
    const between = allHome.filter((item) => item.date < gameDate && ((item.home === homeId && item.away === awayId) || (item.home === awayId && item.away === homeId)))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    data.meeting = between ? { ...between, olderSeason: !meetingThisSeason(homeGames) } : null;

    renderMatchupInfo(game, data);
    await standingsPromise;
  } catch (error) {
    console.error("Matchup info failed:", error);
    data.homeResults = data.homeResults || [];
    data.awayResults = data.awayResults || [];
    if (data.meeting === undefined) data.meeting = null;
    if (data.records === undefined) data.records = null;
    renderMatchupInfo(game, data);
  }
}
