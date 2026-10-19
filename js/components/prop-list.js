// LineHunter - js/components/prop-list.js
// The pieces Top Hit Rates (schedule page, js/components/top-hit-rates.js) and the game page's Player Props (js/pages/game.js) share, so a
// fix here fixes both. Only the row design differs (tickets on THR, plain rows on the game page).
//
//   plNameMatches(name, query)            search rule: every typed word starts some word of the name (case and accents ignored)
//   plStatsAtLine(games, line, side)      hits / rate / streak / cushion / graph games for ANY line, from the games already in memory
//   plResolve(spec, sideRule)             one row at the chosen sportsbook's own line (or the consensus line): { line, side, stats } | null
//   plControlsHtml(spec, line, side, baseLine) / plBindControls(list, ctx)
//                                         the row controls: [ - 17.5 + ] [ Over | Under ] [ best odds chip (+N) ] [ + ADD ]. The stepper keeps
//                                         the chosen side, odds follow the line, Add is disabled when the book has no price (no note).
//   plDrawerData(spec, line, side)        what a [data-lh-drawer] link carries (the page opens its player drawer, never navigates)
//   createPropListBar(cfg)                the controls bar: L5 / L10 / L20, Filter (Side, Game, Hide injured, Min games), optional Sort,
//                                         Sportsbook, the search box and the removable chips; phones get Sportsbook inside the Filter sheet.
//
// spec = { playerId, name, team, opp, gameId, tipoff, propType (API type: "points"), code ("pts"), games (newest first, { value }), line }
// Needs js/data/odds.js (lhOdds), js/components/hunt-button.js (huntButtonHtml / huntAttr) and lineText() from js/components/propChart.js.

// The stat tabs (ALL + the five props both pages cover) and the prop names shown on rows.
const PL_STAT_TABS = [
  { code: "all", label: "All" },
  { code: "pts", label: "PTS" },
  { code: "reb", label: "REB" },
  { code: "ast", label: "AST" },
  { code: "3pm", label: "3PM" },
  { code: "pra", label: "PRA" },
];
const PL_PROP_WORDS = { pts: "Points", reb: "Rebounds", ast: "Assists", "3pm": "Threes Made", pra: "PRA" };

// ---------- Search ----------

// "Out", "Doubtful", "Questionable", "Day-To-Day" ... all count as injured except players listed as probable / available.
const plIsInjuredOut = (status) => Boolean(status) && !/probable|available/i.test(status);

