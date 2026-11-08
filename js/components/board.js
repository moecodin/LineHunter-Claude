// LineHunter - js/components/board.js
// "The Board": every prop on the slate in one list (it replaced Top Hit Rates). Each row = one player + prop with the hit rate over
// L5 / L10 / L20, the Hunt line (the engine's projection), the Hunt Score and the best odds. A row opens IN PLACE (no drawer) to its
// breakdown: the Edge, a number line (book line, Hunt line, likely range), the Hunt Score with its confidence, the engine's first
// "why" sentence, the hunts tracker (line stepper, Over / Under, odds, Add to My Hunts; behind a switch on phones), the animated
// bar chart with its divider, L5 / L10 / season averages and the matchup facts. One row is open at a time.
//
// Where: top-hit-rates.html (the tool page, all rows with "Show more"), the Today page (schedule.html, under the games) and the game
// page (game.html, that game's props; data-single-game drops the Game filter). The section is <section id="theBoard" data-rows="25">.
// boardOpenLinked(gameId, playerId, code, side) opens one player's row as soon as the slate arrives (links like
// game.html?id=1&player=237&prop=pts&side=under: Hit List legs, shared hunts, the homepage). Data:
//   - the slate js/components/top-hit-rates.js builds and caches (the game page sends its own, built from its data, the same way) (event "lh-top-slate"; "lh-top-loading" while a new day loads):
//     rows with each window's games, the injuries and the tip-offs. No downloads of its own for the list.
//   - the Hunt Score engine (/api/hunt through loadHunts in js/components/hunt-score.js): score, chance, projection, factors and
//     "why" per prop + side. A row only shows a Hunt Score when the engine scored that exact line; the Hunt line / Edge / range
//     show for any line of the same prop (the projection does not depend on the line).
//   - when a row opens: the player's season averages (loadSeasonAverages, one request) and his games against tonight's
//     opponent (loadPlayerH2HForGame, js/core/h2h.js). Both kept in memory per player.
//
// Needs js/core/stats.js, js/core/h2h.js, js/data/odds.js, js/data/teams.js, js/components/propChart.js (+ animatedBars.js),
// js/components/prop-toolbar.js, js/components/prop-list.js, js/components/hunt-button.js, js/components/hunt-score.js and
// js/components/top-hit-rates.js loaded first.

const BOARD = document.getElementById("theBoard");
const BOARD_WINDOWS = [5, 10, 20];
const BOARD_STEP_ROWS = BOARD ? Number(BOARD.dataset.rows) || 25 : 25; // rows shown at first and added by "Show more"
const BOARD_MIN_SAMPLE = 3;            // fewer games than this in the window = no row
const BOARD_TRACKER_KEY = "lh-board-tracker"; // phones: "1" = the hunts tracker shows in an open row
// The Hunt Score is a beta tool for now (hunt-score.html only): with BOARD_HUNT off, The Board loads no Hunt Scores, hides the Hunt line /
// Score columns (.lh-board--nohunt in css/styles.css) and the Edge / Hunt Score strip in an opened row, and sorts by hit rate.
// Set it back to true once the model leaves beta.
const BOARD_HUNT = false;
if (BOARD && !BOARD_HUNT) BOARD.classList.add("lh-board--nohunt");
const BOARD_SORTS_ALL = [
  { code: "score", label: "Hunt Score" },
  { code: "rate", label: "Hit rate" },
  { code: "edge", label: "Edge" },
  { code: "streak", label: "Streak" },
  { code: "game", label: "Game" },
];
const BOARD_SORTS = BOARD_HUNT ? BOARD_SORTS_ALL : BOARD_SORTS_ALL.filter((sort) => sort.code !== "score" && sort.code !== "edge");
const BOARD_STAT_SHORT = { pts: "PTS", reb: "REB", ast: "AST", "3pm": "3PM", pra: "PRA" };
const BOARD_SEASON_KEYS = { pts: ["pts"], reb: ["reb"], ast: ["ast"], "3pm": ["fg3m"], pra: ["pts", "reb", "ast"] };

let boardSlate = null;   // the slate for the shown day (already without started games)
let boardMessage = null; // HTML shown instead of rows (no games, no lines, ...)
let boardHunts = null;   // { date, byLine, byStat } from the engine, or null while loading / failed
let boardHuntsRequest = 0;
let boardTab = "all";
let boardShown = BOARD_STEP_ROWS;
let boardOpen = null;    // the key of the open row, or null
let boardPanel = null;   // { key, chart, toolbar, window, el } for the open row
let boardPending = null; // { gameId, playerId, code, side } from boardOpenLinked, applied when the slate arrives
const boardExtras = {};  // playerId -> { season: {...} | null | "loading", h2h: { [gameId]: logs | "loading" | null } }

// ---------- Small helpers ----------

