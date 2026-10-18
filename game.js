// LineHunter - game.js
// The page for ONE game: the matchup at the top, then every player prop line for that game.
// The game comes from the address bar: game.html?id=12345
// A link can also open one player's drawer right away: game.html?id=12345&player=237&prop=pts
// The shared stats code (requests, game logs, hit rates) lives in js/stats.js.

let allLines = [];       // every line for this game, cleaned up and with player names added
let selectedProp = null; // which prop type the pills are showing, like "points"

// Game logs for every player in the table, filled in by loadPlayerStats().
// gameLogsByPlayer[237] = { current: [...this season, newest first], previous: [...last season] }
let gameLogsByPlayer = {};
let statsLoading = true;         // true until loadPlayerStats() finishes: the table shows placeholders
let showingCurrentSeason = true; // false when nobody has played this season yet: "Season" then means last season

// The table's L5 / L10 / L20 / Season choice (the buttons come from js/propChart.js).
let selectedWindow = 10; // the table's window; the drawer starts on the same one

// Which column the table is sorted by ("hitRate" or "average"), and which way.
let sortKey = "hitRate";
let sortDescending = true;

// L20 (in the player drawer) is the biggest window, so a player needs at least this many played games.
const MOST_GAMES_NEEDED = 20;

// Read "?id=12345&player=237&prop=pts" from the address bar.
const pageParams = new URLSearchParams(window.location.search);
const gameId = pageParams.get("id");
const linkedPlayerId = Number(pageParams.get("player")) || null; // Number("") is 0, so || null = "none"
const linkedPropType = PROP_CODES[pageParams.get("prop")] || null; // "pts" -> "points", unknown -> null

// ---------- Helpers ----------

// Same idea as in app.js: tip-off time, live score, or final score.
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

// One player's games for a window, scored against a line (hitRateForWindow in js/stats.js).
// Used by the table and the drawer, so both always agree.
function windowResult(playerId, stat, line, windowSize) {
  return hitRateForWindow(gameLogsByPlayer[playerId], stat, line, windowSize, showingCurrentSeason);
}

// While stats load, each stat cell shows a small glowing bar instead of a dash.
const STAT_PLACEHOLDER = `<span class="placeholder-glow"><span class="placeholder col-8 rounded"></span></span>`;

// "O -110 · U +105" under the line. Empty if the book didn't send odds.
function oddsText(line) {
  const parts = [];
  if (line.overOdds !== null && line.overOdds !== undefined) parts.push(`O ${formatOdds(line.overOdds)}`);
  if (line.underOdds !== null && line.underOdds !== undefined) parts.push(`U ${formatOdds(line.underOdds)}`);
  return parts.join(" · ");
}

// "70%" in neon green (60%+), red (40% or less), or white, with "7/10" underneath.
function hitRateCell(result) {
  if (result.hitRate === null) return `<span class="text-muted">–</span>`;

  let colorClass = "";
  if (result.hitRate >= 60) colorClass = "lh-hit--good";
  if (result.hitRate <= 40) colorClass = "lh-hit--bad";

  return `
    <div class="lh-hit ${colorClass}">${Math.round(result.hitRate)}%</div>
    <div class="small text-muted">${result.hits}/${result.totalGames}</div>
  `;
}

