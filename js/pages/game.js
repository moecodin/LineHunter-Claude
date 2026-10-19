// LineHunter - js/pages/game.js
// The page for ONE game: the matchup at the top, then every player prop line for that game.
// The game comes from the address bar: game.html?id=12345
// A link can also open one player's drawer right away: game.html?id=12345&player=237&prop=pts
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
  document.getElementById("propList").classList.add("d-none");
}

// ---------- Drawing on the page ----------

let currentGame = null; // the game on this page (set by renderGameHeader): the team badges use its away / home pair

// A team abbreviation badge in the team's color, with the matchup's clash rule applied.
function gameTeamBadge(team) {
  return currentGame
    ? teamBadgeHtml(team, currentGame.visitor_team.abbreviation, currentGame.home_team.abbreviation)
    : teamBadgeHtml(team);
}

function renderGameHeader(game) {
  currentGame = game;
  document.title = `${game.visitor_team.abbreviation} @ ${game.home_team.abbreviation} · LineHunter`;

  // lh-label / lh-display / display-3 = our label font and big condensed font (css/styles.css)
  const visitorShade = getNeutralTeamIndex(game.visitor_team.abbreviation); // which gray (.lh-abbr-N, one set per theme)
  const homeShade = getNeutralTeamIndex(game.home_team.abbreviation);

  document.getElementById("game-header").innerHTML = `
    <div class="card-body p-3 d-flex flex-column justify-content-center">
      <div class="lh-label text-center mb-2">${describeTime(game)}</div>
      <div class="d-flex justify-content-between align-items-center text-center gap-2">
        <div class="flex-fill">
          <div class="lh-display display-6 lh-abbr lh-abbr-${visitorShade}">${game.visitor_team.abbreviation}</div>
          <div class="small text-muted mt-1">${game.visitor_team.full_name}</div>
          <div class="lh-hdr-form" id="formAway"></div>
        </div>
        <div class="lh-label px-2">@</div>
        <div class="flex-fill">
          <div class="lh-display display-6 lh-abbr lh-abbr-${homeShade}">${game.home_team.abbreviation}</div>
          <div class="small text-muted mt-1">${game.home_team.full_name}</div>
          <div class="lh-hdr-form" id="formHome"></div>
        </div>
      </div>
    </div>
  `;
  applyMatchupColors(document.getElementById("game-header"), game.visitor_team.abbreviation, game.home_team.abbreviation);
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
    row.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      openPlayerDrawer(player.playerId);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target === row) openPlayerDrawer(player.playerId);
    });
    rowElements.push(row);
  });

  placeRows(rowElements);
  document.getElementById("lines-message").classList.add("d-none");
  document.getElementById("lines-table").classList.remove("d-none");
}

// ---------- Lines mode: the Player Props rows (same controls and behavior as Top Hit Rates, plain rows) ----------
// The controls bar (L5 / L10 / L20, Filter, Sportsbook, search, chips), the stepper / Over-Under / odds / Add row controls and the math come
// from js/components/prop-list.js, the same code Top Hit Rates uses. This file only decides which rows exist and how a plain row looks.

const PROP_ROWS_SHOWN = 8;                        // rows before "Show all"
const PROP_CODES_ALL = PL_STAT_TABS.filter((tab) => tab.code !== "all").map((tab) => tab.code);
let propTab = "all";                              // "all" | "pts" | "reb" | ...

// playerId -> status from the injury report (js/components/gameInjuries.js), for "Hide injured".
const propBar = createPropListBar({
  idPrefix: "gameProps",
  anchor: document.getElementById("propTabs"),
  windows: [5, 10, 20],
  window: selectedWindow,
  sorts: null,                                    // no Sort control on this page for now
  withGame: false,                                // one game: no Game dropdown
  isInjured: (playerId) => plIsInjuredOut((window.gameInjuryStatus || {})[playerId]),
  onChange: () => renderPropRows(),
  onBar: (state) => { if (!isResearchMode()) selectedWindow = state.window; }, // the drawer starts on the same window
  modeClass: "lines-only",
});

function onGameInjuriesLoaded() {
  if (!isResearchMode() && Object.keys(playersById).length) renderPropRows();
}