const boardKey = (row) => `${row.gameId}|${row.playerId}|${row.code}`;
const boardEsc = (text) => String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const boardSigned = (value) => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value).toFixed(1)}`;
const boardIsPhone = () => window.matchMedia("(max-width: 767.98px)").matches;

function boardTrackerOn() {
  try { return localStorage.getItem(BOARD_TRACKER_KEY) === "1"; } catch (error) { return false; }
}

function boardSetTracker(on) {
  try { localStorage.setItem(BOARD_TRACKER_KEY, on ? "1" : "0"); } catch (error) { /* storage blocked: this visit only */ }
}

// "Jalen Brunson" -> { first: "Jalen", last: "Brunson" }; "Karl-Anthony Towns" -> "Karl-Anthony" / "Towns"
function boardNameParts(name) {
  const words = String(name || "").split(" ").filter(Boolean);
  return words.length > 1 ? { first: words[0], last: words.slice(1).join(" ") } : { first: "", last: name || "" };
}

function boardTipTime(tip) {
  if (!tip || !String(tip).includes("T")) return "";
  const time = new Date(tip);
  return Number.isNaN(time.getTime()) ? "" : time.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

const boardAverage = (games) => (games.length ? games.reduce((sum, game) => sum + game.value, 0) / games.length : null);

// ---------- Hunt Score data ----------

// The engine's props, looked up by player + stat (+ line).
function boardIndexHunts(data) {
  const byLine = {};
  const byStat = {};
  ((data && data.props) || []).forEach((prop) => {
    const stat = `${prop.playerId}|${prop.stat}`;
    if (!byStat[stat]) byStat[stat] = prop;
    const key = `${stat}|${prop.line}`;
    byLine[key] = byLine[key] || {};
    byLine[key][prop.side] = prop;
  });
  return { byLine, byStat };
}

function boardHuntSides(playerId, code, line) {
  return boardHunts ? boardHunts.byLine[`${playerId}|${code}|${line}`] || null : null;
}

function boardProjection(playerId, code) {
  const prop = boardHunts ? boardHunts.byStat[`${playerId}|${code}`] : null;
  return prop && prop.projection && Number.isFinite(prop.projection.mean) ? prop.projection : null;
}

const boardFactor = (hunt, key) => (hunt && hunt.factors ? hunt.factors.find((factor) => factor.key === key) || null : null);

// Confidence: how much the information behind the chance can be trusted (not a second chance).
// LOW = a game-time decision, under 5 games this season, or the last 3 games far from the projection. HIGH = 15+ games this season,
// not leaning on last season, minutes within 3 of the season, not on the injury report. MEDIUM = the rest.
function boardConfidence(hunt) {
  const spread = boardFactor(hunt, "spread") || {};
  const minutes = boardFactor(hunt, "minutes");
  const games = Number.isFinite(spread.games) ? spread.games : 0;
  const minutesMoved = minutes && Number.isFinite(minutes.now) && Number.isFinite(minutes.base) ? Math.abs(minutes.now - minutes.base) >= 3 : false;
  const gamesText = `${games} game${games === 1 ? "" : "s"} this season`;
  if (hunt.gtd || spread.gtd) return { level: "LOW", text: "Listed as a game-time decision, so the minutes could swing." };
  if (games < 5) return { level: "LOW", text: `${gamesText}, so it leans on last season.` };
  if (spread.disagree) return { level: "LOW", text: "The last 3 games are far from the projection." };
  if (games >= 15 && !spread.lastSeason && !minutesMoved && !hunt.injured) {
    return { level: "HIGH", text: `${gamesText}, steady minutes, not on the injury report.` };
  }
  const reasons = [];
  if (games < 15) reasons.push(gamesText);
  if (spread.lastSeason) reasons.push("leans partly on last season");
  if (minutesMoved) reasons.push(`minutes moved from ${minutes.base} to ${minutes.now}`);
  if (hunt.injured) reasons.push(`on the injury report (${hunt.injuryStatus || "listed"})`);
  const text = reasons.length ? reasons.join(", ") : "a mix of steady and shifting numbers";
  return { level: "MEDIUM", text: `${text.charAt(0).toUpperCase()}${text.slice(1)}.` };
}

// ---------- The rows ----------

function boardSpec(row, size) {
  return {
    playerId: row.playerId, name: row.name, team: row.team,
    opp: row.opp || (row.matchup || "").split(" ").pop(),
    gameId: row.gameId, tipoff: row.tip || null,
    propType: PROP_CODES[row.code] || row.code, code: row.code,
    games: row.w[size].games, line: row.line,
  };
}

// One row at the chosen book's line (or the consensus line), on the side the engine scores higher (else the stronger hit-rate side),
// with any stepped line / picked side from the tracker on top.
function boardItem(row, size = boardUi.state.window) {
  const ui = boardUi.state;
  const spec = boardSpec(row, size);
  const resolved = plResolve(spec, ui.side);
  if (!resolved) return null;
  const key = boardKey(row);
  let line = resolved.line;
  let side = resolved.side;
  const scored = boardHuntSides(row.playerId, row.code, line);
  if (ui.side === "both" && scored) {
    const over = scored.over ? scored.over.score : -1;
    const under = scored.under ? scored.under.score : -1;
    if (over >= 0 || under >= 0) side = under > over ? "under" : "over";
  }
  const baseLine = line;
  const baseSide = side;
  const edit = boardUi.edits[key];
  if (edit) {
    line = edit.line;
    side = edit.side || side;
  }
  const stats = plStatsAtLine(spec.games, line, side);
  const sides = boardHuntSides(row.playerId, row.code, line);
  const hunt = sides ? sides[side] || null : null;
  const projection = boardProjection(row.playerId, row.code);
  const edge = projection ? projection.mean - line : null;
  return { row, spec, key, line, side, baseLine, baseSide, stats, hunt, projection, edge };
}

function boardItems() {
  if (!boardSlate) return [];
  const ui = boardUi.state;
  const items = boardSlate.rows
    .filter((row) => boardTab === "all" || row.code === boardTab)
    .filter((row) => boardUi.rowAllowed(row.name, row.playerId, row.gameId))
    .map((row) => boardItem(row))
    .filter(Boolean)
    .filter((item) => item.stats.totalGames >= Math.max(BOARD_MIN_SAMPLE, ui.minGames));

  const full = (item) => (item.stats.totalGames >= ui.window ? 1 : 0);
  const byRate = (a, b) => (full(b) - full(a)) || (b.stats.hitRate - a.stats.hitRate)
    || (b.stats.totalGames - a.stats.totalGames) || (b.stats.streak - a.stats.streak);
  const pickEdge = (item) => (item.edge === null ? -Infinity : item.side === "under" ? -item.edge : item.edge);
  const score = (item) => (item.hunt ? item.hunt.score : -1);
  const compare = {
    score: (a, b) => (score(b) - score(a)) || byRate(a, b),
    rate: byRate,
    edge: (a, b) => (pickEdge(b) - pickEdge(a)) || byRate(a, b),
    streak: (a, b) => (b.stats.streak - a.stats.streak) || byRate(a, b),
    game: (a, b) => (new Date(a.row.tip) - new Date(b.row.tip)) || (a.row.gameId - b.row.gameId) || (score(b) - score(a)) || byRate(a, b),
  }[ui.sort] || byRate;
  return items.sort(compare);
}

function boardFindItem(key) {
  const row = boardSlate ? boardSlate.rows.find((entry) => boardKey(entry) === key) : null;
  return row ? boardItem(row) : null;
}

// The odds chip and Add for a row at its line + side.
function boardOddsHtml(item) {
  const books = plBooks(item.spec, item.line, item.side);
  const best = books[0] || null;
  if (!best) return { chip: `<span class="lh-odds-chip lh-odds-chip--none" title="No book posts this line">–</span>`, best: null };
  const more = books.length > 1 && !lhOdds.getBook()
    ? `<span class="lh-bd-more" title="${boardEsc(books.slice(1).map((entry) => `${entry.book} ${plOddsText(entry.odds)}`).join(", "))}">+${books.length - 1}</span>` : "";
  return { chip: `<span class="lh-odds-chip" title="Best odds: ${boardEsc(best.vendor)}"><b>${plOddsText(best.odds)}</b> ${best.book}</span>${more}`, best };
}

function boardLeg(item, best) {
  return {
    playerId: item.row.playerId, player: item.row.name, team: item.row.team, opp: item.spec.opp, gameId: item.row.gameId,
    tipoff: item.row.tip || null, stat: item.spec.propType, side: item.side, line: item.line,
    odds: best ? best.odds : null, book: best ? best.vendor : null, isAlt: item.line !== item.baseLine,
  };
}

// The closed row (also the top of an open one).
function boardHeadHtml(item, isOpen) {
  const { row, stats, hunt, projection, edge, side } = item;
  const name = boardNameParts(row.name);
  const status = boardSlate.injuries ? boardSlate.injuries[row.playerId] : null;
  const gtd = status && plIsInjuredOut(status) ? `<span class="lh-bd-tag" title="${boardEsc(status)}">${/out/i.test(status) ? "OUT" : "GTD"}</span>` : "";
  const sideWord = side === "under" ? "Under" : "Over";
  const statWord = PL_PROP_WORDS[row.code] || row.code.toUpperCase();
  const window = boardUi.state.window;
  const odds = boardOddsHtml(item);
  const add = odds.best
    ? huntButtonHtml(boardLeg(item, odds.best), { labelOut: "ADD", labelIn: "ADDED", iconFirst: true, className: "lh-top-add" })
    : `<button type="button" class="lh-add lines-only lh-top-add" disabled aria-disabled="true"><i class="lh-add-icon bi bi-plus-lg" aria-hidden="true"></i><span class="lh-add-label">ADD</span></button>`;
  const edgeClass = edge === null ? "" : edge > 0 ? "is-over" : edge < 0 ? "is-under" : "";
  const time = boardTipTime(row.tip);
  const label = `${row.name}, ${sideWord} ${lineText(item.line)} ${statWord}`;

  return `
      <div class="lh-bd-player">
        <span class="lh-bd-first">${boardEsc(name.first)}</span>
        <span class="lh-bd-lastline"><span class="lh-bd-last">${boardEsc(name.last)}</span> ${teamBadgeForMatchup(row.team, row.matchup)}${gtd}</span>
        <span class="lh-bd-meta">${boardEsc(row.matchup)}${time ? ` · ${time}` : ""}</span>
      </div>
      <div class="lh-bd-pick is-${side}"><b>${sideWord} ${lineText(item.line)}</b><span>${statWord}</span></div>
      <div class="lh-bd-hit"><b>${stats.hits}/${stats.totalGames}</b><span class="lh-bd-graph">${miniGraph(stats.games)}</span><span class="lh-bd-window">L${window}</span></div>
      <div class="lh-bd-num lh-bd-avg"><span class="lh-bd-cap">Avg</span>${formatStatValue(stats.average)}</div>
      <div class="lh-bd-num lh-bd-proj"><span class="lh-bd-cap">Hunt line</span>${projection ? projection.mean.toFixed(1) : "–"}${edge !== null ? `<small class="${edgeClass}">${boardSigned(edge)}</small>` : ""}</div>
      <div class="lh-bd-score is-${side}" title="${hunt ? `Hunt Score ${hunt.score}: ${hunt.chance}% chance` : "No Hunt Score for this line"}">${hunt ? hunt.score : "–"}</div>
      <div class="lh-bd-odds">${odds.chip}</div>
      <div class="lh-bd-add">${add}</div>
      <button type="button" class="lh-bd-chev" data-bd-toggle aria-expanded="${isOpen}" aria-controls="bdPanel" aria-label="${isOpen ? "Hide" : "Show"} the breakdown for ${boardEsc(label)}">
        <i class="bi bi-chevron-down" aria-hidden="true"></i>
      </button>`;
}

function boardRowHtml(item) {
  const isOpen = item.key === boardOpen;
  return `
    <div class="lh-bd-row${isOpen ? " is-open" : ""}" data-bd-row="${boardEsc(item.key)}">
      <div class="lh-bd-head" data-bd-head>${boardHeadHtml(item, isOpen)}</div>
      ${isOpen ? boardPanelShellHtml(item) : ""}
    </div>`;
}

function boardSkeleton() {
  const row = `<div class="lh-bd-row placeholder-glow" aria-hidden="true"><div class="lh-bd-head">
    <div class="lh-bd-player"><span class="placeholder col-5"></span><span class="placeholder col-8 mt-1"></span></div>
    <div class="lh-bd-pick"><span class="placeholder col-10"></span></div>
    <div class="lh-bd-hit"><span class="placeholder col-12"></span></div></div></div>`;
  return row.repeat(6);
}

function boardMessageHtml(html) {
  return `<div class="lh-top-message">${html}</div>`;
}

// ---------- The open row's breakdown ----------

function boardPanelShellHtml(item) {
  return `
      <div class="lh-bd-panel" id="bdPanel" role="region" aria-label="Breakdown for ${boardEsc(item.row.name)}">
        <div class="lh-bd-sum" data-slot="sum"></div>
        <p class="lh-bd-why" data-slot="why"></p>
        <label class="lh-bd-trackswitch">
          <span><b>Show hunts tracker</b><small>Line stepper, odds and Add to My Hunts</small></span>
          <span class="form-check form-switch mb-0"><input class="form-check-input" type="checkbox" role="switch" data-bd-tracker${boardTrackerOn() ? " checked" : ""}></span>
        </label>
        <div class="lh-bd-tracker" data-slot="tracker"></div>
        <div class="lh-bd-cols">
          <div class="lh-bd-form">
            <div class="lh-bd-sechead">
              <div><span class="lh-bd-kicker">Form</span><h3 class="lh-bd-title" data-slot="formTitle"></h3></div>
              <div class="lh-window-toggle btn-group btn-group-sm" role="group" aria-label="Games in the chart" data-slot="formWindows"></div>
            </div>
            <div class="lh-bd-chart" data-slot="chart"></div>
            <div class="lh-bd-avgs" data-slot="avgs"></div>
          </div>
          <div class="lh-bd-match">
            <div class="lh-bd-sechead"><div><span class="lh-bd-kicker">Matchup</span><h3 class="lh-bd-title">Tonight ${boardEsc(item.row.matchup)}</h3></div></div>
            <dl class="lh-bd-facts" data-slot="facts"></dl>
            <div class="lh-bd-links">
              <a href="player.html?id=${item.row.playerId}&prop=${item.row.code}">Player page ›</a>
              <a href="matchup.html?player=${item.row.playerId}&stat=${item.row.code}">Matchup Analyzer ›</a>
            </div>
          </div>
        </div>
      </div>`;
}

// Edge | the number line | Hunt Score + confidence
function boardSumHtml(item) {
  if (!BOARD_HUNT) return "";
  const { projection: proj, hunt, line, side } = item;
  if (!proj) {
    return `<p class="lh-bd-note">${boardHunts ? "The Hunt Score engine hasn't scored this prop yet." : "Loading the Hunt Score..."}</p>`;
  }
  const edge = proj.mean - line;
  const tone = edge > 0.05 ? "over" : edge < -0.05 ? "under" : "push";
  const low = Math.min(proj.p10, line, proj.mean);
  const high = Math.max(proj.p90, line, proj.mean);
  const pad = Math.max(1, (high - low) * 0.12);
  const lo = low - pad;
  const span = high + pad - lo;
  const pos = (value) => Math.max(0, Math.min(100, ((value - lo) / span) * 100));
  const bookX = pos(line);
  const huntX = pos(proj.mean);
  const huntLeft = proj.mean < line; // the Hunt line's label sits on the side away from the book's
  const sideWord = side === "under" ? "under" : "over";
  const conf = hunt ? boardConfidence(hunt) : null;

  return `
        <div class="lh-bd-edge">
          <span class="lh-bd-kicker">Edge</span>
          <span class="lh-bd-big is-${tone}">${boardSigned(edge)}</span>
          <span class="lh-bd-small">Hunt line ${edge >= 0 ? "above" : "below"} the book line</span>
        </div>
        <div class="lh-bd-strip" role="img" aria-label="Hunt line ${proj.mean.toFixed(1)} against the book line ${lineText(line)}; likely range ${Math.round(proj.p10)} to ${Math.round(proj.p90)}">
          <div class="lh-bd-axis"></div>
          <div class="lh-bd-band" style="left: ${pos(proj.p10)}%; width: ${pos(proj.p90) - pos(proj.p10)}%"></div>
          <span class="lh-bd-tick" style="left: ${pos(proj.p10)}%">${Math.round(proj.p10)}</span>
          <span class="lh-bd-tick" style="left: ${pos(proj.p90)}%">${Math.round(proj.p90)}</span>
          <span class="lh-bd-rangelabel" style="left: ${pos(proj.p90)}%">likely range</span>
          <div class="lh-bd-gap is-${tone}" style="left: ${Math.min(bookX, huntX)}%; width: ${Math.abs(huntX - bookX)}%"></div>
          <div class="lh-bd-bookmark" style="left: ${bookX}%"></div>
          <span class="lh-bd-booklabel${huntLeft ? " is-right" : ""}" style="left: ${bookX}%">Book line <b>${lineText(line)}</b></span>
          <div class="lh-bd-dot is-${tone}" style="left: ${huntX}%"></div>
          <span class="lh-bd-huntlabel is-${tone}${huntLeft ? " is-left" : ""}" style="left: ${huntX}%">Hunt line <b>${proj.mean.toFixed(1)}</b></span>
          <span class="lh-bd-dir" style="left: ${bookX}%">◂ under · over ▸</span>
        </div>
        <div class="lh-bd-scorebox">
          <span class="lh-bd-kicker">Hunt Score</span>
          ${hunt ? `<span class="lh-bd-big is-${side}">${hunt.score}</span>
          <span class="lh-bd-small">chance of the ${sideWord}, in %</span>
          <span class="lh-bd-conf"><b>Confidence: ${conf.level}</b> ${boardEsc(conf.text)}</span>`
    : `<span class="lh-bd-big is-push">–</span><span class="lh-bd-small">Scored only at the book line${boardHuntSides(item.row.playerId, item.row.code, item.baseLine) ? ` (${lineText(item.baseLine)})` : ""}</span>`}
        </div>`;
}

// The first "why" sentence (the engine's), or a plain record when the engine has no score at this line.
function boardWhyText(item) {
  if (item.hunt && item.hunt.why && item.hunt.why[0]) return item.hunt.why[0];
  const { stats } = item;
  const word = item.side === "under" ? "under" : "over";
  return `${boardNameParts(item.row.name).last} went ${word} ${lineText(item.line)} in ${stats.hits} of the last ${stats.totalGames} (avg ${formatStatValue(stats.average)}).`;
}

// The chart's games at a line, oldest first, colored against the line itself (not flipped for the under side).
function boardChartGames(row, size, line) {
  return [...row.w[size].games].reverse().map((game) => ({ ...game, overUnder: game.value > line ? "over" : game.value < line ? "under" : "push" }));
}

function boardSeasonGames(row) {
  const season = currentSeasonYear();
  return row.w[20].games.filter((game) => game.season === season).length;
}

function boardAvgsHtml(item) {
  const { row } = item;
  const extras = boardExtras[row.playerId] || {};
  const l5 = boardAverage(row.w[5].games);
  const l10 = boardAverage(row.w[10].games);
  let season = `<b>…</b><small>loading</small>`;
  if (extras.season && extras.season !== "loading") {
    const value = BOARD_SEASON_KEYS[row.code].reduce((sum, key) => sum + (extras.season[key] ?? 0), 0);
    season = `<b>${value.toFixed(1)}</b><small>${extras.season.gp} games · ${extras.season.fromLastSeason ? "last season" : "this season"}</small>`;
  } else if (extras.season === null) {
    season = `<b>–</b><small>not available</small>`;
  }
  return `
      <div><span>Last 5 avg</span><b>${l5 === null ? "–" : l5.toFixed(1)}</b><small>${row.w[5].games.length} games</small></div>
      <div><span>Last 10 avg</span><b>${l10 === null ? "–" : l10.toFixed(1)}</b><small>${row.w[10].games.length} games</small></div>
      <div><span>Season avg</span>${season}</div>`;
}

function boardFactsHtml(item) {
  const { row, hunt, line } = item;
  const any = hunt || (boardHunts ? boardHunts.byStat[`${row.playerId}|${row.code}`] : null);
  const facts = [];
  const minutes = boardFactor(any, "minutes");
  if (minutes && Number.isFinite(minutes.now)) facts.push({ label: "Projected minutes", note: Number.isFinite(minutes.base) ? `season ${minutes.base}` : "", value: minutes.now.toFixed(1) });
  const opponent = boardFactor(any, "opponent");
  const stat = BOARD_STAT_SHORT[row.code] || row.code.toUpperCase();
  if (opponent && opponent.rank) {
    const tone = opponent.rank <= 10 ? "is-over" : opponent.rank > opponent.of - 10 ? "is-under" : "";
    facts.push({ label: `${row.opp} allows ${stat}`, note: `${opponent.perGame ?? ""} a game · 1 = allows the most`.replace(/^ a game · /, ""), value: `#${opponent.rank} of ${opponent.of}`, tone });
  }
  const zone = boardFactor(any, "zone");
  if (zone && Number.isFinite(zone.extra) && Math.abs(zone.extra) >= 0.1) {
    const what = row.code === "3pm" ? "threes" : "pts";
    facts.push({ label: `${row.opp} zone defense`, note: `vs an average defense${zone.zone ? ` · biggest gap ${zone.zone}` : ""}`, value: `${zone.extra > 0 ? "+" : "−"}${Math.abs(zone.extra).toFixed(1)} ${what}`, tone: zone.extra > 0 ? "is-over" : "is-under" });
  }
  const pace = boardFactor(any, "pace");
  if (pace && pace.rank) {
    const tone = pace.rank <= 10 ? "is-over" : pace.rank > pace.of - 10 ? "is-under" : "";
    facts.push({ label: `${row.opp} pace`, note: "possessions a game · 1 = fastest", value: `${pace.pace} · #${pace.rank}`, tone });
  }
  if (boardFactor(any, "b2b")) facts.push({ label: "Back-to-back", note: "played yesterday", value: "Yes", tone: "is-under" });

  const extras = boardExtras[row.playerId] || {};
  const h2h = extras.h2h ? extras.h2h[row.gameId] : undefined;
  let h2hValue = "…";
  let h2hNote = "loading";
  if (Array.isArray(h2h)) {
    const result = calculateHitRate(h2h.filter(playedInGame), propStatKey(PROP_CODES[row.code]), line, "all");
    if (result.totalGames) {
      const seasons = h2h.map((log) => log.game.season).filter(Boolean);
      const since = seasons.length ? Math.min(...seasons) : null;
      const word = item.side === "under" ? "under" : "over";
      const hits = result.games.filter((game) => game.overUnder === word).length;
      h2hValue = `${formatStatValue(result.average)} · ${hits} of ${result.totalGames} ${word}`;
      h2hNote = since ? `since ${since}-${String(since + 1).slice(2)}` : "past meetings";
    } else {
      h2hValue = "No games";
      h2hNote = "in the last 5 seasons";
    }
  } else if (h2h === null) {
    h2hValue = "–";
    h2hNote = "not available";
  }
  facts.push({ label: `vs ${row.opp}`, note: h2hNote, value: h2hValue });

  const status = boardSlate.injuries ? boardSlate.injuries[row.playerId] : null;
  facts.push({ label: "Status", note: "injury report", value: status || "Active", tone: status && plIsInjuredOut(status) ? "is-under" : "" });

  return facts.map((fact) => `
      <div><dt>${boardEsc(fact.label)}${fact.note ? `<small>${boardEsc(fact.note)}</small>` : ""}</dt><dd class="${fact.tone || ""}">${boardEsc(fact.value)}</dd></div>`).join("");
}

