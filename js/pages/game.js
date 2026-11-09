// LineHunter - js/pages/game.js
// The page for ONE game: the matchup at the top, then every player prop line for that game.
// The game comes from the address bar: game.html?id=12345
// A link can also open one player's row on The Board right away: game.html?id=12345&player=237&prop=pts&side=under
// The shared stats code (requests, game logs, hit rates) lives in js/core/stats.js.

let allLines = [];       // every line for this game, cleaned up and with player names added
let playersById = {};    // EVERY player in this game (both rosters), with or without a line: playersById[237] = { playerId, playerName, fullName, team, position }
let selectedProp = null; // which prop type the pills are showing, like "points"

// Game logs for every player in the table, filled in by loadPlayerStats().
// gameLogsByPlayer[237] = { current: [...this season, newest first], previous: [...last season] }
let gameLogsByPlayer = {};
let statsLoading = true;         // true until loadPlayerStats() finishes: the table shows placeholders
let showingCurrentSeason = true; // false when nobody has played this season yet: "Season" then means last season

// The table's L5 / L10 / L20 / Season choice (the buttons come from js/components/propChart.js).
let selectedWindow = 10; // the table's window; the drawer starts on the same one

// Which column the table is sorted by ("hitRate" or "average"), and which way.
let sortKey = isResearchMode() ? "average" : "hitRate"; // hit rates are measured against a line, so research mode sorts by average
let sortDescending = true;

// L20 (in the player drawer) is the biggest window, so a player needs at least this many played games.
const MOST_GAMES_NEEDED = 20;

// Read "?id=12345&player=237&prop=pts" from the address bar.
const pageParams = new URLSearchParams(window.location.search);
const gameId = pageParams.get("id");
const linkedPlayerId = Number(pageParams.get("player")) || null; // Number("") is 0, so || null = "none"
const linkedPropType = PROP_CODES[pageParams.get("prop")] || null; // "pts" -> "points", unknown -> null
const linkedSide = ["over", "under"].includes(pageParams.get("side")) ? pageParams.get("side") : null; // ?side=under: that side starts picked in the drawer

// ---------- Helpers ----------

// Same idea as in js/pages/app.js: tip-off time, live score, or final score.
function describeTime(game) {
  if (game.status === "Final") {
    return `Final: ${game.visitor_team_score} - ${game.home_team_score}`;
  }
  if (game.period > 0) {
    return `LIVE · ${game.status} · ${game.visitor_team_score} - ${game.home_team_score}`;
  }
  const tipOff = new Date(game.datetime || game.date);
  return tipOff.toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// One player's games for a window, scored against a line (hitRateForWindow in js/core/stats.js).
// Used by the table and the drawer, so both always agree.
function windowResult(playerId, stat, line, windowSize) {
  return hitRateForWindow(gameLogsByPlayer[playerId], stat, line, windowSize, showingCurrentSeason);
}

// While stats load, each stat cell shows a small glowing bar instead of a dash.
const STAT_PLACEHOLDER = `<span class="placeholder-glow"><span class="placeholder col-8 rounded"></span></span>`;

// One side of a line as a My Hunts leg (js/core/hunts.js). lineValue / isAlt: the drawer can pass an alt line (no odds then).
function huntLegFor(item, side, lineValue = item.line, isAlt = false) {
  const game = currentGame;
  let opp = "";
  if (game) opp = item.team === game.home_team.abbreviation ? game.visitor_team.abbreviation : game.home_team.abbreviation;
  return {
    playerId: item.playerId,
    player: item.fullName,
    team: item.team,
    opp,
    gameId: game ? game.id : Number(gameId),
    tipoff: game ? game.datetime || null : null,
    stat: item.propType,
    side,
    line: lineValue,
    odds: isAlt ? null : side === "over" ? item.overOdds : item.underOdds,
    book: isAlt ? "" : item.book,
    isAlt,
  };
}

// Sort rows by the chosen column. Rows with no games always go last, whichever way we sort.
// Rows without a line have no hit rate, so they sit after the rows that have one (best average first).
// Ties are broken by the bigger line first.
function compareRows(a, b) {
  const valueA = a.result[sortKey];
  const valueB = b.result[sortKey];
  const lineSize = (row) => (row.line ? row.line.line : 0);

  if (valueA === null && valueB === null) {
    if (a.line && !b.line) return -1;
    if (!a.line && b.line) return 1;
    if (!a.line && !b.line) return (b.result.average ?? -1) - (a.result.average ?? -1);
    return lineSize(b) - lineSize(a);
  }
  if (valueA === null) return 1;
  if (valueB === null) return -1;
  if (valueA !== valueB) return sortDescending ? valueB - valueA : valueA - valueB;
  return lineSize(b) - lineSize(a);
}

// Show which header is sorted, and which way, with a small arrow.
function updateSortHeaders() {
  document.querySelectorAll("th[data-sort]").forEach((header) => {
    const isSorted = header.dataset.sort === sortKey;
    // aria-sort tells screen readers how the table is sorted.
    header.setAttribute("aria-sort", isSorted ? (sortDescending ? "descending" : "ascending") : "none");
    header.querySelector("i").className = isSorted
      ? (sortDescending ? "bi bi-caret-down-fill" : "bi bi-caret-up-fill")
      : "bi bi-caret-down-fill opacity-25";
  });
}

// The order of the prop pills. Any prop type not listed here goes after these, in the order the API sent it.
const PROP_PILL_ORDER = [
  "points", "rebounds", "assists", "threes",
  "points_assists", "rebounds_assists", "points_rebounds", "points_rebounds_assists",
  "blocks", "steals",
];

// Short names for the combo props, matching the player page tabs ("P+R+A").
const COMBO_PILL_LABELS = {
  points_assists: "P+A",
  rebounds_assists: "R+A",
  points_rebounds: "P+R",
  points_rebounds_assists: "P+R+A",
};

// "points" -> "Points", "threes" -> "Threes", "points_rebounds_assists" -> "P+R+A"
function propLabel(propType) {
  if (COMBO_PILL_LABELS[propType]) return COMBO_PILL_LABELS[propType];
  return propType
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" + ");
}

