// LineHunter - js/components/player-drawer.js
// The drawer that slides in from the right when you click a row in the props table on game.html.
// It shows one player's recent games as a bar chart against the prop line,
// and lets you try a different ("alt") line to see how often it would have hit.
// The chart, tooltip and alt line control come from js/components/propChart.js (shared with player.html).
//
// Loaded after js/pages/game.js, and uses what js/pages/game.js already has in memory:
//   allLines, playersById, selectedProp, selectedWindow, showingCurrentSeason, statsLoading, windowResult
// So opening the drawer never downloads anything new.

// What the drawer is showing right now. Changing a tab or window updates this, then redraws.
const drawerState = {
  playerId: null,
  propType: "points",
  windowSize: 10,
};

// The shared chart, built inside #playerDrawerChart. − / + / Reset redraw the drawer's numbers.
const drawerChart = createPropChart(document.getElementById("playerDrawerChart"), {
  height: 260,
  onLineChange: () => renderPlayerDrawer(),
});

let drawerView = null; // the numbers behind the chart on screen: the share picture uses them

// ---------- Small helpers ----------

// The player's line for one prop type, or undefined if the books didn't post one.
function findLine(playerId, propType) {
  return allLines.find((line) => line.playerId === playerId && line.propType === propType);
}

// A new player or prop: start from the book's line again (clears any alt line).
function resetDrawerLine() {
  const propLine = findLine(drawerState.playerId, drawerState.propType);
  // Research mode: the milestone starts at the player's season average, rounded (needs the game logs to be loaded).
  const stat = CHART_STAT_TABS.find((tab) => tab.propType === drawerState.propType).stat;
  const average = statsLoading || !gameLogsByPlayer[drawerState.playerId]
    ? null
    : windowResult(drawerState.playerId, stat, 0, "season").average;
  drawerChart.setLine({
    book: propLine ? propLine.line : null,
    milestone: average === null ? null : Math.max(1, Math.round(average)),
    average,
  });
}

// ---------- Drawing ----------

function renderDrawerStatTabs() {
  const tabs = document.getElementById("playerDrawerStats");
  tabs.innerHTML = "";

  CHART_STAT_TABS.forEach((option) => {
    const item = document.createElement("li");
    item.className = "nav-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = option.propType === drawerState.propType ? "nav-link active text-nowrap" : "nav-link text-nowrap";
    button.textContent = option.label;
    button.addEventListener("click", () => {
      drawerState.propType = option.propType;
      resetDrawerLine(); // a new prop starts back on its book line
      renderPlayerDrawer();
    });

    item.appendChild(button);
    tabs.appendChild(item);
  });
}

// The same L5 / L10 / L20 / Season buttons as above the table (renderWindowButtons in js/components/propChart.js).
// Changing them here only changes the drawer, not the table.
function renderDrawerWindows() {
  renderWindowButtons(document.getElementById("playerDrawerWindows"), drawerState.windowSize, (size) => {
    drawerState.windowSize = size;
    renderPlayerDrawer();
  });
}

// Show a message in place of the summary and chart (loading, no games, etc.).
function showDrawerMessage(html) {
  drawerView = null;
  document.getElementById("playerDrawerMilestone").textContent = "";
  document.getElementById("playerDrawerShare").disabled = true;
  drawerChart.clear();
  document.getElementById("playerDrawerSummary").innerHTML = "";
  const message = document.getElementById("playerDrawerMessage");
  message.innerHTML = html;
  message.hidden = false;
}