// Season averages + H2H for the open row's player, once per player (and per game for H2H).
function boardLoadExtras(item) {
  const { row } = item;
  const extras = boardExtras[row.playerId] = boardExtras[row.playerId] || { season: undefined, h2h: {} };
  const refresh = () => {
    if (!boardPanel || boardPanel.key !== item.key) return;
    const fresh = boardFindItem(item.key);
    if (fresh) boardPanelFill(fresh, { chart: false });
  };
  if (extras.season === undefined) {
    extras.season = "loading";
    loadSeasonAverages([row.playerId])
      .then((byPlayer) => { extras.season = byPlayer[row.playerId] || null; })
      .catch(() => { extras.season = null; })
      .finally(refresh);
  }
  if (!(row.gameId in extras.h2h)) {
    extras.h2h[row.gameId] = "loading";
    loadPlayerH2HForGame(row.playerId, row.gameId, row.opp)
      .then((data) => { extras.h2h[row.gameId] = h2hLogsFor(data, row.playerId) || []; })
      .catch(() => { extras.h2h[row.gameId] = null; })
      .finally(refresh);
  }
}

// Fill (or refresh) the open panel's parts. chart: false keeps the chart as it is (a late download only changed the text).
function boardPanelFill(item, { chart = true } = {}) {
  if (!boardPanel || boardPanel.key !== item.key) return;
  const panel = boardPanel.el;
  const slot = (name) => panel.querySelector(`[data-slot="${name}"]`);
  slot("sum").innerHTML = boardSumHtml(item);
  slot("why").textContent = boardWhyText(item);
  slot("avgs").innerHTML = boardAvgsHtml(item);
  slot("facts").innerHTML = boardFactsHtml(item);
  panel.classList.toggle("is-tracker", boardTrackerOn());

  boardPanel.toolbar.render({
    line: item.line,
    mainLine: item.baseLine,
    stat: item.spec.propType,
    legBase: { playerId: item.row.playerId, player: item.row.name, team: item.row.team, opp: item.spec.opp, gameId: item.row.gameId, tipoff: item.row.tip || null, stat: item.spec.propType },
  });

  const size = boardPanel.window;
  const games = boardChartGames(item.row, size, item.line);
  const word = item.side === "under" ? "under" : "over";
  const hits = games.filter((game) => game.overUnder === word).length;
  slot("formTitle").textContent = `Last ${games.length} · ${hits} of ${games.length} ${word}`;
  renderToggleButtons(slot("formWindows"), BOARD_WINDOWS.map((value) => ({ label: `L${value}`, value })), size, (value) => {
    boardPanel.window = value;
    const fresh = boardFindItem(item.key);
    if (fresh) boardPanelFill(fresh);
  });
  if (!chart) return;
  boardPanel.chart.setActiveLine(item.line);
  boardPanel.chart.setDivider(chartDivider(games, boardSeasonGames(item.row)));
  boardPanel.chart.draw(games, `${item.key}|${size}`);
}