// "draftkings" -> "Draftkings" (good enough for now)
function bookLabel(vendor) {
  return vendor[0].toUpperCase() + vendor.slice(1);
}

function showLinesMessage(text, colorClass) {
  document.getElementById("linesToggle").hidden = true;
  const message = document.getElementById("lines-message");
  message.className = colorClass;
  message.textContent = text;
  message.classList.remove("d-none");
  document.getElementById("lines-table").classList.add("d-none");
  document.dispatchEvent(new CustomEvent("lh-top-slate", { detail: { message: `<span class="${colorClass}">${huntAttr(text)}</span>` } })); // lines mode: The Board shows it
}

// ---------- Drawing on the page ----------

let currentGame = null; // the game on this page (set by renderGameHeader): the team badges use its away / home pair

// A team abbreviation badge in the team's color, with the matchup's clash rule applied.
function gameTeamBadge(team) {
  return currentGame
    ? teamBadgeHtml(team, currentGame.visitor_team.abbreviation, currentGame.home_team.abbreviation)
    : teamBadgeHtml(team);
}

// The header (indigo restyle, the beta's game card at full width): time + arena on top, then the away team's color with the home
// team's as a slanted wedge and a thin ice seam, both abbreviations, team names, moneylines (#mlAway / #mlHome, filled by
// loadGameLines) and the season record + last-5 dots (#recordAway / #formAway..., filled by js/components/matchupInfo.js).
// Colors: each team's main color (the secondary when the primary vanishes on the page), the away team on its secondary when the
// two clash; text white or dark, whichever reads.
function gameHeaderColors(away, home) {
  let a = teamBaseColor(away);
  const h = teamBaseColor(home);
  if (colorDistance(a, h) < COLOR_CLASH_DISTANCE && TEAM_INFO[away]) a = TEAM_INFO[away].colors.secondary;
  return `--away:${a};--away-text:${readableTextOn(a)};--home:${h};--home-text:${readableTextOn(h)}`;
}