const plPlain = (text) => String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function plNameMatches(name, query) {
  const tokens = plPlain(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const words = plPlain(name).split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.every((token) => words.some((word) => word.startsWith(token)));
}

// ---------- The numbers at any line ----------

// games = [{ value, ... }] newest first. Over = value above the line, Under = below it, equal = a push (neither).
// For the under side the mini graph swaps the colors, so a colored bar always means "hit".
function plStatsAtLine(games, line, side) {
  const scored = games.map((game) => ({ ...game, overUnder: game.value > line ? "over" : game.value < line ? "under" : "push" }));
  const name = side || "over";
  const hits = scored.filter((game) => game.overUnder === name).length;
  let streak = 0;
  for (const game of scored) {
    if (game.overUnder !== name) break;
    streak += 1;
  }
  const total = scored.length;
  const average = total ? scored.reduce((sum, game) => sum + game.value, 0) / total : null;
  const shown = name === "under"
    ? scored.map((game) => ({ ...game, overUnder: game.overUnder === "over" ? "under" : game.overUnder === "under" ? "over" : game.overUnder }))
    : scored;
  return {
    hits, streak, totalGames: total, games: shown, average,
    hitRate: total ? Math.round((hits / total) * 1000) / 10 : 0,
    cushion: total ? Math.round((name === "over" ? average - line : line - average) * 10) / 10 : null,
  };
}

// One row at the chosen sportsbook's own line (lhOdds.bookLine), or at the consensus line when "Best odds" is chosen. Null = hide the row
// (the book has no line for it). The stronger side wins unless sideRule is "over" / "under".
function plResolve(spec, sideRule) {
  const vendor = lhOdds.getBook();
  let base = spec.line;
  if (vendor) {
    const own = lhOdds.bookLine(spec.playerId, spec.propType, vendor);
    if (!own) return null;
    base = own.line;
  }
  if (base === null || base === undefined) return null;
  const over = plStatsAtLine(spec.games, base, "over");
  const under = plStatsAtLine(spec.games, base, "under");
  const side = sideRule === "over" || sideRule === "under" ? sideRule : (under.hitRate > over.hitRate ? "under" : "over");
  return { line: base, side, stats: side === "under" ? under : over };
}

// ---------- Row controls ----------

const plOddsText = (odds) => (odds > 0 ? `+${odds}` : `${odds}`);

function plDrawerData(spec, line, side) {
  return { playerId: spec.playerId, player: spec.name, team: spec.team, opp: spec.opp, gameId: spec.gameId, tipoff: spec.tipoff || null, code: spec.code, line, side };
}

// The odds for a row at a line and side: one book when a sportsbook is chosen, every book (best first) otherwise.
function plBooks(spec, line, side) {
  return side ? lhOdds.getOdds(spec.playerId, spec.propType, line, side) : [];
}

// The desktop controls. side null = nothing picked ("Pick over or under"). A side with no price: no odds, Add disabled, no note.
function plControlsHtml(spec, line, side, baseLine) {
  const books = plBooks(spec, line, side);
  const best = books[0] || null;
  let status = "";
  if (!side) status = `<span class="lh-top-hint">Pick over or under</span>`;
  else if (best) {
    const others = books.slice(1).map((entry) => `${entry.book} ${plOddsText(entry.odds)}`).join(", ");
    status = `<a class="lh-odds-chip" href="game.html?id=${spec.gameId}&player=${spec.playerId}&prop=${spec.code}&side=${side}" data-lh-drawer="${huntAttr(JSON.stringify(plDrawerData(spec, line, side)))}" title="Best odds: ${best.vendor}"><b>${plOddsText(best.odds)}</b> ${best.book}</a>`
      + (books.length > 1 && !lhOdds.getBook() ? `<span class="lh-odds-chip lh-odds-more" title="${others}">+${books.length - 1}</span>` : "");
  }
  const add = best ? huntButtonHtml({
    playerId: spec.playerId, player: spec.name, team: spec.team, opp: spec.opp, gameId: spec.gameId, tipoff: spec.tipoff || null,
    stat: spec.propType, side, line, odds: best.odds, book: best.vendor, isAlt: line !== baseLine,
  }, { labelOut: "ADD", labelIn: "ADDED", iconFirst: true, className: "lh-top-add" })
    : side ? `<button type="button" class="lh-add lines-only lh-top-add" disabled aria-disabled="true"><i class="lh-add-icon bi bi-plus-lg" aria-hidden="true"></i><span class="lh-add-label">ADD</span></button>` : "";
  return `
    <div class="lh-top-linectl" role="group" aria-label="Line for ${huntAttr(spec.name)}">
      <div class="lh-top-step">
        <button type="button" class="lh-top-stepbtn" data-pl-step="-1" aria-label="Lower the line by 1"${line <= 0.5 ? " disabled" : ""}>−</button>
        <output class="lh-top-line">${lineText(line)}</output>
        <button type="button" class="lh-top-stepbtn" data-pl-step="1" aria-label="Raise the line by 1">+</button>
      </div>
      <div class="lh-top-sides">
        <button type="button" class="lh-top-sidebtn lh-top-sidebtn--over${side === "over" ? " is-on" : ""}" data-pl-side="over" aria-pressed="${side === "over"}">Over</button>
        <button type="button" class="lh-top-sidebtn lh-top-sidebtn--under${side === "under" ? " is-on" : ""}" data-pl-side="under" aria-pressed="${side === "under"}">Under</button>
      </div>
      <div class="lh-top-oddsbox">${status}</div>
      ${add}
    </div>`;
}

// Stepper / Over-Under clicks inside `list`. ctx = { edits, find(key) -> item | null, render(item) -> html of the whole row (its root has data-pl-row=key) }.
// item.line = the row's starting line, item.side = its starting side. edits[key] = { line, side } once the visitor touches a control.
function plBindControls(list, ctx) {
  if (list.dataset.plBound) return;
  list.dataset.plBound = "1";
  list.addEventListener("click", (event) => {
    const step = event.target.closest("[data-pl-step]");
    const sideButton = event.target.closest("[data-pl-side]");
    if (!step && !sideButton) return;
    const wrap = event.target.closest("[data-pl-row]");
    const item = wrap && ctx.find(wrap.dataset.plRow);
    if (!item) return;
    const key = wrap.dataset.plRow;
    const current = ctx.edits[key] || { line: item.line, side: item.side };
    if (step) ctx.edits[key] = { line: Math.max(0.5, current.line + Number(step.dataset.plStep)), side: current.side }; // stepping keeps the side
    else ctx.edits[key] = { line: current.line, side: sideButton.dataset.plSide };
    wrap.outerHTML = ctx.render(item);
    const fresh = list.querySelector(`[data-pl-row="${key}"]`);
    const again = fresh && fresh.querySelector(step ? `[data-pl-step="${step.dataset.plStep}"]` : `[data-pl-side="${sideButton.dataset.plSide}"]`);
    if (again && !again.disabled) again.focus();
  });
}

// ---------- The controls bar ----------
// cfg.modeClass = "lines-only" hides the bar, search box and chips in research mode (the game page).
// cfg = { idPrefix, anchor (the element the bar is inserted before), windows, window, sorts: [{code,label}] | null, sort, withGame,
//         getGames() -> [{ value, label, tip }], isInjured(playerId), onChange(), onBar(state) }
// state = { window, sort, side, game, injured, minGames, query }  (the host reads it when it draws the rows)
function createPropListBar(cfg) {
  const id = cfg.idPrefix;
  const state = { window: cfg.window ?? 10, sort: cfg.sort || null, side: "both", game: "all", injured: true, minGames: 0, query: "" };
  const edits = {};   // stepped lines per row, shared with plBindControls; a new sportsbook clears them (every row moves to that book's line)
  let openPanel = null;
  const isPhone = () => window.matchMedia("(max-width: 575.98px)").matches;
  const sortLabel = (code) => (cfg.sorts.find((sort) => sort.code === code) || {}).label;

  function setBook(vendor) {
    if ((lhOdds.getBook() || null) === (vendor || null)) return;
    lhOdds.setBook(vendor);
    Object.keys(edits).forEach((key) => delete edits[key]);
  }

  // ----- chips -----
  function activeChips() {
    const chips = [];
    if (state.side !== "both") chips.push({ label: state.side === "over" ? "Overs only" : "Unders only", remove: () => { state.side = "both"; } });
    if (cfg.withGame && state.game !== "all") {
      const match = cfg.getGames().find((game) => String(game.value) === String(state.game));
      chips.push({ label: match ? match.label : "One game", remove: () => { state.game = "all"; } });
    }
    if (lhOdds.getBook()) chips.push({ label: `Book: ${lhOdds.vendorName(lhOdds.getBook())}`, remove: () => { setBook(null); } });
    if (state.injured) chips.push({ label: "Hiding injured", remove: () => { state.injured = false; } });
    if (state.minGames) chips.push({ label: `${state.minGames}+ games`, remove: () => { state.minGames = 0; } });
    return chips;
  }

  function renderChips() {
    const box = document.getElementById(`${id}Chips`);
    const chips = activeChips();
    box.hidden = chips.length === 0;
    box.innerHTML = chips.map((chip, index) => `<button type="button" class="lh-top-chip" data-chip="${index}" aria-label="Remove: ${chip.label}">${chip.label} <span aria-hidden="true">✕</span></button>`).join("")
      + (chips.length ? `<button type="button" class="lh-top-clear" data-clear>Clear all</button>` : "");
    box.querySelectorAll("[data-chip]").forEach((button) => button.addEventListener("click", () => {
      chips[Number(button.dataset.chip)].remove();
      refresh();
    }));
    const clear = box.querySelector("[data-clear]");
    if (clear) clear.addEventListener("click", () => {
      state.side = "both"; state.game = "all"; state.injured = false; state.minGames = 0;
      setBook(null);
      refresh();
    });
  }

  // ----- panels -----
  const options = (name, list, active) => `<div class="lh-top-opts" role="group">${list.map((option) =>
    `<button type="button" class="lh-top-opt${String(option.value) === String(active) ? " active" : ""}" data-set="${name}" data-value="${option.value}" aria-pressed="${String(option.value) === String(active)}">${option.label}</button>`).join("")}</div>`;

  // The Sportsbook list is built from the books in the odds data. "Best odds" first.
  function bookOptionsHtml() {
    const list = [{ value: "best", label: "Best odds" }, ...lhOdds.vendors().map((vendor) => ({ value: vendor, label: lhOdds.vendorName(vendor) }))];
    const active = lhOdds.getBook() || "best";
    return `<div class="lh-top-opts lh-top-opts--list">${list.map((option) =>
      `<button type="button" class="lh-top-opt${option.value === active ? " active" : ""}" data-set="book" data-value="${option.value}" aria-pressed="${option.value === active}">${option.label}</button>`).join("")}</div>`;
  }

  function panelHtml(kind) {
    if (kind === "book") return bookOptionsHtml();
    if (kind === "sort") {
      return `<div class="lh-top-opts lh-top-opts--list">${cfg.sorts.map((sort) =>
        `<button type="button" class="lh-top-opt${sort.code === state.sort ? " active" : ""}" data-set="sort" data-value="${sort.code}">${sort.label}</button>`).join("")}</div>`;
    }
    let gameField = "";
    if (cfg.withGame) {
      const games = cfg.getGames().slice().sort((a, b) => new Date(a.tip) - new Date(b.tip));
      gameField = `<div class="lh-top-field"><span class="lh-label text-muted">Game</span>
        <select class="form-select form-select-sm" data-set="game" aria-label="Game">
          <option value="all">All games</option>
          ${games.map((game) => `<option value="${game.value}"${String(game.value) === String(state.game) ? " selected" : ""}>${game.label}</option>`).join("")}
        </select></div>`;
    }
    return `
      <div class="lh-top-field"><span class="lh-label text-muted">Side</span>
        ${options("side", [{ value: "over", label: "Over" }, { value: "under", label: "Under" }, { value: "both", label: "Both" }], state.side)}</div>
      ${gameField}
      <div class="lh-top-field"><label class="form-check form-switch mb-0">
        <input class="form-check-input" type="checkbox" role="switch" data-set="injured"${state.injured ? " checked" : ""}>
        <span class="form-check-label">Hide injured</span></label></div>
      <div class="lh-top-field"><span class="lh-label text-muted">Minimum games</span>
        ${options("min", [{ value: 0, label: "Off" }, { value: 5, label: "5+" }, { value: 10, label: "10+" }], state.minGames)}</div>
      <div class="lh-top-field lh-top-field--phone"><span class="lh-label text-muted">Sportsbook</span>${bookOptionsHtml()}</div>`;
  }

  function onPanelChange(element) {
    const value = element.type === "checkbox" ? element.checked : element.dataset.value ?? element.value;
    const name = element.dataset.set;
    if (name === "side") state.side = value;
    if (name === "game") state.game = value;
    if (name === "injured") state.injured = value;
    if (name === "min") state.minGames = Number(value);
    if (name === "sort") { state.sort = value; closePanel(); }
    if (name === "book") { setBook(value === "best" ? null : value); if (openPanel === "book") closePanel(); }
    refresh();
  }

  function fillPanel(host, kind) {
    host.innerHTML = panelHtml(kind);
    host.querySelectorAll("button[data-set]").forEach((button) => button.addEventListener("click", () => onPanelChange(button)));
    host.querySelectorAll("select[data-set], input[data-set]").forEach((input) => input.addEventListener("change", () => onPanelChange(input)));
  }

  function closePanel() {
    openPanel = null;
    document.querySelectorAll(`#${id}Controls [data-bs-toggle='dropdown']`).forEach((toggle) => bootstrap.Dropdown.getInstance(toggle)?.hide());
    const sheet = document.getElementById(`${id}Sheet`);
    if (sheet) bootstrap.Offcanvas.getInstance(sheet)?.hide();
  }

  // Phones: the same panel content in a bottom sheet.
  function openSheet(kind) {
    let sheet = document.getElementById(`${id}Sheet`);
    if (!sheet) {
      sheet = document.createElement("div");
      sheet.id = `${id}Sheet`;
      sheet.className = "offcanvas offcanvas-bottom lh-sheet lh-top-sheet";
      sheet.tabIndex = -1;
      sheet.innerHTML = `<div class="offcanvas-header"><h2 class="offcanvas-title lh-label" id="${id}SheetTitle"></h2>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button></div>
        <div class="offcanvas-body"></div>`;
      sheet.setAttribute("aria-labelledby", `${id}SheetTitle`);
      document.body.appendChild(sheet);
    }
    openPanel = kind;
    sheet.querySelector(".offcanvas-title").textContent = kind === "sort" ? "Sort" : kind === "book" ? "Sportsbook" : "Filter";
    fillPanel(sheet.querySelector(".offcanvas-body"), kind);
    bootstrap.Offcanvas.getOrCreateInstance(sheet).show();
  }

  // ----- the bar -----
  function render() {
    let bar = document.getElementById(`${id}Controls`);
    if (!bar) {
      bar = document.createElement("div");
      bar.id = `${id}Controls`;
      bar.className = `lh-top-controls${cfg.modeClass ? ` ${cfg.modeClass}` : ""}`;
      // Each button is its own Bootstrap dropdown: the menu opens right under it.
      const dropdown = (kind, icon, label) => `
        <div class="dropdown">
          <button type="button" class="btn btn-ghost btn-sm lh-top-ctl" data-bs-toggle="dropdown" data-bs-auto-close="outside"
                  data-bs-offset="0,6" data-panel="${kind}" aria-expanded="false"><i class="bi ${icon}" aria-hidden="true"></i> ${label}</button>
          <div class="dropdown-menu dropdown-menu-start lh-top-panel" id="${id}Menu-${kind}"></div>
        </div>`;
      bar.innerHTML = `
        <div class="lh-window-toggle btn-group" role="group" aria-label="Window"></div>
        ${dropdown("filter", "bi-funnel", "Filter")}
        ${cfg.sorts ? dropdown("sort", "bi-arrow-down-up", `<span data-sort-label></span>`) : ""}
        <span class="lh-top-bookpill">${dropdown("book", "bi-bank", `<span data-book-label></span>`)}</span>`;
      // The search bar sits right under the pills: filters the rows as you type (no suggestion list).
      const search = document.createElement("div");
      search.id = `${id}Search`;
      search.className = `lh-top-search${cfg.modeClass ? ` ${cfg.modeClass}` : ""}`;
      search.innerHTML = `
        <i class="bi bi-search lh-top-search-icon" aria-hidden="true"></i>
        <input type="search" class="lh-top-search-input" placeholder="Search players" aria-label="Search players" autocomplete="off" spellcheck="false" value="${huntAttr(state.query)}">
        <button type="button" class="lh-top-search-clear" aria-label="Clear search" hidden><i class="bi bi-x-lg" aria-hidden="true"></i></button>`;
      const input = search.querySelector("input");
      const clearButton = search.querySelector("button");
      const sync = () => { clearButton.hidden = input.value === ""; };
      const set = (value) => { input.value = value; state.query = value; sync(); cfg.onChange(); };
      input.addEventListener("input", () => { state.query = input.value; sync(); cfg.onChange(); });
      input.addEventListener("keydown", (event) => { if (event.key === "Escape" && input.value) set(""); });
      clearButton.addEventListener("click", () => { set(""); input.focus(); });
      sync();
      const chips = document.createElement("div");
      chips.id = `${id}Chips`;
      chips.className = `lh-top-chips${cfg.modeClass ? ` ${cfg.modeClass}` : ""}`;
      cfg.anchor.parentNode.insertBefore(bar, cfg.anchor);
      cfg.anchor.parentNode.insertBefore(search, cfg.anchor);
      cfg.anchor.parentNode.insertBefore(chips, cfg.anchor);
      bar.querySelectorAll("[data-panel]").forEach((button) => {
        const kind = button.dataset.panel;
        const menu = document.getElementById(`${id}Menu-${kind}`);
        // Phones use the bottom sheet instead of the dropdown.
        button.addEventListener("show.bs.dropdown", (event) => {
          if (isPhone()) { event.preventDefault(); openSheet(kind); return; }
          openPanel = kind;
          fillPanel(menu, kind);
        });
        button.addEventListener("hidden.bs.dropdown", () => { if (openPanel === kind) openPanel = null; });
      });
    }
    bar.hidden = false;
    document.getElementById(`${id}Search`).hidden = false;
    if (cfg.sorts) bar.querySelector("[data-sort-label]").textContent = `Sort: ${sortLabel(state.sort)}`;
    bar.querySelector("[data-book-label]").textContent = lhOdds.getBook() ? lhOdds.vendorName(lhOdds.getBook()) : "Sportsbook";

    const group = bar.querySelector(".lh-window-toggle");
    group.innerHTML = "";
    cfg.windows.forEach((size) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = size === state.window ? "btn btn-ghost active" : "btn btn-ghost";
      button.setAttribute("aria-pressed", String(size === state.window));
      button.textContent = `L${size}`;
      button.addEventListener("click", () => { state.window = size; refresh(); });
      group.appendChild(button);
    });
    renderChips();
    if (cfg.onBar) cfg.onBar(state);
  }

  // Redraw everything that depends on the controls (after any change), then the host's rows.
  function refresh() {
    render();
    cfg.onChange();
    const menu = openPanel && !isPhone() ? document.getElementById(`${id}Menu-${openPanel}`) : null;
    if (menu) fillPanel(menu, openPanel);
    const sheet = document.getElementById(`${id}Sheet`);
    if (openPanel && isPhone() && sheet) fillPanel(sheet.querySelector(".offcanvas-body"), openPanel);
  }

  function hide() {
    ["Controls", "Search", "Chips"].forEach((suffix) => {
      const element = document.getElementById(`${id}${suffix}`);
      if (element) element.hidden = true;
    });
  }

  // Search + Filter rules every host applies the same way (the host adds its own tab / stat rules).
  function rowAllowed(name, playerId, gameId) {
    if (!plNameMatches(name, state.query)) return false;
    if (state.injured && cfg.isInjured(playerId)) return false;
    if (cfg.withGame && state.game !== "all" && String(gameId) !== String(state.game)) return false;
    return true;
  }

  return { state, edits, render, refresh, hide, closePanel, rowAllowed, setBook };
}