// Build the open row's chart and tracker (the panel's HTML is already in the row).
function boardPanelMount(item) {
  const el = BOARD.querySelector(`[data-bd-row="${CSS.escape(item.key)}"] .lh-bd-panel`);
  if (!el) { boardPanel = null; return; }
  const keepWindow = boardPanel && boardPanel.key === item.key ? boardPanel.window : boardUi.state.window;
  const chart = createPropChart(el.querySelector('[data-slot="chart"]'), { height: 220, maxBarWidth: 44, externalLine: true, animatedBars: true });
  chart.setLine({ book: item.baseLine });
  chart.setTonight(item.row.matchup ? item.row.matchup.replace("@ ", "@") : null);
  const toolbar = createPropToolbar(el.querySelector('[data-slot="tracker"]'), {
    onStep: (value) => boardEdit(item.key, { line: value }),
    onSide: (side) => boardEdit(item.key, { side }),
  });
  toolbar.setSide(item.side);
  boardPanel = { key: item.key, chart, toolbar, window: keepWindow, el };
  boardPanelFill(item);
  boardLoadExtras(item);
}

// The tracker moved the line or picked a side: redraw that row's head and its panel (the chart animates to the new line).
function boardEdit(key, change) {
  const current = boardFindItem(key);
  if (!current) return;
  boardUi.edits[key] = { line: change.line ?? current.line, side: change.side ?? current.side };
  const item = boardFindItem(key);
  const head = BOARD.querySelector(`[data-bd-row="${CSS.escape(key)}"] [data-bd-head]`);
  if (head) head.innerHTML = boardHeadHtml(item, true);
  boardPanelFill(item);
}

