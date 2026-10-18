// LineHunter - js/top-hit-rates.js
// The "Top Hit Rates" card: the players who went over their line most often in their last 10 games.
//   - Homepage (index.html): the next slate of games (today, or the next day with games).
//   - Schedule page (schedule.html): the day picked in the date pager. app.js calls showTopHitRatesForDay().
//
// Uses the shared code in js/stats.js. Needs config.js and js/stats.js loaded first.

const TOP_WINDOW = 10;    // L10
const TOP_MIN_GAMES = 8;  // fewer games than this in the window = too small a sample to rank
const TOP_ROW_COUNT = 8;  // how many rows the card shows

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
  if (lines.length === 0) return { date: slate.date, rows: [], legs: [], teamLegs: [] };

  // 3. Names and game logs for every player, both at the same time.
  //    loadPlayerGameLogs asks for many players per request, and adds last season for anyone
  //    with fewer than 10 games this season (the 2026 -> 2025 fallback).
  const playerIds = [...new Set(lines.map((prop) => prop.player_id))];
  const [players, loaded] = await Promise.all([
    fetchPlayers(playerIds),
    loadPlayerGameLogs(playerIds, TOP_WINDOW),
  ]);

  const gamesById = {};
  slate.games.forEach((game) => {
    gamesById[game.id] = game;
  });

  // 4. L10 hit rate for every line, against that player's own line.
  const rows = lines.map((prop) => {
    const line = Number(prop.line_value);
    const result = hitRateForWindow(
      loaded.logsByPlayer[prop.player_id], propStatKey(prop.prop_type), line, TOP_WINDOW, loaded.showingCurrentSeason
    );
    if (result.totalGames < TOP_MIN_GAMES) return null; // small sample: leave it out

    const player = players[prop.player_id];
    const team = player && player.team ? player.team.abbreviation : "";
    return {
      gameId: prop.game_id,
      playerId: prop.player_id,
      name: player ? `${player.first_name} ${player.last_name}` : `Player #${prop.player_id}`,
      team,
      matchup: matchupText(team, gamesById[prop.game_id]),
      code: propCode(prop.prop_type),
      line,
      hits: result.hits,
      totalGames: result.totalGames,
      hitRate: result.hitRate,
      average: result.average,
      games: result.games, // for the mini graph
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

  return { date: slate.date, rows, legs, teamLegs: buildTeamLegs(slate, loaded.logsByPlayer) };
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

// "Top Hit Rates" in big white letters, with the date after it in violet.
function setTopTitle(isoDate) {
  const date = isoDate ? ` <span class="lh-top-title-date">· ${slateDateLabel(isoDate)}</span>` : "";
  document.getElementById("topHitRatesTitle").innerHTML = `Top Hit Rates${date}`;
  const hitListTitle = document.getElementById("hitlistTitle"); // the Hit List card shares the slate
  if (hitListTitle) hitListTitle.innerHTML = `Hit List${date}`;
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
}

function renderTopMessage(html) {
  document.getElementById("topHitRatesPills").hidden = true;
  const list = document.getElementById("topHitRatesList");
  list.removeAttribute("aria-busy");
  list.innerHTML = `<div class="lh-top-message">${html}</div>`;
  if (typeof showHitListMessage === "function") showHitListMessage(html);
}

function renderTopPills() {
  const pills = document.getElementById("topHitRatesPills");
  pills.hidden = false;
  pills.innerHTML = "";

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

function renderTopRows() {
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
          <span class="fw-semibold">${row.name}</span> <span class="lh-top-team">${row.team}</span>
          <div class="small text-muted">${row.matchup}</div>
        </div>
        <div class="lh-top-prop">${row.code.toUpperCase()} o${row.line}</div>
        <div class="lh-top-graph">${miniGraph(row.games)}</div>
        <div class="lh-top-hit ${hitClass}">${row.hits}/${row.totalGames} <span>(${Math.round(row.hitRate)}%)</span></div>
      </a>`;
  }).join("");
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

  renderTopPills();
  renderTopRows();
  updateSlideLink();
  if (typeof showHitList === "function") showHitList(slate);
}

// The shared loading steps for both pages.
//   cacheKey:  where to look in sessionStorage first ("next" or a date)
//   titleDate: the date to show in the header while loading (null if we don't know it yet)
//   getSlate:  how to find the games: returns { date, games }, or null if there are none
async function loadTopHitRates({ cacheKey, titleDate, getSlate }) {
  if (!document.getElementById("top-hit-rates")) return;
  const requestNumber = ++topRequestNumber;

  if (typeof BDL_API_KEY === "undefined" || BDL_API_KEY === "paste-your-key-here") {
    renderTopMessage(`<span class="lh-coming-soon">Coming soon</span>`);
    return;
  }

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