// Redraw everything inside the drawer from drawerState.
function renderPlayerDrawer() {
  const playerId = drawerState.playerId;
  const anyLine = playersById[playerId]; // everyone in the game, with or without a line (js/pages/game.js)
  if (!anyLine) return;

  const option = CHART_STAT_TABS.find((choice) => choice.propType === drawerState.propType);
  const propLine = findLine(playerId, drawerState.propType);
  // The alt line / book line (lines mode) or the milestone minus 0.5 (research mode: "25+" means >= 25).
  const line = lineForScoring(drawerChart.activeLine());

  // 1. Header: name, team, position, the player page button, and this stat's book line and odds.
  // The team badge sits right next to the name (the name is plain text, so it is escaped before the badge HTML is added).
  const nameBox = document.getElementById("playerDrawerName");
  nameBox.textContent = `${anyLine.fullName} `;
  nameBox.insertAdjacentHTML("beforeend", gameTeamBadge(anyLine.team));
  document.getElementById("playerDrawerMeta").textContent = anyLine.position || "";
  document.getElementById("playerDrawerPageLink").href =
    `player.html?id=${playerId}&prop=${propCode(drawerState.propType)}`; // propCode: "points" -> "pts" (js/core/stats.js)
  document.getElementById("playerDrawerLine").innerHTML = propLine
    ? `<span class="lh-label">${option.label} line</span>
       <span class="lh-drawer-line-value">${propLine.line}</span>
       <span class="lh-drawer-odds">O ${formatOdds(propLine.overOdds)}</span>
       <span class="lh-drawer-odds">U ${formatOdds(propLine.underOdds)}</span>`
    : `<span class="lh-label">${option.label} line</span> <span class="text-muted">No line posted</span>`;

  // 2 + 3. The tabs and the window buttons, with the current choice highlighted.
  renderDrawerStatTabs();
  renderDrawerWindows();

  // Opened before the table's stats finished downloading? Show a spinner. js/pages/game.js redraws us when they arrive.
  if (statsLoading) {
    showDrawerMessage(`<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Loading games...`);
    return;
  }

  // Same games and window rules as the table (windowResult in js/pages/game.js), measured against the active line.
  // It needs a number for the line. Without a line the hits don't mean anything,
  // so we pass 0 and only use the average and the game list.
  const isSeason = drawerState.windowSize === "season";
  const result = windowResult(playerId, option.stat, line ?? 0, drawerState.windowSize);

  if (result.totalGames === 0) {
    showDrawerMessage("No games played yet.");
    return;
  }

  drawerView = { anyLine, option, propLine, line, result };
  document.getElementById("playerDrawerShare").disabled = false;

  // 4. Summary: hit rate and average. With an alt line, the label says which line it's using.
  const hitRateText = line === null
    ? "–"
    : `${result.hits}/${result.totalGames} <span class="text-muted">(${Math.round(result.hitRate)}%)</span>`;
  // Research mode: "25+ PTS in 7 of last 10 · avg 24.3"
  const milestone = drawerChart.activeLine();
  const outOf = typeof drawerState.windowSize === "number" ? `last ${result.totalGames}` : `${result.totalGames} games`;
  document.getElementById("playerDrawerMilestone").innerHTML = milestone === null
    ? ""
    : `<strong>${milestone}+ ${propCode(drawerState.propType).toUpperCase()}</strong> in <strong>${result.hits} of ${outOf}</strong> · avg ${formatStatValue(result.average)}`;

  document.getElementById("playerDrawerSummary").innerHTML = `
    <div class="lines-only">
      <div class="lh-label">Hit rate${drawerChart.isAltLine() ? ` <span class="lh-alt-tag">o${lineText(line)}</span>` : ""}</div>
      <div class="lh-drawer-stat">${hitRateText}</div>
    </div>
    <div>
      <div class="lh-label">Average</div>
      <div class="lh-drawer-stat">${formatStatValue(result.average)}</div>
    </div>
  `;

  const message = document.getElementById("playerDrawerMessage");
  message.hidden = !(isSeason && !showingCurrentSeason);
  message.textContent = "This season hasn't started, so Season shows last season.";

  // 5. The chart (with the alt line control under it). result.games is newest first;
  //    the chart reads left to right, so oldest goes first.
  drawerChart.draw([...result.games].reverse(), `${playerId}|${drawerState.propType}|${drawerState.windowSize}`);
}

// ---------- Opening ----------

// Called by js/pages/game.js when a table row is clicked.
function openPlayerDrawer(playerId) {
  drawerState.playerId = playerId;
  // Start on the same stat as the table, if the drawer has a tab for it. Otherwise Points.
  drawerState.propType = CHART_STAT_TABS.some((option) => option.propType === selectedProp) ? selectedProp : "points";
  drawerState.windowSize = selectedWindow; // start on the same window as the table
  resetDrawerLine();                       // a new player starts back on the book line

  renderPlayerDrawer();
  bootstrap.Offcanvas.getOrCreateInstance(document.getElementById("playerDrawer")).show();
}

// Called by js/pages/game.js once the stats finish loading, in case the drawer is already open.
function refreshPlayerDrawer() {
  if (drawerState.playerId === null) return;
  resetDrawerLine(); // the stats may have just arrived: the research-mode milestone starts from the season average
  renderPlayerDrawer();
}

// The share button: a picture of the chart, with the player, prop, line, hit rate and average (js/components/share.js).
document.getElementById("playerDrawerShare").addEventListener("click", (event) => {
  if (!drawerView) return;
  const { anyLine, option, propLine, line, result } = drawerView;
  let lineLabel = "–";
  if (line !== null) lineLabel = drawerChart.isAltLine() || !propLine ? `${lineText(line)} (alt)` : lineText(line);
  const windowText = drawerState.windowSize === "season" ? "Season" : `L${drawerState.windowSize}`;
  shareChartCard(drawerChart, {
    name: anyLine.fullName,
    meta: [anyLine.team, anyLine.position].filter(Boolean).join(" · "),
    propLabel: option.label,
    filterText: windowText,
    lineText: lineLabel,
    hitRateText: line === null ? "–" : `${result.hits}/${result.totalGames} (${Math.round(result.hitRate)}%)`,
    averageText: formatStatValue(result.average),
  }, event.currentTarget);
});

// Research mode switched on or off (js/components/nav.js): redraw the drawer (the chart drops or gets its line back).
document.addEventListener("lh-mode-change", () => refreshPlayerDrawer());