// ---------- Drawing the list ----------

function boardRenderTabs() {
  const tabs = document.getElementById("boardTabs");
  if (!tabs) return;
  tabs.innerHTML = PL_STAT_TABS.map((tab) => `
    <li class="nav-item"><button type="button" class="nav-link text-nowrap${tab.code === boardTab ? " active" : ""}" data-bd-tab="${tab.code}" aria-pressed="${tab.code === boardTab}">${tab.label}</button></li>`).join("");
}

function boardSetHeader() {
  const date = document.getElementById("boardDate");
  if (!date) return;
  const iso = boardSlate && boardSlate.date ? boardSlate.date : null;
  // slateDateLabel lives in js/components/top-hit-rates.js (not loaded on the game page)
  date.textContent = !iso ? "" : typeof slateDateLabel === "function" ? slateDateLabel(iso)
    : new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function renderBoard() {
  if (!BOARD) return;
  const list = document.getElementById("boardList");
  const more = document.getElementById("boardMore");
  boardSetHeader();
  more.hidden = true;
  if (boardMessage) {
    boardUi.hide();
    document.getElementById("boardTabs").hidden = true;
    document.getElementById("boardHeads").hidden = true;
    list.removeAttribute("aria-busy");
    list.innerHTML = boardMessageHtml(boardMessage);
    boardPanel = null;
    return;
  }
  if (!boardSlate) {
    list.setAttribute("aria-busy", "true");
    list.innerHTML = boardSkeleton();
    return;
  }
  document.getElementById("boardTabs").hidden = false;
  boardUi.render();
  boardRenderTabs();
  list.removeAttribute("aria-busy");
  if (lhOdds.getBook() && lhOdds.vendors().length === 0) {
    list.innerHTML = boardMessageHtml(`<span class="text-muted">Loading odds...</span>`);
    return;
  }
  const items = boardItems();
  document.getElementById("boardHeads").hidden = items.length === 0;
  if (items.length === 0) {
    const query = boardUi.state.query.trim();
    const book = lhOdds.getBook();
    list.innerHTML = boardMessageHtml(`<span class="text-muted">${query ? `No players match “${boardEsc(query)}”.`
      : book ? `${lhOdds.vendorName(book)} has no lines for these filters.` : `No players with ${BOARD_MIN_SAMPLE}+ games for this prop yet.`}</span>`);
    boardPanel = null;
    return;
  }
  // The open row stays open (and in the list) while it still matches the filters.
  let shown = items.slice(0, boardShown);
  if (boardOpen && !shown.some((item) => item.key === boardOpen)) {
    const open = items.find((item) => item.key === boardOpen);
    if (open) shown = [...shown, open];
    else boardOpen = null;
  }
  const keepWindow = boardPanel ? boardPanel.window : null;
  list.innerHTML = shown.map(boardRowHtml).join("");
  boardPanel = keepWindow !== null && boardOpen ? { key: boardOpen, window: keepWindow } : null;
  const open = shown.find((item) => item.key === boardOpen);
  if (open) boardPanelMount(open);
  if (items.length > boardShown) {
    more.hidden = false;
    more.textContent = `Show more (${items.length - boardShown})`;
  }
}

// Open one player's row (the prop given, else his first row) once the slate is here, with the side picked when given.
function boardOpenLinked(gameId, playerId, code, side) {
  boardPending = { gameId: String(gameId), playerId: Number(playerId), code: code || null, side: side === "over" || side === "under" ? side : null };
}

function boardApplyPending() {
  if (!boardPending || !boardSlate) return null;
  const want = boardPending;
  const rows = boardSlate.rows.filter((row) => String(row.gameId) === want.gameId && row.playerId === want.playerId);
  const row = rows.find((entry) => entry.code === want.code) || rows[0];
  boardPending = null;
  if (!row) return null;
  const key = boardKey(row);
  boardOpen = key;
  // A link to a player on the injury report: show the injured too, or the row would be filtered away.
  if (boardUi.state.injured && plIsInjuredOut(boardSlate.injuries ? boardSlate.injuries[row.playerId] : null)) boardUi.state.injured = false;
  if (want.side) {
    const item = boardItem(row);
    if (item) boardUi.edits[key] = { line: item.line, side: want.side };
  }
  return key;
}

function boardToggle(key) {
  boardOpen = boardOpen === key ? null : key;
  boardPanel = null;
  renderBoard();
  const row = BOARD.querySelector(`[data-bd-row="${CSS.escape(key)}"]`);
  if (row && boardOpen) {
    const top = row.getBoundingClientRect().top;
    if (top < 60 || top > window.innerHeight - 120) row.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
}

const boardUi = BOARD ? createPropListBar({
  idPrefix: "board",
  anchor: document.getElementById("boardHeads"),
  windows: BOARD_WINDOWS,
  window: 10,
  sorts: BOARD_SORTS,
  sort: BOARD_HUNT ? "score" : "rate",
  withGame: !BOARD.hasAttribute("data-single-game"),
  getGames: () => {
    const games = [];
    (boardSlate ? boardSlate.rows : []).forEach((row) => {
      if (row.gameLabel && !games.some((game) => String(game.value) === String(row.gameId))) games.push({ value: row.gameId, label: row.gameLabel, tip: row.tip });
    });
    return games;
  },
  isInjured: (playerId) => plIsInjuredOut(boardSlate && boardSlate.injuries ? boardSlate.injuries[playerId] : null),
  onChange: () => { boardShown = BOARD_STEP_ROWS; renderBoard(); },
}) : null;

// ---------- Events ----------

if (BOARD) {
  BOARD.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-bd-tab]");
    if (tab) {
      boardTab = tab.dataset.bdTab;
      boardShown = BOARD_STEP_ROWS;
      renderBoard();
      return;
    }
    if (event.target.closest("#boardMore")) {
      boardShown += BOARD_STEP_ROWS;
      renderBoard();
      return;
    }
    const head = event.target.closest("[data-bd-head]");
    if (!head) return;
    // Buttons and links inside the row (Add, the odds chip) do their own thing; anything else opens / closes the row.
    if (!event.target.closest("[data-bd-toggle]") && event.target.closest("button, a, input, label, [data-hunt-add]")) return;
    boardToggle(head.closest("[data-bd-row]").dataset.bdRow);
  });

  BOARD.addEventListener("change", (event) => {
    if (!event.target.matches("[data-bd-tracker]")) return;
    boardSetTracker(event.target.checked);
    if (boardPanel && boardPanel.el) boardPanel.el.classList.toggle("is-tracker", event.target.checked);
  });

  // The slate for the shown day (or a message instead).
  document.addEventListener("lh-top-slate", (event) => {
    const { slate, message } = event.detail || {};
    if (message) {
      boardSlate = null;
      boardMessage = message;
      renderBoard();
      return;
    }
    if (!slate) return;
    const newDay = !boardSlate || boardSlate.date !== slate.date;
    boardSlate = slate;
    boardMessage = null;
    if (newDay) {
      boardOpen = null;
      boardPanel = null;
      boardShown = BOARD_STEP_ROWS;
      Object.keys(boardUi.edits).forEach((key) => delete boardUi.edits[key]);
      if (boardUi.state.game !== "all") boardUi.state.game = "all";
    }
    const linked = boardApplyPending();
    renderBoard();
    if (linked) {
      const row = BOARD.querySelector(`[data-bd-row="${CSS.escape(linked)}"]`);
      if (row) row.scrollIntoView({ block: "start" });
    }
    if (BOARD_HUNT && slate.date && (!boardHunts || boardHunts.date !== slate.date)) {
      const request = ++boardHuntsRequest;
      boardHunts = null;
      loadHunts(slate.date)
        .then((data) => {
          if (request !== boardHuntsRequest) return;
          boardHunts = { date: slate.date, ...boardIndexHunts(data) };
          renderBoard();
        })
        .catch((error) => {
          if (request !== boardHuntsRequest) return;
          console.warn("Hunt Score unavailable:", error);
          boardHunts = { date: slate.date, byLine: {}, byStat: {} };
          renderBoard();
        });
    }
  });

  // A new day is loading (the Today page's date pager).
  document.addEventListener("lh-top-loading", () => {
    boardSlate = null;
    boardMessage = null;
    renderBoard();
  });

  // The odds arrived later (a slate read from the cache): the chips, Add buttons and tracker fill in.
  document.addEventListener("lh-odds-ready", () => { if (boardSlate) renderBoard(); });
  document.addEventListener("lh-book-change", () => { if (boardSlate) renderBoard(); });

  renderBoard();
}