function renderGameHeader(game) {
  currentGame = game;
  const away = game.visitor_team;
  const home = game.home_team;
  document.title = `${away.abbreviation} @ ${home.abbreviation} · LineHunter`;
  const day = new Date(`${game.date.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const when = game.status === "Final" || game.period > 0 ? `${day} · ${describeTime(game)}` : `${day} · ${describeTime(game).split(", ").pop()}`;
  const info = TEAM_INFO[home.abbreviation] || {};
  const arena = info.arena ? ` · ${info.arena}, ${info.city || home.city}` : "";
  const team = (t, side) => `
      <div class="lh-gp-team${side === "home" ? " is-home" : ""}">
        <div><span class="lh-gp-abbr">${t.abbreviation}</span><span class="lh-gp-name">${t.name || t.full_name}</span></div>
        <div>
          <span class="lh-gp-ml lines-only" id="ml${side === "home" ? "Home" : "Away"}"></span>
          <span class="lh-gp-rec"><span id="record${side === "home" ? "Home" : "Away"}"></span> <span class="lh-hdr-form" id="form${side === "home" ? "Home" : "Away"}"></span></span>
        </div>
      </div>`;
  document.getElementById("game-header").innerHTML = `
    <div class="lh-gp-time">${when}${arena}</div>
    <h1 class="lh-gp-body" data-away="${away.abbreviation}" data-home="${home.abbreviation}" style="${gameHeaderColors(away.abbreviation, home.abbreviation)}">
      <span class="visually-hidden">${away.full_name} at ${home.full_name}</span>
      ${team(away, "away")}
      <span class="lh-gp-at" aria-hidden="true">@</span>
      ${team(home, "home")}
    </h1>`;
  if (typeof setPlayerJumpName === "function") setPlayerJumpName(`${away.abbreviation} @ ${home.abbreviation}`);
}

// Moneylines in the header and the spread / total in the fact strip: one odds request for this game; the Sportsbook filter's book,
// else DraftKings, else the first book posting a moneyline.
async function loadGameLines(game) {
  const spreadEl = document.getElementById("gameSpread");
  const totalEl = document.getElementById("gameTotal");
  const bookEl = document.getElementById("gameBook");
  const lineMsg = (message) => { if (spreadEl) spreadEl.textContent = message; if (totalEl) totalEl.textContent = ""; if (bookEl) bookEl.textContent = ""; };
  try {
    const json = await bdlGet(`/api/bdl/nba/v2/odds?game_ids[]=${game.id}`);
    const rows = (json.data || []).filter((row) => row.game_id === game.id);
    const chosen = typeof lhOdds !== "undefined" && lhOdds.getBook ? lhOdds.getBook() : null;
    const row = rows.find((r) => r.vendor === chosen && r.moneyline_home_odds != null)
      || rows.find((r) => r.vendor === "draftkings" && r.moneyline_home_odds != null)
      || rows.find((r) => r.moneyline_home_odds != null) || rows[0];
    const fmt = (n) => (n == null || n === "" ? "" : Number(n) > 0 ? `+${Number(n)}` : `−${Math.abs(Number(n))}`);
    const mlAway = document.getElementById("mlAway");
    const mlHome = document.getElementById("mlHome");
    if (!row) { lineMsg("Not posted yet"); return; }
    if (mlAway) mlAway.textContent = fmt(row.moneyline_away_odds);
    if (mlHome) mlHome.textContent = fmt(row.moneyline_home_odds);
    const spread = Number(row.spread_home_value);
    const fav = spread <= 0 ? game.home_team.abbreviation : game.visitor_team.abbreviation;
    const book = typeof lhHunts !== "undefined" ? lhHunts.bookLabel(row.vendor) : row.vendor;
    if (spreadEl) spreadEl.textContent = Number.isFinite(spread) ? `${fav} ${spread === 0 ? "PK" : `−${Math.abs(spread)}`}` : "–";
    if (totalEl) totalEl.textContent = row.total_value != null ? Number(row.total_value) : "–";
    if (bookEl) bookEl.textContent = `Lines from ${book}`;
  } catch (error) {
    lineMsg("Unavailable");
  }
}

// "‹ Earlier: MIA @ WAS" / "Next: LAL @ DET ›": the games before and after this one on the same day, by tip-off.
async function loadGameNeighbors(game) {
  const box = document.getElementById("gameNeighbors");
  if (!box) return;
  try {
    const day = game.date.slice(0, 10);
    const json = await bdlGet(`${BDL_BASE}/games?start_date=${day}&end_date=${day}&per_page=25`);
    const games = (json.data || []).sort((a, b) => new Date(a.datetime || a.date) - new Date(b.datetime || b.date) || a.id - b.id);
    const index = games.findIndex((item) => item.id === game.id);
    if (index === -1) return;
    const label = (item) => `${item.visitor_team.abbreviation} @ ${item.home_team.abbreviation}`;
    const prev = games[index - 1];
    const next = games[index + 1];
    box.innerHTML = `${prev ? `<a href="game.html?id=${prev.id}" class="is-prev"><i class="bi bi-chevron-left" aria-hidden="true"></i> ${label(prev)}</a>` : ""}${next ? `<a href="game.html?id=${next.id}">Next: ${label(next)} <i class="bi bi-chevron-right" aria-hidden="true"></i></a>` : ""}`;
  } catch (error) { /* no neighbors: nothing shows */ }
}

// One pill button per prop type. Clicking one shows that prop's lines.
function renderPills(propTypes) {
  const pills = document.getElementById("prop-pills");
  pills.innerHTML = "";

  propTypes.forEach((propType) => {
    const item = document.createElement("li");
    item.className = "nav-item";

    const button = document.createElement("button");
    button.type = "button";
    // text-nowrap = keep long names like "Points + Rebounds" on one line
    button.className = propType === selectedProp ? "nav-link active text-nowrap" : "nav-link text-nowrap";
    button.textContent = propLabel(propType);
    button.addEventListener("click", () => {
      selectedProp = propType;
      renderPills(propTypes); // redraw so the new pill is highlighted
      renderTable();          // renderTable sorts again with the new prop's numbers
    });

    item.appendChild(button);
    pills.appendChild(item);
  });
}

// The L5 / L10 / L20 / Season buttons above the table. Changing it redraws (and re-sorts) the table.
function renderTableWindows() {
  renderWindowButtons(document.getElementById("table-windows"), selectedWindow, (size) => {
    selectedWindow = size;
    renderTableWindows();
    renderTable();
  });

  // "Season" before the new season starts means last season: say so next to the buttons.
  document.getElementById("table-window-note").hidden =
    statsLoading || showingCurrentSeason || selectedWindow !== "season";
}

// Clicking the Hit % or Avg header: same column flips the direction, a new column starts highest first.
function setUpSortHeaders() {
  document.querySelectorAll("th[data-sort] button").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.closest("th").dataset.sort;
      if (key === sortKey) {
        sortDescending = !sortDescending;
      } else {
        sortKey = key;
        sortDescending = true;
      }
      renderTable();
    });
  });
}

// ---------- Top 5 rows, "Show all players" ----------
// Both modes' tables put the first 5 rows (in the current sort / prop tab / window order) in #lines-body and the rest in
// a second table body that a Bootstrap collapse shows. The collapse keeps its open / closed state when the tab, window or
// sort changes, because only the rows inside it are replaced.
const LINES_DEFAULT_ROWS = 5;
let linesTotal = 0;

function updateLinesToggle(total) {
  linesTotal = total;
  const button = document.getElementById("linesToggle");
  button.hidden = total <= LINES_DEFAULT_ROWS;
  const isOpen = document.getElementById("lines-more").classList.contains("show");
  document.getElementById("linesToggleText").textContent = isOpen ? "Show fewer" : `Show all players (${total})`;
}

["shown.bs.collapse", "hidden.bs.collapse"].forEach((eventName) => {
  document.getElementById("lines-more").addEventListener(eventName, () => updateLinesToggle(linesTotal));
});

// rowElements = every <tr>, already in order.
function placeRows(rowElements) {
  const body = document.getElementById("lines-body");
  const more = document.getElementById("lines-more");
  body.innerHTML = "";
  more.innerHTML = "";
  rowElements.forEach((row, index) => (index < LINES_DEFAULT_ROWS ? body : more).appendChild(row));
  updateLinesToggle(rowElements.length);
}

// ---------- Research mode: "Player Stats" ----------
// Same table, but about stats instead of lines: the top 8 players per team by minutes, each with a milestone
// (their season average for the selected stat, rounded to a whole number, at least 1) and "25+ in 7/10".

// "34" or "34:12" -> 34 (or 34.2)
function logMinutes(min) {
  const [minutes, seconds] = String(min || "0").split(":");
  return (Number(minutes) || 0) + (Number(seconds) || 0) / 60;
}

// Average minutes in the season the table is using (this season, or last season if it hasn't started).
function minutesPerGame(playerId) {
  const logs = gameLogsByPlayer[playerId];
  if (!logs) return 0;
  const played = (showingCurrentSeason ? logs.current : logs.previous).filter(playedInGame);
  return played.length ? played.reduce((total, log) => total + logMinutes(log.min), 0) / played.length : 0;
}

// The 8 players with the most minutes on each team (anyone with no minutes is left out).
function topPlayersByMinutes(people, perTeam) {
  const byTeam = {};
  people.forEach((player) => {
    (byTeam[player.team] = byTeam[player.team] || []).push(player);
  });
  return Object.values(byTeam).flatMap((team) =>
    team.map((player) => ({ player, minutes: minutesPerGame(player.playerId) }))
      .filter((item) => item.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, perTeam)
      .map((item) => item.player)
  );
}

function renderResearchTable() {
  const stat = propStatKey(selectedProp);
  const people = statsLoading ? Object.values(playersById) : topPlayersByMinutes(Object.values(playersById), 8);

  const rows = people.map((player) => {
    let result = { hits: 0, totalGames: 0, hitRate: null, average: null, games: [] };
    let milestone = null;
    if (stat && !statsLoading && gameLogsByPlayer[player.playerId]) {
      const seasonAverage = windowResult(player.playerId, stat, 0, "season").average;
      milestone = seasonAverage === null ? null : Math.max(1, Math.round(seasonAverage));
      // "25+" means >= 25: every stat is a whole number, so that is "above 24.5".
      result = windowResult(player.playerId, stat, milestone === null ? 0 : milestone - 0.5, selectedWindow);
    }
    return { player, line: null, milestone, result };
  });

  rows.sort(compareRows); // by Avg, highest first (the default sort in research mode)

  const body = document.getElementById("lines-body");
  body.setAttribute("aria-busy", String(statsLoading));
  const rowElements = [];

  rows.forEach(({ player, milestone, result }) => {
    const row = document.createElement("tr");
    row.className = "lh-clickable-row";
    row.tabIndex = 0;
    row.setAttribute("aria-label", `Show ${player.fullName}'s recent games`);
    row.innerHTML = `
      <td>
        <a class="lh-player-link fw-semibold" href="player.html?id=${player.playerId}">${player.playerName}</a>
        ${gameTeamBadge(player.team)}
      </td>
      <td class="text-end lh-avg">${statsLoading ? STAT_PLACEHOLDER : formatStatValue(result.average)}</td>
      <td class="d-none d-md-table-cell">${statsLoading ? STAT_PLACEHOLDER : miniGraph(result.games)}</td>
      <td class="text-end">${statsLoading ? STAT_PLACEHOLDER : (milestone === null || result.totalGames === 0 ? `<span class="text-muted">–</span>` : `<strong>${milestone}+</strong> in ${result.hits}/${result.totalGames}`)}</td>
    `;
    // The row opens the player page (on the table's stat).
    const playerPage = `player.html?id=${player.playerId}&prop=${propCode(selectedProp) || "pts"}`;
    row.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      window.location.href = playerPage;
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target === row) window.location.href = playerPage;
    });
    rowElements.push(row);
  });

  placeRows(rowElements);
  document.getElementById("lines-message").classList.add("d-none");
  document.getElementById("lines-table").classList.remove("d-none");
}

