// LineHunter - js/components/gameTopHits.js
// "Top hit rates" on game.html (lines mode; it replaced The Board there, which now lives on Today and in Tools only).
// This game's props sorted by hit rate, highest first: for each player + prop at its book line, the side that hit more often over
// the window (L5 / L10 / L20), its hit rate and record, a mini graph, the average, the best odds for that side, and Add.
// Filters: All / away / home, the stat (All, PTS, REB, AST, 3PM, PRA) and the window. 8 rows, then 8 more per "Show more".
// A row opens the player page on that prop and side. Props with under 5 games in the window and players listed Out / Doubtful
// (and Questionable / Day-To-Day) are left out.
//
// Data: the rows js/pages/game.js sends with the "lh-top-slate" event (sendBoardSlate: { rows: [{ playerId, name, team, matchup,
// opp, gameId, tip, code, line, w: { 5|10|20: { totalGames, games } } }], injuries }), or { message } while there are none.
// Needs js/core/stats.js (miniGraph, PROP_CODES), js/data/odds.js (lhOdds), js/components/hunt-button.js (huntButtonHtml),
// js/data/teams.js (teamAvatarStyle) and js/components/prop-list.js (plIsInjuredOut).

(function () {
  const card = document.getElementById("gameTopHits");
  if (!card) return;
  const list = document.getElementById("gthList");
  const more = document.getElementById("gthMore");
  const STEP = 8;
  const MIN_GAMES = 5;
  const STAT_LABEL = { pts: "Points", reb: "Rebounds", ast: "Assists", "3pm": "Threes made", pra: "PRA" };
  const STATS = [["all", "All"], ["pts", "PTS"], ["reb", "REB"], ["ast", "AST"], ["3pm", "3PM"], ["pra", "PRA"]];
  const state = { team: "all", stat: "all", window: 10, shown: STEP };
  let slate = null;
  let message = null;

  const hrClass = (pct) => (Math.round(pct) >= 75 ? "is-high" : Math.round(pct) >= 50 ? "is-mid" : "is-low");
  const fmtOdds = (odds) => (odds > 0 ? `+${odds}` : `${odds}`.replace("-", "−"));

  function toggle(host, options, current, onPick) {
    host.innerHTML = options.map(([value, label]) =>
      `<button type="button" class="btn btn-ghost${String(value) === String(current) ? " active" : ""}" aria-pressed="${String(value) === String(current)}" data-value="${value}">${label}</button>`).join("");
    host.onclick = (event) => {
      const button = event.target.closest("button[data-value]");
      if (button) onPick(button.dataset.value);
    };
  }

  function renderControls() {
    const teams = slate ? [...new Set(slate.rows.map((row) => row.team))] : [];
    // Away team first: the row whose matchup starts with "@" is the visitor.
    teams.sort((a, b) => (slate.rows.find((row) => row.team === a).matchup.startsWith("@") ? -1 : 1) - (slate.rows.find((row) => row.team === b).matchup.startsWith("@") ? -1 : 1));
    toggle(document.getElementById("gthTeams"), [["all", "All"], ...teams.map((team) => [team, team])], state.team, (value) => { state.team = value; state.shown = STEP; render(); });
    toggle(document.getElementById("gthStats"), STATS, state.stat, (value) => { state.stat = value; state.shown = STEP; render(); });
    toggle(document.getElementById("gthWindows"), [[5, "L5"], [10, "L10"], [20, "L20"]], state.window, (value) => { state.window = Number(value); state.shown = STEP; render(); });
  }

  // One entry per row: the side that hit more often in the window.
  function scored() {
    const injuries = (slate && slate.injuries) || {};
    return slate.rows.map((row) => {
      const win = row.w[state.window] || { games: [] };
      const games = win.games || [];
      if (games.length < MIN_GAMES) return null;
      if (typeof plIsInjuredOut === "function" && plIsInjuredOut(injuries[row.playerId])) return null;
      const overs = games.filter((game) => game.overUnder === "over").length;
      const unders = games.filter((game) => game.overUnder === "under").length;
      const side = unders > overs ? "under" : "over";
      const hits = Math.max(overs, unders);
      const avg = games.reduce((sum, game) => sum + game.value, 0) / games.length;
      const propType = PROP_CODES[row.code] || row.code;
      const books = typeof lhOdds !== "undefined" ? lhOdds.getOdds(row.playerId, propType, row.line, side) : [];
      return { row, games, side, hits, n: games.length, pct: (hits / games.length) * 100, avg, propType, best: books[0] || null, others: Math.max(books.length - 1, 0) };
    }).filter(Boolean)
      .filter((item) => state.team === "all" || item.row.team === state.team)
      .filter((item) => state.stat === "all" || item.row.code === state.stat)
      .sort((a, b) => b.pct - a.pct || b.n - a.n || Math.abs(b.avg - b.row.line) - Math.abs(a.avg - a.row.line));
  }

  function rowHtml(item) {
    const { row } = item;
    const [first, ...rest] = row.name.split(" ");
    const href = `player.html?id=${row.playerId}&prop=${encodeURIComponent(row.code)}&side=${item.side}`;
    const sideWord = item.side === "under" ? "Under" : "Over";
    const leg = {
      playerId: row.playerId, player: row.name, team: row.team, opp: row.opp, gameId: row.gameId, tipoff: row.tip || null,
      stat: item.propType, side: item.side, line: row.line,
      odds: item.best ? item.best.odds : null, book: item.best ? item.best.book : null, isAlt: false,
    };
    const avatarStyle = typeof teamAvatarStyle === "function" ? teamAvatarStyle(row.team) : "";
    return `
      <div class="lh-gth-row" data-href="${href}">
        <div class="lh-gth-who">
          <span class="lh-avatar" data-player-id="${row.playerId}" data-avatar-team="${row.team}" style="${avatarStyle}" aria-hidden="true">${(first || "")[0] || ""}${(rest.join(" ") || "")[0] || ""}</span>
          <span class="lh-gth-name"><a href="${href}">${row.name}</a><small>${row.team} · ${row.matchup}</small></span>
        </div>
        <div class="lh-gth-pick is-${item.side}"><b>${sideWord} ${lineText(row.line)}</b><small>${STAT_LABEL[row.code] || row.code.toUpperCase()}</small></div>
        <div class="lh-gth-hit"><b class="${hrClass(item.pct)}">${Math.round(item.pct)}%</b><small>${item.hits}/${item.n}</small><span class="lh-gth-mini">${miniGraph(item.games)}</span></div>
        <div class="lh-gth-avg"><b>${item.avg.toFixed(1)}</b><small>avg</small></div>
        <div class="lh-gth-odds">${item.best ? `<b>${fmtOdds(item.best.odds)}</b><small>${item.best.book}${item.others ? ` · +${item.others}` : ""}</small>` : `<small>No odds</small>`}</div>
        <div class="lh-gth-add">${item.best ? huntButtonHtml(leg, { label: "ADD", iconFirst: true, className: "lh-hs-add" }) : ""}</div>
        <i class="bi bi-chevron-right lh-gth-chev" aria-hidden="true"></i>
      </div>`;
  }

  function render() {
    list.removeAttribute("aria-busy");
    if (!slate) {
      list.innerHTML = `<div class="text-muted py-3">${message || "Loading props..."}</div>`;
      more.hidden = true;
      return;
    }
    renderControls();
    const items = scored();
    if (!items.length) {
      list.innerHTML = `<div class="text-muted py-3">No props with ${MIN_GAMES}+ games in this window match these filters.</div>`;
      more.hidden = true;
      return;
    }
    list.innerHTML = items.slice(0, state.shown).map(rowHtml).join("");
    more.hidden = items.length <= state.shown;
    more.textContent = `Show ${Math.min(STEP, items.length - state.shown)} more`;
  }

  more.addEventListener("click", () => { state.shown += STEP; render(); });
  // A row opens the player page (the name is a real link; Add and links keep their own clicks).
  list.addEventListener("click", (event) => {
    if (event.target.closest("a, button")) return;
    const row = event.target.closest(".lh-gth-row");
    if (row) location.href = row.dataset.href;
  });

  document.addEventListener("lh-top-slate", (event) => {
    const detail = event.detail || {};
    if (detail.slate) { slate = detail.slate; message = null; } else if (detail.message) { slate = null; message = detail.message; }
    render();
  });
  document.addEventListener("lh-odds-ready", () => { if (slate) render(); });
  document.addEventListener("lh-book-change", () => { if (slate) render(); });
  document.addEventListener("lh-theme-change", () => { if (slate) render(); });
})();
