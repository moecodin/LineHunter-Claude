// LineHunter - js/components/schedule-drawer.js
// The player drawer on the SCHEDULE page. Clicking a Top Hit Rates row, its odds chip, a phone ticket or a Hit List player leg opens
// this drawer here instead of loading game.html. Only the matchup cards take you to the game page.
//
// Any link with data-lh-drawer='{ playerId, player, team, opp, gameId, tipoff, code, line, side }' is intercepted (plain left clicks;
// ctrl / middle click still follow the href). The drawer has the same pieces as the game page's: stat tabs, L5 / L10 / L20 / Season,
// the shared prop chart and the prop toolbar (stepper, Over / Under, best odds, Add to My Hunts). The player's games are downloaded
// once per player when the drawer first opens (loadPlayerGameLogs) and kept in memory.
//
// Needs js/core/stats.js, js/components/propChart.js, js/components/prop-toolbar.js, js/data/odds.js and Chart.js loaded first;
// reads topSlate (js/components/top-hit-rates.js) for each prop's book line.

(() => {
  document.body.insertAdjacentHTML("beforeend", `
    <div class="offcanvas offcanvas-end lh-player-drawer" tabindex="-1" id="playerDrawer" aria-labelledby="playerDrawerName">
      <div class="offcanvas-header align-items-start">
        <div>
          <h2 class="lh-display h3 mb-1" id="playerDrawerName">Player</h2>
          <div class="lh-label" id="playerDrawerMeta"></div>
          <div class="d-flex flex-wrap gap-2 mt-2">
            <a id="playerDrawerPageLink" class="btn btn-sm lh-player-page-btn" href="player.html">Go to player page →</a>
            <a id="playerDrawerGameLink" class="btn btn-sm btn-ghost" href="game.html">Game page →</a>
          </div>
        </div>
        <button type="button" class="lh-drawer-close ms-auto" data-bs-dismiss="offcanvas" aria-label="Close"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="offcanvas-body">
        <div id="playerDrawerToolbar"></div>
        <div id="playerDrawerMilestone" class="research-only mb-3"></div>
        <ul id="playerDrawerStats" class="nav nav-underline lh-tabs mb-3"></ul>
        <div id="playerDrawerWindows" class="btn-group btn-group-sm lh-window-toggle mb-3" role="group" aria-label="How many games to show"></div>
        <div id="playerDrawerSummary" class="d-flex gap-4 mb-3"></div>
        <div id="playerDrawerChart"></div>
        <div id="playerDrawerMessage" class="text-muted small mt-2" hidden></div>
      </div>
    </div>`);

  const state = { info: null, propType: "points", windowSize: 10, token: 0 };
  const logCache = {}; // playerId -> { logs, showingCurrentSeason } (a Promise while loading)

  const chart = createPropChart(document.getElementById("playerDrawerChart"), {
    height: 260,
    externalLine: true,
    onLineChange: () => render(),
  });
  const toolbar = createPropToolbar(document.getElementById("playerDrawerToolbar"), {
    statTabs: document.getElementById("playerDrawerStats"),
    onStep: (value) => { chart.setActiveLine(value); render(); },
    onSide: () => render(),
  });

  const el = (id) => document.getElementById(id);
  const optionFor = (propType) => CHART_STAT_TABS.find((tab) => tab.propType === propType);

  // The book line for one prop of this player, from the rows Top Hit Rates already built (null when none).
  function bookLine(playerId, propType) {
    const code = propCode(propType);
    if (code === state.info.code) return state.info.line; // the prop that was clicked starts on the clicked row's line
    const row = typeof topSlate !== "undefined" && topSlate && topSlate.rows.find((item) => item.playerId === playerId && item.code === code && String(item.gameId) === String(state.info.gameId));
    return row ? row.line : null;
  }

  function loadLogs(playerId) {
    if (!logCache[playerId]) {
      logCache[playerId] = loadPlayerGameLogs([playerId], 20)
        .then((loaded) => ({ logs: loaded.logsByPlayer[playerId], showingCurrentSeason: loaded.showingCurrentSeason }))
        .catch((error) => { delete logCache[playerId]; throw error; });
    }
    return logCache[playerId];
  }

  function result(data, line, windowSize) {
    return hitRateForWindow(data.logs, optionFor(state.propType).stat, line ?? 0, windowSize, data.showingCurrentSeason);
  }

  // A new player or prop: start on the book line (or the season average to the nearest .5 when no book posts one).
  function resetLine(data) {
    const stat = optionFor(state.propType).stat;
    const season = data ? hitRateForWindow(data.logs, stat, 0, "season", data.showingCurrentSeason) : null;
    const average = season && season.totalGames ? season.average : null;
    const book = bookLine(state.info.playerId, state.propType);
    chart.setLine({
      book,
      fallback: average === null ? null : Math.max(0.5, Math.round(average * 2) / 2),
      milestone: average === null ? null : Math.max(1, Math.round(average)),
      average,
    });
  }

  function message(html) {
    el("playerDrawerMilestone").textContent = "";
    chart.clear();
    el("playerDrawerSummary").innerHTML = "";
    const box = el("playerDrawerMessage");
    box.innerHTML = html;
    box.hidden = false;
  }

  function renderTabs() {
    const tabs = el("playerDrawerStats");
    tabs.innerHTML = "";
    CHART_STAT_TABS.forEach((option) => {
      const item = document.createElement("li");
      item.className = "nav-item";
      const button = document.createElement("button");
      button.type = "button";
      button.className = option.propType === state.propType ? "nav-link active text-nowrap" : "nav-link text-nowrap";
      button.textContent = option.label;
      button.addEventListener("click", () => {
        state.propType = option.propType;
        toolbar.setSide(null);
        resetLine(state.data || null);
        render();
      });
      item.appendChild(button);
      tabs.appendChild(item);
    });
  }

  function render() {
    const info = state.info;
    if (!info) return;
    const option = optionFor(state.propType);
    const line = lineForScoring(chart.activeLine());
    const data = state.data || null;

    el("playerDrawerName").textContent = `${info.player} `;
    el("playerDrawerName").insertAdjacentHTML("beforeend", teamBadgeHtml(info.team));
    el("playerDrawerMeta").textContent = info.opp ? `${info.team} vs ${info.opp}` : info.team;
    el("playerDrawerPageLink").href = `player.html?id=${info.playerId}&prop=${propCode(state.propType)}`;
    el("playerDrawerGameLink").href = `game.html?id=${info.gameId}&player=${info.playerId}&prop=${propCode(state.propType)}`;

    toolbar.render({
      line: isResearchMode() ? null : chart.activeLine(),
      mainLine: chart.mainLine(),
      stat: state.propType,
      legBase: { playerId: info.playerId, player: info.player, team: info.team, opp: info.opp, gameId: info.gameId, tipoff: info.tipoff, stat: state.propType },
    });
    renderTabs();
    renderWindowButtons(el("playerDrawerWindows"), state.windowSize, (size) => { state.windowSize = size; render(); });

    if (!data) {
      message(`<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Loading games...`);
      return;
    }
    const res = result(data, line, state.windowSize);
    if (res.totalGames === 0) { message("No games played yet."); return; }

    const milestone = chart.activeLine();
    const outOf = typeof state.windowSize === "number" ? `last ${res.totalGames}` : `${res.totalGames} games`;
    el("playerDrawerMilestone").innerHTML = milestone === null ? ""
      : `<strong>${milestone}+ ${propCode(state.propType).toUpperCase()}</strong> in <strong>${res.hits} of ${outOf}</strong> · avg ${formatStatValue(res.average)}`;
    el("playerDrawerSummary").innerHTML = `
      <div class="lines-only">
        <div class="lh-label">Hit rate${chart.isAltLine() ? ` <span class="lh-alt-tag">o${lineText(line)}</span>` : ""}</div>
        <div class="lh-drawer-stat">${line === null ? "–" : `${res.hits}/${res.totalGames} <span class="text-muted">(${Math.round(res.hitRate)}%)</span>`}</div>
      </div>
      <div><div class="lh-label">Average</div><div class="lh-drawer-stat">${formatStatValue(res.average)}</div></div>`;
    const box = el("playerDrawerMessage");
    box.hidden = !(state.windowSize === "season" && !data.showingCurrentSeason);
    box.textContent = "This season hasn't started, so Season shows last season.";
    chart.draw([...res.games].reverse(), `${info.playerId}|${state.propType}|${state.windowSize}`);
  }

  function open(info) {
    state.info = info;
    state.data = null;
    state.propType = PROP_CODES[info.code] || "points";
    state.windowSize = typeof topWindow !== "undefined" ? topWindow : 10;
    toolbar.setSide(info.side);
    const token = ++state.token;
    // Start on the clicked row's line, before the games arrive (the stepper and odds work straight away).
    resetLine(null);
    render();
    bootstrap.Offcanvas.getOrCreateInstance(el("playerDrawer")).show();
    loadLogs(info.playerId).then((data) => {
      if (token !== state.token) return;
      state.data = data;
      if (isResearchMode()) resetLine(data); // the milestone starts from the season average (needs the games)
      render();
    }).catch(() => {
      if (token === state.token) message("Couldn't load this player's games. Try again in a moment.");
    });
  }

  // Capture phase, before any row / card handlers. Modified clicks keep the normal link behavior.
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-lh-drawer]");
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.target.closest("[data-hunt-add]")) return;
    let info;
    try { info = JSON.parse(link.dataset.lhDrawer); } catch (error) { return; }
    event.preventDefault();
    open(info);
  });

  document.addEventListener("lh-mode-change", () => render());

  // Closing the drawer forgets the chosen side (opening a player or prop sets it again from the link, or starts with none).
  el("playerDrawer").addEventListener("hidden.bs.offcanvas", () => { toolbar.setSide(null); });
})();