// ---------- Lines mode: The Board for this game (js/components/board.js) ----------
// The page hands The Board a "slate" made from the data it already downloaded: one row per posted line (the consensus line per
// player + prop) with each window's games, the injuries and the tip-off. The Board draws the rows, the filter bar and the breakdown
// that opens in place (no drawer). A link like game.html?id=1&player=237&prop=pts&side=under opens that player's row.

const PROP_CODES_ALL = PL_STAT_TABS.filter((tab) => tab.code !== "all").map((tab) => tab.code);
let boardLinkDone = false;

function onGameInjuriesLoaded() {
  if (!isResearchMode() && !statsLoading) sendBoardSlate();
}

function sendBoardSlate() {
  const game = currentGame;
  if (!game) return;
  const matchup = (team) => (team === game.home_team.abbreviation ? `vs ${game.visitor_team.abbreviation}` : `@ ${game.home_team.abbreviation}`);
  const rows = allLines
    .filter((item) => PROP_CODES_ALL.includes(propCode(item.propType)) && gameLogsByPlayer[item.playerId])
    .map((item) => {
      const stat = propStatKey(item.propType);
      const w = {};
      [5, 10, 20].forEach((size) => {
        const result = windowResult(item.playerId, stat, item.line, size);
        w[size] = { totalGames: result.totalGames, games: result.games };
      });
      return {
        gameId: game.id, playerId: item.playerId, name: item.fullName, team: item.team,
        matchup: matchup(item.team), tip: game.datetime || game.date, gameLabel: `${game.visitor_team.abbreviation} @ ${game.home_team.abbreviation}`,
        opp: item.team === game.home_team.abbreviation ? game.visitor_team.abbreviation : game.home_team.abbreviation,
        code: propCode(item.propType), line: item.line, w,
      };
    });
  const slate = { date: game.date, rows, injuries: window.gameInjuryStatus || {}, tips: { [game.id]: game.datetime || null } };
  if (!boardLinkDone && linkedPlayerId && typeof boardOpenLinked === "function") {
    boardLinkDone = true;
    boardOpenLinked(game.id, linkedPlayerId, linkedPropType ? propCode(linkedPropType) : null, linkedSide);
  }
  if (rows.length === 0) {
    document.dispatchEvent(new CustomEvent("lh-top-slate", { detail: { message: `<span class="text-muted">No prop lines posted for this game yet. Books usually post them the day before or the day of the game.</span>` } }));
    return;
  }
  document.dispatchEvent(new CustomEvent("lh-top-slate", { detail: { slate } }));
}