function renderPropTabs() {
  const tabs = document.getElementById("propTabs");
  tabs.innerHTML = "";
  propBar.render();
  PL_STAT_TABS.forEach((tab) => {
    const item = document.createElement("li");
    item.className = "nav-item";
    const button = document.createElement("button");
    button.type = "button";
    button.className = tab.code === propTab ? "nav-link active text-nowrap" : "nav-link text-nowrap";
    button.textContent = tab.label;
    button.addEventListener("click", () => {
      propTab = tab.code;
      if (tab.code !== "all") selectedProp = PROP_CODES[tab.code]; // the drawer starts on the table's prop
      renderPropTabs();
      renderPropRows();
    });
    item.appendChild(button);
    tabs.appendChild(item);
  });
}

// The rows that exist for the current tab, window, Filter, Sportsbook and search, in order. Each is
//   { key, spec, line, side, stats }   a row at its line (the chosen sportsbook's own line, or the consensus line)
//   { key, spec, noLine: true, games } a player the books haven't posted this prop for (specific stat tabs only)
function buildPropEntries() {
  const ui = propBar.state;
  const vendor = lhOdds.getBook();
  const codes = propTab === "all" ? PROP_CODES_ALL : [propTab];
  const game = currentGame;
  const entries = [];
  Object.values(playersById).forEach((player) => {
    if (!propBar.rowAllowed(player.fullName, player.playerId, gameId)) return;
    const opp = game ? (player.team === game.home_team.abbreviation ? game.visitor_team.abbreviation : game.home_team.abbreviation) : "";
    codes.forEach((code) => {
      const propType = PROP_CODES[code];
      const stat = propStatKey(propType);
      const consensus = allLines.find((item) => item.playerId === player.playerId && item.propType === propType) || null;
      const games = !statsLoading && gameLogsByPlayer[player.playerId] ? windowResult(player.playerId, stat, 0, ui.window).games : [];
      const spec = {
        playerId: player.playerId, name: player.fullName, team: player.team, opp,
        gameId: game ? game.id : Number(gameId), tipoff: game ? game.datetime || null : null,
        propType, code, games, line: consensus ? consensus.line : null,
      };
      const key = `${player.playerId}|${code}`;
      const resolved = plResolve(spec, ui.side);
      if (resolved) {
        if (!statsLoading && resolved.stats.totalGames < ui.minGames) return;
        entries.push({ key, spec, line: resolved.line, side: resolved.side, stats: resolved.stats });
      } else if (propTab !== "all" && !vendor && ui.side === "both" && !consensus) {
        if (!statsLoading && games.length < ui.minGames) return;
        entries.push({ key, spec, noLine: true, games });
      }
    });
  });

  const full = (entry) => (entry.stats.totalGames >= ui.window ? 1 : 0);
  const average = (entry) => (entry.games.length ? entry.games.reduce((sum, item) => sum + item.value, 0) / entry.games.length : -1);
  entries.sort((a, b) => {
    if (a.noLine || b.noLine) return a.noLine === b.noLine ? average(b) - average(a) : (a.noLine ? 1 : -1); // no-line rows last, best average first
    if (statsLoading) return b.line - a.line;                                                                // nothing to rank by yet: biggest line first
    return (full(b) - full(a)) || (b.stats.hitRate - a.stats.hitRate) || (b.stats.totalGames - a.stats.totalGames) || (b.stats.streak - a.stats.streak);
  });
  return entries;
}

const PROP_PLACEHOLDER = `<span class="placeholder-glow"><span class="placeholder col-8 rounded"></span></span>`;