// Sort rows by the chosen column. Rows with no games always go last, whichever way we sort.
// Ties are broken by the bigger line first.
function compareRows(a, b) {
  const valueA = a.result[sortKey];
  const valueB = b.result[sortKey];

  if (valueA === null && valueB === null) return b.line.line - a.line.line;
  if (valueA === null) return 1;
  if (valueB === null) return -1;
  if (valueA !== valueB) return sortDescending ? valueB - valueA : valueA - valueB;
  return b.line.line - a.line.line;
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

// "points" -> "Points", "points_rebounds_assists" -> "Points + Rebounds + Assists"
function propLabel(propType) {
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
  const message = document.getElementById("lines-message");
  message.className = colorClass;
  message.textContent = text;
  message.classList.remove("d-none");
  document.getElementById("lines-table").classList.add("d-none");
}

// ---------- Drawing on the page ----------

function renderGameHeader(game) {
  document.title = `${game.visitor_team.abbreviation} @ ${game.home_team.abbreviation} · LineHunter`;

  // lh-label / lh-display / display-3 = our label font and big condensed font (styles.css)
  const visitorColor = getNeutralTeamColor(game.visitor_team.abbreviation);
  const homeColor = getNeutralTeamColor(game.home_team.abbreviation);

  document.getElementById("game-header").innerHTML = `
    <div class="card-body p-3 p-md-4">
      <div class="lh-label text-center mb-3">${describeTime(game)}</div>
      <div class="d-flex justify-content-between align-items-center text-center gap-2">
        <div class="flex-fill">
          <div class="lh-display display-5 mb-1" style="color: ${visitorColor}; text-shadow: 0 0 1px rgba(255,255,255,0.8), 0 0 12px rgba(255,255,255,0.12); -webkit-text-stroke: 0.4px rgba(255,255,255,0.35);">${game.visitor_team.abbreviation}</div>
          <div class="text-muted small">${game.visitor_team.full_name}</div>
        </div>
        <div class="lh-label px-2">@</div>
        <div class="flex-fill">
          <div class="lh-display display-5 mb-1" style="color: ${homeColor}; text-shadow: 0 0 1px rgba(255,255,255,0.8), 0 0 12px rgba(255,255,255,0.12); -webkit-text-stroke: 0.4px rgba(255,255,255,0.35);">${game.home_team.abbreviation}</div>
          <div class="text-muted small">${game.home_team.full_name}</div>
        </div>
      </div>
    </div>
  `;
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

// Fill the table with the lines for the selected prop and window.
function renderTable() {
  renderTableWindows();
  updateSortHeaders();

  // 1. Work out the numbers for every row first, so we can sort by them.
  const rows = allLines
    .filter((line) => line.propType === selectedProp)
    .map((line) => {
      const stat = propStatKey(line.propType); // "points_assists" -> "pts+ast"
      const result = stat && !statsLoading
        ? windowResult(line.playerId, stat, line.line, selectedWindow) // each player's own line
        : { hits: 0, totalGames: 0, hitRate: null, average: null, games: [] };
      return { line, result };
    });

  // 2. Sort. While stats are loading every number is null, so this falls back to biggest line first.
  rows.sort(compareRows);

  const body = document.getElementById("lines-body");
  body.innerHTML = "";
  body.setAttribute("aria-busy", String(statsLoading)); // tells screen readers the numbers are still coming

  // 3. One <tr> per row. d-none d-md-table-cell = hidden on phones, shown from tablets up.
  rows.forEach(({ line, result }) => {
    const row = document.createElement("tr");

    // Clicking the row opens the player drawer (player-drawer.js).
    // tabindex="0" lets keyboard users reach the row with Tab and open it with Enter.
    row.className = "lh-clickable-row";
    row.tabIndex = 0;
    row.setAttribute("aria-label", `Show ${line.fullName}'s recent games`);
    row.innerHTML = `
      <td>
        <a class="lh-player-link fw-semibold" href="player.html?id=${line.playerId}">${line.playerName}</a>
        <div class="small text-muted">${line.team}</div>
      </td>
      <td class="text-end">
        <div class="line-value">${line.line}</div>
        <div class="lh-odds small text-muted">${oddsText(line)}</div>
      </td>
      <td class="d-none d-md-table-cell">${statsLoading ? STAT_PLACEHOLDER : miniGraph(result.games)}</td>
      <td class="text-end">${statsLoading ? STAT_PLACEHOLDER : hitRateCell(result)}</td>
      <td class="text-end d-none d-md-table-cell lh-avg">${statsLoading ? STAT_PLACEHOLDER : formatStatValue(result.average)}</td>
    `;

    row.addEventListener("click", (event) => {
      // The name is a link to player.html: let the link do its own thing instead of opening the drawer.
      if (event.target.closest("a")) return;
      openPlayerDrawer(line.playerId);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target === row) openPlayerDrawer(line.playerId);
    });

    body.appendChild(row);
  });

  document.getElementById("lines-message").classList.add("d-none");
  document.getElementById("lines-table").classList.remove("d-none");
}

// ---------- Loading everything ----------

// Download game logs for every player in the table, once (loadPlayerGameLogs in js/stats.js:
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
  if (!linkedPlayerId || !allLines.some((line) => line.playerId === linkedPlayerId)) return;

  if (linkedPropType && propTypes.includes(linkedPropType)) {
    selectedProp = linkedPropType;
    renderPills(propTypes);
    renderTable();
  }
  openPlayerDrawer(linkedPlayerId); // the drawer starts on the table's prop (selectedProp)
}

async function loadPage() {
  if (typeof BDL_API_KEY === "undefined" || BDL_API_KEY === "paste-your-key-here") {
    showLinesMessage("No API key yet. Copy config.example.js to config.js and paste your key in.", "text-danger");
    return;
  }
  if (!gameId) {
    showLinesMessage("No game picked. Go back and click a game card.", "text-danger");
    return;
  }

  try {
    // 1. The game itself, for the header card.
    const gameJson = await bdlGet(`${BDL_BASE}/games/${gameId}`);
    renderGameHeader(gameJson.data);

    // 2. Every prop line for this game, from every sportsbook.
    const propsJson = await bdlGet(`${PROPS_URL}?game_id=${gameId}`);

    // 3. Keep ONE over/under line per player per prop type (pickOneLinePerPlayer in js/stats.js).
    const chosen = pickOneLinePerPlayer(propsJson.data);

    if (chosen.length === 0) {
      showLinesMessage("No prop lines posted for this game yet. Books usually post them the day before or the day of the game.", "text-muted");
      return;
    }

    // 4. The props only have player ids, so ask for the names (up to 100 players per request).
    // new Set(...) removes duplicate ids; [... ] turns it back into a list.
    const playerIds = [...new Set(chosen.map((prop) => prop.player_id))];
    const players = await fetchPlayers(playerIds); // players[237] = { first_name: ..., team: ... }

    // 5. Build clean rows for the table. The stat columns are worked out later, in renderTable.
    allLines = chosen.map((prop) => {
      const player = players[prop.player_id];

      return {
        playerId: prop.player_id,
        playerName: player ? `${player.first_name.charAt(0)}. ${player.last_name}` : `Player #${prop.player_id}`,
        fullName: player ? `${player.first_name} ${player.last_name}` : `Player #${prop.player_id}`,
        team: player && player.team ? player.team.abbreviation : "",
        position: player ? player.position : "",
        propType: prop.prop_type,
        line: Number(prop.line_value), // the API sends "24.5" as text; Number() makes it 24.5
        overOdds: prop.market.over_odds,
        underOdds: prop.market.under_odds,
      };
    });

    // 6. Pills for every prop type found. Start on Points if there is one.
    // The table shows right away with loading bars in the stat columns.
    const propTypes = [...new Set(allLines.map((line) => line.propType))];
    selectedProp = propTypes.includes("points") ? "points" : propTypes[0];

    setUpSortHeaders();
    renderPills(propTypes);
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