// Fill the table with the lines for the selected prop and window.
function renderTable() {
  if (isResearchMode()) {
    renderTableWindows();
    updateSortHeaders();
    renderResearchTable();
    return;
  }
  if (!statsLoading) sendBoardSlate();
}

// ---------- Loading everything ----------

// Download game logs for every player in the table, once (loadPlayerGameLogs in js/core/stats.js:
// many players per request, plus last season for anyone short on games this season).
// Switching tabs or windows afterwards needs no new requests: everything re-reads these logs.
async function loadPlayerStats(playerIds) {
  const loaded = await loadPlayerGameLogs(playerIds, MOST_GAMES_NEEDED);
  gameLogsByPlayer = loaded.logsByPlayer;
  showingCurrentSeason = loaded.showingCurrentSeason;
}

// Opened from a link like game.html?id=1&player=237&prop=pts: research mode starts the table on that prop
// (lines mode opens that player's row on The Board, see sendBoardSlate).
function openLinkedPlayer(propTypes) {
  if (!linkedPlayerId || !playersById[linkedPlayerId]) return;
  if (linkedPropType && propTypes.includes(linkedPropType)) {
    selectedProp = linkedPropType;
    renderPills(propTypes);
    renderTable();
  }
}

async function loadPage() {
  // The Board is no longer on this page (it lives on Today and in Tools): a link that opened a player's row
  // (game.html?id=&player=&prop=&side=) goes to that player's page on the same prop instead.
  if (linkedPlayerId && !isResearchMode()) {
    const code = pageParams.get("prop") || "pts";
    location.replace(`player.html?id=${linkedPlayerId}&prop=${encodeURIComponent(code)}${linkedSide ? `&side=${linkedSide}` : ""}`);
    return;
  }
  if (!gameId) {
    showLinesMessage("No game picked. Go back and click a game card.", "text-danger");
    return;
  }

  try {
    // 1. The game itself, for the header card.
    const gameJson = await bdlGet(`${BDL_BASE}/games/${gameId}`);
    const game = gameJson.data;
    renderGameHeader(game);
    loadGameLines(game); // moneylines in the header, spread / total in the fact strip
    loadGameNeighbors(game); // the earlier / next game links above the header
    setUpTeamComparison(game); // the Team Comparison panel (js/components/teamCompare.js): closed unless the visitor left it open
    // Model picks (the Game Breakdown) moved to the beta Hunt Score page (hunt-score.html) while the model is in testing.
    if (document.getElementById("gameBreakdown")) setUpGameBreakdown(game);
    loadGameInjuries(game); // the Injury report card beside it (js/components/gameInjuries.js)
    loadMatchupInfo(game); // the Matchup Info card next to it (js/components/matchupInfo.js): loads on its own and never blocks the table

    // 2. Every prop line for this game (from every sportsbook), and both teams' active players, at the same time.
    //    The roster is how we show players the books haven't posted a line for yet. If it fails, we still show the lines.
    const teamParams = `team_ids[]=${game.home_team.id}&team_ids[]=${game.visitor_team.id}`;
    const [propsJson, roster] = await Promise.all([
      bdlGet(`${PROPS_URL}?game_id=${gameId}`),
      bdlGetAllPages(`${BDL_BASE}/players/active?${teamParams}&per_page=100`).catch((error) => {
        console.warn("Rosters unavailable:", error);
        return [];
      }),
    ]);

    // 3. Keep ONE over/under line per player per prop type (pickOneLinePerPlayer in js/core/stats.js).
    const chosen = pickOneLinePerPlayer(propsJson.data);

    // 4. Everyone in the game: the rosters, plus anyone with a line who isn't on them (a just-traded player).
    //    The props only have player ids, so those are looked up by id (up to 100 players per request).
    const people = {};
    roster.forEach((person) => { people[person.id] = person; });
    const missingIds = [...new Set(chosen.map((prop) => prop.player_id))].filter((id) => !people[id]);
    if (missingIds.length > 0) {
      // The props feed sometimes pins a book's line on the wrong player id (a Jazz player on a Thunder-Spurs game). Someone who is not on
      // either active roster only counts when the API says his current team is one of the game's two teams.
      const found = await fetchPlayers(missingIds);
      Object.values(found).forEach((person) => {
        if (person.team && [game.home_team.id, game.visitor_team.id].includes(person.team.id)) people[person.id] = person;
      });
    }

    playersById = {};
    Object.values(people).forEach((person) => {
      playersById[person.id] = {
        playerId: person.id,
        playerName: `${person.first_name.charAt(0)}. ${person.last_name}`,
        fullName: `${person.first_name} ${person.last_name}`,
        team: person.team ? person.team.abbreviation : "",
        position: person.position,
      };
    });
    const playerIds = Object.keys(playersById).map(Number);

    // Every sportsbook's lines go to the best-odds lookup (js/data/odds.js), only for players who are really in this game.
    lhOdds.ingest(propsJson.data.filter((prop) => playersById[prop.player_id]));

    if (playerIds.length === 0) {
      showLinesMessage("No players found for this game yet.", "text-muted");
      return;
    }

    // 5. The lines, as clean rows. The stat columns are worked out later, in renderTable.
    allLines = chosen.filter((prop) => playersById[prop.player_id]).map((prop) => ({
      ...playersById[prop.player_id],
      propType: prop.prop_type,
      line: Number(prop.line_value), // the API sends "24.5" as text; Number() makes it 24.5
      overOdds: prop.market.over_odds,
      underOdds: prop.market.under_odds,
      book: prop.vendor, // the sportsbook (for My Hunts)
    }));

    // 6. Pills for every prop type found. Start on Points if there is one.
    // The table shows right away with loading bars in the stat columns.
    // Pills: every prop the books posted, plus the main five, so a game with no lines yet still has its tabs.
    const CORE_PROPS = ["points", "rebounds", "assists", "threes", "points_rebounds_assists"];
    const found = [...new Set([...allLines.map((line) => line.propType), ...CORE_PROPS])];
    const rank = (propType) => (PROP_PILL_ORDER.includes(propType) ? PROP_PILL_ORDER.indexOf(propType) : PROP_PILL_ORDER.length);
    const propTypes = found.sort((a, b) => rank(a) - rank(b)); // sort is stable: unlisted types keep the API's order
    selectedProp = propTypes.includes("points") ? "points" : propTypes[0];

    setUpSortHeaders();
    renderPills(propTypes);
    renderTable();
    openLinkedPlayer(propTypes); // only does something for links like ?player=237&prop=pts

    // 7. Now the game logs for every player, then redraw with real numbers.
    await loadPlayerStats(playerIds);
    statsLoading = false;
    renderTable();
  } catch (error) {
    console.error(error);
    showLinesMessage(`Couldn't load this game: ${error.message}`, "text-danger");
  }
}

loadPage();

// Theme change: the header's team colors are picked against the page color, so redo them.
document.addEventListener("lh-theme-change", () => {
  const body = document.querySelector(".lh-gp-body");
  if (body) body.setAttribute("style", gameHeaderColors(body.dataset.away, body.dataset.home));
});

// Research mode switched on or off (js/components/nav.js): the Hit % column appears or disappears, so move the sort off (or back to) it.
document.addEventListener("lh-mode-change", () => {
  if (isResearchMode() && sortKey === "hitRate") { sortKey = "average"; sortDescending = true; }
  if (!isResearchMode() && sortKey === "average") { sortKey = "hitRate"; sortDescending = true; }
  renderTable();
});