// One plain row. Desktop (768px and up): player | prop + hit % | count | graph | controls. Phones: a compact two-line row, no stepper; tap opens the drawer.
function propRowHtml(entry, edit = propBar.edits[entry.key]) {
  const { spec } = entry;
  const windowLabel = `L${propBar.state.window}`;
  const open = (line, side) => huntAttr(JSON.stringify(plDrawerData(spec, line, side)));
  const label = `Show ${spec.name}'s recent games`;
  const player = `
    <div class="lh-prow-player">
      <a class="lh-player-link fw-semibold" href="player.html?id=${spec.playerId}">${spec.name}</a>
      ${gameTeamBadge(spec.team)}
      <span class="lh-prow-match">${spec.opp ? `${currentGame && spec.team === currentGame.home_team.abbreviation ? "vs" : "@"} ${spec.opp}` : ""}</span>
    </div>`;

  if (entry.noLine) {
    const avg = entry.games.length ? entry.games.reduce((sum, game) => sum + game.value, 0) / entry.games.length : null;
    const bars = entry.games.map((game) => ({ ...game, overUnder: "none" })); // one color: no line to score against
    return `
      <div class="lh-prow lh-prow--noline" data-pl-row="${entry.key}" data-lh-open="${open(null, null)}" tabindex="0" role="button" aria-label="${label}">
        ${player}
        <div class="lh-prow-prop"><span class="text-muted">No line yet</span> <span class="lh-prow-propname">${PL_PROP_WORDS[spec.code]}</span></div>
        <div class="lh-prow-count">${statsLoading ? PROP_PLACEHOLDER : `<span class="lh-prow-avg">${avg === null ? "–" : `avg ${formatStatValue(avg)}`}</span>`}</div>
        <div class="lh-prow-graph">${statsLoading ? PROP_PLACEHOLDER : miniGraph(bars)}</div>
      </div>`;
  }

  const baseLine = entry.line;
  const line = edit ? edit.line : baseLine;
  const side = edit ? edit.side : entry.side;
  const stats = edit ? { ...entry.stats, ...plStatsAtLine(spec.games, line, side) } : entry.stats;
  let hitClass = "";
  if (stats.hitRate >= 60) hitClass = "lh-hit--good";
  if (stats.hitRate <= 40) hitClass = "lh-hit--bad";
  const shownSide = side || "over";
  const best = side ? plBooks(spec, line, side)[0] || null : null;
  const loading = statsLoading;
  return `
    <div class="lh-prow" data-pl-row="${entry.key}" data-lh-open="${open(line, side)}" tabindex="0" role="button" aria-label="${label}">
      ${player}
      <div class="lh-prow-prop"><strong class="lh-top-side lh-top-side--${shownSide}">${shownSide === "under" ? "Under" : "Over"}</strong> ${lineText(line)} <span class="lh-prow-propname">${PL_PROP_WORDS[spec.code]}</span></div>
      <div class="lh-prow-rate ${hitClass}">${loading ? "" : `${Math.round(stats.hitRate)}%<span>${windowLabel}</span>`}</div>
      <div class="lh-prow-count ${hitClass}">${loading ? PROP_PLACEHOLDER : `${stats.hits}/${stats.totalGames}<span class="lh-prow-avg">avg ${formatStatValue(stats.average)}</span>`}</div>
      <div class="lh-prow-graph">${loading ? PROP_PLACEHOLDER : miniGraph(stats.games)}</div>
      <div class="lh-prow-chip">${best ? `<span class="lh-odds-chip"><b>${plOddsText(best.odds)}</b> ${best.book}</span>` : `<span class="lh-odds-chip lh-odds-chip--none">–</span>`}</div>
      <div class="lh-prow-controls">${plControlsHtml(spec, line, side, baseLine)}</div>
    </div>`;
}

function setLinesMessage(html) {
  const message = document.getElementById("lines-message");
  message.className = "text-muted";
  message.innerHTML = html;
  message.classList.remove("d-none");
  document.getElementById("propList").classList.add("d-none");
}

function renderPropRows() {
  if (isResearchMode()) return;
  const note = document.getElementById("lines-note");
  if (allLines.length === 0) {
    note.textContent = "No prop lines posted for this game yet. Books usually post them the day before or the day of the game.";
    note.hidden = false;
  } else if (propTab !== "all" && !allLines.some((item) => item.propType === PROP_CODES[propTab])) {
    note.textContent = "No lines posted for this prop yet.";
    note.hidden = false;
  } else {
    note.hidden = true;
  }

  const book = lhOdds.getBook();
  if (book && lhOdds.vendors().length === 0) { setLinesMessage("Loading odds..."); return; }
  const entries = buildPropEntries();
  const toggle = document.getElementById("propsToggle");
  if (entries.length === 0) {
    const query = propBar.state.query.trim();
    setLinesMessage(query ? `No players match “${huntAttr(query)}”.`
      : book ? `${lhOdds.vendorName(book)} has no lines for these filters.` : "No players for these filters.");
    toggle.hidden = true;
    return;
  }

  document.getElementById("lines-message").classList.add("d-none");
  const list = document.getElementById("propList");
  list.classList.remove("d-none");
  document.getElementById("propRows").setAttribute("aria-busy", String(statsLoading));
  document.getElementById("propRows").innerHTML = entries.slice(0, PROP_ROWS_SHOWN).map((entry) => propRowHtml(entry)).join("");
  document.getElementById("propRowsMore").innerHTML = entries.slice(PROP_ROWS_SHOWN).map((entry) => propRowHtml(entry)).join("");
  const isOpen = document.getElementById("propRowsMore").classList.contains("show");
  toggle.hidden = entries.length <= PROP_ROWS_SHOWN;
  document.getElementById("propsToggleText").textContent = isOpen ? "Show fewer" : `Show all (${entries.length})`;

  plBindControls(list, {
    edits: propBar.edits,
    find: (key) => buildPropEntries().find((entry) => entry.key === key) || null,
    render: (entry) => propRowHtml(entry),
  });
}

["shown.bs.collapse", "hidden.bs.collapse"].forEach((eventName) => {
  document.getElementById("propRowsMore").addEventListener(eventName, () => {
    const total = document.querySelectorAll("#propRows .lh-prow, #propRowsMore .lh-prow").length;
    document.getElementById("propsToggleText").textContent = document.getElementById("propRowsMore").classList.contains("show") ? "Show fewer" : `Show all (${total})`;
  });
});

// A row (or its odds chip) was clicked: open the player drawer on this page, on that row's prop, line and side. Links, buttons and the
// stepper do their own thing (the player name goes to player.html, + ADD adds to My Hunts).
function openPropDrawer(info) {
  openPlayerDrawer(info.playerId, info.side, PROP_CODES[info.code] || null, info.line);
}
(() => {
  const list = document.getElementById("propList");
  list.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-lh-drawer]");
    if (chip) {
      event.preventDefault();
      openPropDrawer(JSON.parse(chip.dataset.lhDrawer));
      return;
    }
    if (event.target.closest("a, button, input, select, output, .lh-top-linectl")) return;
    const row = event.target.closest("[data-lh-open]");
    if (row) openPropDrawer(JSON.parse(row.dataset.lhOpen));
  });
  list.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !event.target.matches("[data-lh-open]")) return;
    openPropDrawer(JSON.parse(event.target.dataset.lhOpen));
  });
})();

// Fill the table with the lines for the selected prop and window.
function renderTable() {
  if (isResearchMode()) {
    renderTableWindows();
    updateSortHeaders();
    renderResearchTable();
    return;
  }
  renderPropRows();
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

// Opened from a link like game.html?id=1&player=237&prop=pts (the homepage's Top Hit Rates):
// switch the table to that prop and open that player's drawer.
function openLinkedPlayer(propTypes) {
  if (!linkedPlayerId || !playersById[linkedPlayerId]) return;

  if (linkedPropType && propTypes.includes(linkedPropType)) {
    selectedProp = linkedPropType;
    const code = propCode(linkedPropType);
    if (PROP_CODES_ALL.includes(code)) propTab = code;
    renderPills(propTypes);
    renderPropTabs();
    renderTable();
  }
  openPlayerDrawer(linkedPlayerId, linkedSide, linkedPropType); // the drawer starts on the linked prop
}

async function loadPage() {
  if (!gameId) {
    showLinesMessage("No game picked. Go back and click a game card.", "text-danger");
    return;
  }

  try {
    // 1. The game itself, for the header card.
    const gameJson = await bdlGet(`${BDL_BASE}/games/${gameId}`);
    const game = gameJson.data;
    renderGameHeader(game);
    setUpTeamComparison(game); // the Team Comparison panel (js/components/teamCompare.js): closed unless the visitor left it open
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
    renderPropTabs();
    renderTable();
    openLinkedPlayer(propTypes); // only does something for links like ?player=237&prop=pts

    // 7. Now the game logs for every player, then redraw with real numbers.
    await loadPlayerStats(playerIds);
    statsLoading = false;
    renderTable();
    refreshPlayerDrawer(); // if the drawer was opened while stats were loading, fill it in now
  } catch (error) {
    console.error(error);
    showLinesMessage(`Couldn't load this game: ${error.message}`, "text-danger");
  }
}

loadPage();

// Research mode switched on or off (js/components/nav.js): the Hit % column appears or disappears, so move the sort off (or back to) it.
document.addEventListener("lh-mode-change", () => {
  if (isResearchMode() && sortKey === "hitRate") { sortKey = "average"; sortDescending = true; }
  if (!isResearchMode() && sortKey === "average") { sortKey = "hitRate"; sortDescending = true; }
  if (!isResearchMode()) selectedWindow = propBar.state.window; // lines mode: the bar's window rules
  renderTable();
});
