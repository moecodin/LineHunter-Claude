// LineHunter - js/pages/player.js
// The player page: player.html?id=PLAYER_ID&prop=pts
//   1. Back link   2. Header with injury badge and next game   3. Season averages
//   4. Prop chart with tabs, L5/L10/L20/Season, All/Home/Away and the alt line   5. Game log table
//
// Uses js/core/stats.js (data, hit rates) and js/components/propChart.js (the chart, shared with the game page's drawer).

const playerParams = new URLSearchParams(window.location.search);
const playerId = Number(playerParams.get("id")) || null; // Number("") is 0, so || null = "none"

const PLAYER_GAMES_NEEDED = 20; // L20 is the biggest window: fewer games this season = add last season's

// All / Home / Away
const SPLITS = [
  { label: "All", value: "all" },
  { label: "Home", value: "home" },
  { label: "Away", value: "away" },
];

// The game log column to highlight for each prop tab ("pra" = points + rebounds + assists).
const PROP_TO_COLUMN = { points: "pts", rebounds: "reb", assists: "ast", threes: "fg3m", points_rebounds_assists: "pra" };

// What the prop section shows. ?prop=pts in the address picks the starting tab.
const pageState = {
  propType: PROP_CODES[playerParams.get("prop")] || "points", // "pts" -> "points" (js/core/stats.js)
  windowSize: 10,
  split: "all",
  roleMetric: "minutes", // the Role card: "minutes" or "usage"
  teammates: {}, // { teammateId: "with" | "without" }: a teammate not in here is neutral (no filter)
};

// Filled in by loadPlayerPage().
let player = null;              // name, position, jersey, team
let playerLogs = null;          // { current: [...], previous: [...] } newest first
let usingCurrentSeason = true;  // false = no games this season yet, so "Season" means last season
let nextGame = null;            // the team's next game, or null
let sidePlayers = null;         // { team: [...], opponent: [...] } players with lines in the next game
let sideLines = {};             // sideLines[playerId][propType] = line value
let advancedByGame = {};        // advancedByGame[gameId] = { usage, touches, passes, secAst, rebChances } (advanced stats), filled in after the page loads
let usageStatus = "loading";    // "loading", "ready" or "failed": the advanced stats download
let latestView = null;          // the numbers behind the chart on screen ({ result, line, tab }): the share picture uses them
let teammates = null;           // the top 8 teammates by minutes (see loadTeammates), or null while loading
let sideTab = "team";           // "team" or "opponent"
let linesByProp = {};           // linesByProp.points = that prop's line for the next game

// The small Role chart under it (js/components/roleChart.js).
const roleChart = createRoleChart(document.getElementById("roleChart"), { height: 160 });

// The shared chart (js/components/propChart.js). − / + / Reset redraw the hit rate, chart and game log.
const playerChart = createPropChart(document.getElementById("playerChart"), {
  height: 240,
  maxBarWidth: 56,
  animatedBars: true,                          // compact HTML bars that move between ranges (js/components/animatedBars.js)
  externalLine: true,                          // the prop toolbar above moves the line (research mode keeps the milestone control)
  onBarClick: (game) => openGameSummary(game),
  onLineChange: () => renderProps(),
});

// The prop toolbar (js/components/prop-toolbar.js): stat tabs, the − / + line stepper, Over / Under, best odds, Add to My Hunts.
// ?side=under (from a Top Hit Rates / Hit List link) starts with that side picked.
const playerToolbar = createPropToolbar(document.getElementById("playerToolbar"), {
  statTabs: document.getElementById("playerPropTabs"),
  showHead: true,
  onStep: (value) => { playerChart.setActiveLine(value); renderProps(); },
  onSide: () => renderProps(),
});
playerToolbar.setSide(["over", "under"].includes(playerParams.get("side")) ? playerParams.get("side") : null);

// ---------- Small helpers ----------

// The date on this computer as "2026-10-16" ("en-CA" happens to format dates exactly that way).
function apiDate(date) {
  return date.toLocaleDateString("en-CA");
}

// "2026-10-20" -> "Tue, Oct 20"
function weekdayDate(isoDate) {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// The season the averages and "Season" window use: this one, or last one if no games yet.
function seasonLogs() {
  return (usingCurrentSeason ? playerLogs.current : playerLogs.previous).filter(playedInGame);
}

// Keep only the games that pass the Home / Away split and (unless useTeammates is false) the With / Without chips.
function splitLogs(logs, split, useTeammates = true) {
  const keep = (log) =>
    (split === "all" || (split === "home") === log.isHome) && (!useTeammates || passesTeammateFilter(log));
  return { current: logs.current.filter(keep), previous: logs.previous.filter(keep) };
}

// The player's season average for one stat ("pts", "pts+reb+ast", ...), or null.
function seasonAverage(stat) {
  return calculateHitRate(seasonLogs(), stat, 0, "all").average;
}

// Set the line for the current tab: the book line for the next game, or if there isn't one,
// the season average rounded to the nearest .5 (labeled "No line"). Clears any alt line.
function resetPlayerLine() {
  const prop = linesByProp[pageState.propType];
  const stat = CHART_STAT_TABS.find((tab) => tab.propType === pageState.propType).stat;
  const average = seasonAverage(stat);
  playerChart.setLine({
    book: lhOdds.startLine(playerId, pageState.propType, prop ? Number(prop.line_value) : null), // the chosen sportsbook's own line, if one is picked
    fallback: average === null ? null : Math.round(average * 2) / 2,
    // Research mode: the milestone starts at the season average rounded to a whole number (at least 1).
    milestone: average === null ? null : Math.max(1, Math.round(average)),
    average,
  });
}

// ---------- 2. Header ----------

// The injury badge: red "OUT", yellow "Doubtful", yellow "Q" for anything else (Day-To-Day, Questionable...).
function injuryBadge(injury) {
  const status = (injury.status || "").toLowerCase();
  if (status === "out") return { label: "OUT", className: "is-out" };
  if (status.includes("doubt")) return { label: "Doubtful", className: "is-q" };
  return { label: "Q", className: "is-q" };
}

// Hover (or tap on a phone) the badge to see the description and return date, in a Bootstrap popover.
function setUpInjuryPopover(button, injury) {
  // Built with textContent, so text from the API can never turn into HTML.
  const content = document.createElement("div");
  const description = document.createElement("div");
  description.textContent = injury.description || "No details yet.";
  content.appendChild(description);
  if (injury.return_date) {
    const back = document.createElement("div");
    back.className = "mt-2 fw-semibold";
    back.textContent = `Expected back: ${weekdayDate(injury.return_date)}`;
    content.appendChild(back);
  }

  // Phones can't hover, so there a tap opens and closes it.
  const canHover = window.matchMedia("(hover: hover)").matches;
  new bootstrap.Popover(button, {
    title: injury.status,
    content,
    html: true, // needed to show our element; its text was set safely above
    trigger: canHover ? "hover focus" : "click",
    placement: "bottom",
    customClass: "lh-popover",
  });
}

function renderHeader(injury) {
  const name = `${player.first_name} ${player.last_name}`;
  document.title = `${name} · LineHunter`;

  const team = player.team ? player.team.abbreviation : "";
  // The team as a badge in its color (with the next game's clash rule when there is one), then the position.
  const awayTeam = nextGame ? nextGame.visitor_team.abbreviation : undefined;
  const homeTeam = nextGame ? nextGame.home_team.abbreviation : undefined;
  const meta = player.position || ""; // the team badge itself sits next to the name, below
  const teamBadge = teamBadgeHtml(team, awayTeam, homeTeam);

  // "vs BOS · Tue, Oct 20" at home, "@ BOS · Tue, Oct 20" away. Links to that game's page.
  let nextGameHtml = `<span class="text-muted">No upcoming games</span>`;
  if (nextGame) {
    const isHome = nextGame.home_team.abbreviation === team;
    const opponent = isHome ? nextGame.visitor_team.abbreviation : nextGame.home_team.abbreviation;
    nextGameHtml = `<a href="game.html?id=${nextGame.id}" class="lh-next-game">
      ${isHome ? "vs" : "@"} ${opponent} · ${weekdayDate(nextGame.date)} <span aria-hidden="true">›</span></a>`;
  }

  const badge = injury ? injuryBadge(injury) : null;
  document.getElementById("playerHeader").innerHTML = `
    <div>
      <div class="d-flex flex-wrap align-items-center gap-2">
        <h1 class="lh-display lh-player-name mb-0">${name}${player.jersey_number ? ` <span class="lh-player-jersey">#${player.jersey_number}</span>` : ""}</h1>
        ${teamBadge}
        ${badge ? `<button type="button" class="lh-injury-badge ${badge.className}" id="injuryBadge"
                     aria-label="Injury: ${injury.status}. Show details">${badge.label}</button>` : ""}
      </div>
      <div class="lh-label mt-2">${meta}</div>
      <div class="mt-3 d-flex flex-wrap align-items-center gap-2">
        <span class="lh-label">Next game</span>
        ${nextGameHtml}
      </div>
    </div>`;

  if (badge) setUpInjuryPopover(document.getElementById("injuryBadge"), injury);
}

// ---------- 3. Season averages ----------

function renderAverages() {
  const games = seasonLogs();
  const label = document.getElementById("playerAveragesLabel");
  const strip = document.getElementById("playerAverages");
  strip.removeAttribute("aria-busy");
  strip.classList.remove("placeholder-glow");

  if (games.length === 0) {
    label.textContent = "Season averages";
    strip.innerHTML = `<div class="text-muted">No games yet.</div>`;
    return;
  }

  label.textContent = `${usingCurrentSeason ? "This season" : "Last season"} · ${games.length} games`;
  const minutes = games.reduce((total, log) => total + (Number(String(log.min).split(":")[0]) || 0), 0) / games.length;
  const boxes = [
    ["PTS", seasonAverage("pts")],
    ["REB", seasonAverage("reb")],
    ["AST", seasonAverage("ast")],
    ["3PM", seasonAverage("fg3m")],
    ["MIN", minutes],
  ];
  strip.innerHTML = boxes.map(([name, value]) => `
    <div class="lh-avg-box">
      <div class="lh-label">${name}</div>
      <div class="lh-avg-value">${formatStatValue(value)}</div>
    </div>`).join("");
}

// ---------- 4. Props ----------

function renderPropTabs() {
  const tabs = document.getElementById("playerPropTabs");
  tabs.innerHTML = "";

  CHART_STAT_TABS.forEach((option) => {
    const item = document.createElement("li");
    item.className = "nav-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = option.propType === pageState.propType ? "nav-link active text-nowrap" : "nav-link text-nowrap";
    button.textContent = option.label;
    button.addEventListener("click", () => {
      pageState.propType = option.propType;
      playerToolbar.setSide(null); // a new prop starts with nothing picked
      // Keep ?prop= in the address up to date, so a refresh or a shared link opens this tab.
      history.replaceState(null, "", `?id=${playerId}&prop=${propCode(option.propType)}`);
      if (playerLogs) resetPlayerLine(); // a new prop starts back on its own line
      renderPropTabs();
      renderProps();
      renderSidePlayers();
    });

    item.appendChild(button);
    tabs.appendChild(item);
  });
}

function renderRoleToggle() {
  renderToggleButtons(document.getElementById("roleMetric"), [
    { label: "Minutes", value: "minutes" },
    { label: "Usage %", value: "usage" },
  ], pageState.roleMetric, (metric) => {
    pageState.roleMetric = metric;
    renderRoleToggle();
    renderProps();
  });
}

function renderToggles() {
  renderWindowButtons(document.getElementById("playerWindows"), pageState.windowSize, (size) => {
    pageState.windowSize = size;
    renderToggles();
    renderProps();
  });
  renderToggleButtons(document.getElementById("playerSplits"), SPLITS, pageState.split, (split) => {
    pageState.split = split;
    renderToggles();
    renderProps();
  });
}

// The prop toolbar for the current tab: the line the chart is on, the side picked, the best odds and the Add button.
function renderToolbar() {
  const isHome = nextGame && player && player.team ? nextGame.home_team.id === player.team.id : null;
  const opp = nextGame && isHome !== null ? (isHome ? nextGame.visitor_team.abbreviation : nextGame.home_team.abbreviation) : "";
  const team = player && player.team ? player.team.abbreviation : "";
  playerToolbar.render({
    head: player ? { name: `${player.first_name} ${player.last_name}`, matchup: opp ? `${team} ${isHome ? "vs" : "@"} ${opp}` : team } : null,
    line: isResearchMode() ? null : playerChart.activeLine(),
    mainLine: playerChart.mainLine(),
    stat: pageState.propType,
    legBase: {
      playerId: player ? player.id : playerId,
      player: player ? `${player.first_name} ${player.last_name}` : "",
      team,
      opp,
      gameId: nextGame ? nextGame.id : null,
      tipoff: nextGame ? nextGame.datetime || null : null,
      stat: pageState.propType,
    },
  });
}

// The game log: one row per game in the window and split, newest first.
// The selected prop's column is highlighted, and its numbers are green / red / gray against the line.
function renderGameLog(games, result, line) {
  const column = PROP_TO_COLUMN[pageState.propType];
  document.querySelectorAll(".lh-game-log th[data-col]").forEach((header) => {
    header.classList.toggle("lh-col-active", header.dataset.col === column);
  });

  const body = document.getElementById("gameLogBody");
  body.classList.remove("placeholder-glow");
  const more = document.getElementById("gameLogMore");
  if (games.length === 0) {
    body.innerHTML = `<tr><td colspan="13" class="text-muted">No games for these filters.</td></tr>`;
    more.innerHTML = "";
    updateGameLogToggle(0);
    return;
  }

  const rowsHtml = games.map((log, index) => {
    const row = result.games[index]; // the same game, as calculateHitRate saw it
    const values = { min: row.minutes, pts: log.pts, reb: log.reb, ast: log.ast, fg3m: log.fg3m, pra: log.pts + log.reb + log.ast };

    const cell = (key) => {
      if (key !== column) return `<td class="text-end">${values[key]}</td>`;
      let vsLine = "";
      if (line !== null) vsLine = values[key] > line ? "is-over" : values[key] < line ? "is-under" : "is-push";
      return `<td class="text-end lh-col-active ${vsLine}">${values[key]}</td>`;
    };
    // Made / attempted: "7/18"
    const shooting = (made, attempted) => `<td class="text-end text-nowrap">${made ?? 0}/${attempted ?? 0}</td>`;
    const usage = (advancedFor(log) || {}).usage;

    return `<tr>
      <td class="text-nowrap">${monthDayDate(row.date)}</td>
      <td class="text-nowrap">${opponentLabel(row)}</td>
      <td class="text-nowrap">${gameResultHtml(row) || "–"}</td>
      ${cell("min")}
      ${shooting(log.fgm, log.fga)}
      ${shooting(log.fg3m, log.fg3a)}
      ${shooting(log.ftm, log.fta)}
      ${["pts", "reb", "ast", "fg3m", "pra"].map(cell).join("")}
      <td class="text-end">${usage === undefined ? "–" : `${usage.toFixed(1)}%`}</td>
    </tr>`;
  });

  // The 10 most recent games (within the current filters) show right away; the rest wait behind the button.
  body.innerHTML = rowsHtml.slice(0, GAME_LOG_DEFAULT_ROWS).join("");
  more.innerHTML = rowsHtml.slice(GAME_LOG_DEFAULT_ROWS).join("");
  updateGameLogToggle(rowsHtml.length);
}

// "Show all games (N)" / "Show fewer". The button only exists when there are more than 10 games.
const GAME_LOG_DEFAULT_ROWS = 10;
let gameLogTotal = 0;

function updateGameLogToggle(total) {
  gameLogTotal = total;
  const button = document.getElementById("gameLogToggle");
  button.hidden = total <= GAME_LOG_DEFAULT_ROWS;
  const isOpen = document.getElementById("gameLogMore").classList.contains("show");
  document.getElementById("gameLogToggleText").textContent = isOpen ? "Show fewer" : `Show all games (${total})`;
}

["shown.bs.collapse", "hidden.bs.collapse"].forEach((eventName) => {
  document.getElementById("gameLogMore").addEventListener(eventName, () => updateGameLogToggle(gameLogTotal));
});

// ---------- Advanced stats (usage, touches, passes, rebound chances) ----------

const ADVANCED_URL = "/api/bdl/nba/v2/stats/advanced";

// The advanced stats for every game in the seasons we show, as { gameId: { usage, touches, passes, secAst, rebChances } }.
// Saved in sessionStorage for 10 minutes. A game the API has no advanced stats for is simply missing,
// and a missing field is null: the page shows "–".
async function loadAdvanced() {
  const season = currentSeasonYear();
  const needPrevious = playerLogs.previous.length > 0; // same seasons as the game logs
  const key = `lh-advanced:${playerId}:${season}:${needPrevious ? 2 : 1}`;

  let saved = null;
  try {
    const cached = JSON.parse(sessionStorage.getItem(key));
    if (cached && Date.now() - cached.savedAt < TEAMMATE_CACHE_MS) saved = cached.games;
  } catch (error) {
    saved = null;
  }

  if (!saved) {
    const seasons = needPrevious ? [season, season - 1] : [season];
    const lists = await Promise.all(seasons.map((year) =>
      bdlGetAllPages(`${ADVANCED_URL}?player_ids[]=${playerId}&seasons[]=${year}&period=0&per_page=100`)
    ));

    const number = (value) => (value === null || value === undefined || Number.isNaN(Number(value)) ? null : Number(value));
    const rows = lists.flat().map((row) => ({
      gameId: row.game ? row.game.id : row.game_id,
      usage: number(row.usage_percentage),
      touches: number(row.touches),
      passes: number(row.passes),
      secAst: number(row.secondary_assists),
      // "total" if the API sends it, otherwise offensive + defensive chances
      rebChances: number(row.rebound_chances_total) ??
        (number(row.rebound_chances_offensive) !== null && number(row.rebound_chances_defensive) !== null
          ? number(row.rebound_chances_offensive) + number(row.rebound_chances_defensive) : null),
    })).filter((row) => row.gameId !== undefined);

    // Usage can come as 0.284 or as 28.4. If nothing is above 1.5, it's the 0.284 kind.
    const scale = Math.max(0, ...rows.map((row) => row.usage ?? 0)) <= 1.5 ? 100 : 1;
    saved = {};
    rows.forEach((row) => {
      saved[row.gameId] = {
        usage: row.usage === null ? null : Math.round(row.usage * scale * 10) / 10,
        touches: row.touches,
        passes: row.passes,
        secAst: row.secAst,
        rebChances: row.rebChances,
      };
    });

    try {
      sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), games: saved }));
    } catch (error) {
      // storage full or blocked: it just won't be cached
    }
  }
  advancedByGame = saved;
}

// One game's advanced stats, or null if the API had none for it.
function advancedFor(log) {
  return advancedByGame[log.game.id] || null;
}

// ---------- Opportunity card ----------
// Three numbers for the selected prop tab: the average over the filtered games next to the season average,
// with an arrow (up green / down red / grey if within 5%), and one neutral sentence about what changed.
//
// Each metric is one of two kinds:
//   mean:  the average of a per-game number (FGA, touches, minutes...)
//   ratio: total top / total bottom over all the games (3P% = all threes made / all threes attempted),
//          which is more accurate than averaging each game's percentage.
// up / down = the phrase the sentence uses when it's higher / lower than the season average.

const OPPORTUNITY_METRICS = {
  points: [
    { label: "FGA", decimals: 1, mean: (log) => log.fga, up: "taking more shots", down: "taking fewer shots" },
    { label: "FTA", decimals: 1, mean: (log) => log.fta, up: "getting to the line more", down: "getting to the line less" },
    { label: "Touches", decimals: 1, adv: true, mean: (log, adv) => adv && adv.touches, up: "seeing more touches", down: "seeing fewer touches" },
  ],
  rebounds: [
    { label: "Reb chances", decimals: 1, adv: true, mean: (log, adv) => adv && adv.rebChances, up: "more rebound chances than usual", down: "fewer rebound chances than usual" },
    { label: "Rebounds", decimals: 1, mean: (log) => log.reb, up: "grabbing more rebounds", down: "grabbing fewer rebounds" },
    { label: "Conversion %", decimals: 1, unit: "%", adv: true, ratio: { top: (log) => log.reb, bottom: (log, adv) => adv && adv.rebChances },
      up: "converting above the season rate", down: "converting below the season rate" },
  ],
  assists: [
    { label: "Passes", decimals: 1, adv: true, mean: (log, adv) => adv && adv.passes, up: "making more passes", down: "making fewer passes" },
    { label: "Secondary ast", decimals: 1, adv: true, mean: (log, adv) => adv && adv.secAst, up: "more secondary assists", down: "fewer secondary assists" },
    { label: "Ast / 100 passes", decimals: 1, adv: true, ratio: { top: (log) => log.ast, bottom: (log, adv) => adv && adv.passes },
      up: "turning passes into assists at a higher rate", down: "turning passes into assists at a lower rate" },
  ],
  threes: [
    { label: "3PA", decimals: 1, mean: (log) => log.fg3a, up: "attempting more threes", down: "attempting fewer threes" },
    { label: "3P%", decimals: 1, unit: "%", ratio: { top: (log) => log.fg3m, bottom: (log) => log.fg3a },
      up: "shooting threes above the season rate", down: "shooting threes below the season rate" },
    { label: "% shots from 3", decimals: 1, unit: "%", ratio: { top: (log) => log.fg3a, bottom: (log) => log.fga },
      up: "a bigger share of shots coming from three", down: "a smaller share of shots coming from three" },
  ],
  points_rebounds_assists: [
    { label: "Minutes", decimals: 1, mean: (log) => minutesDecimal(log.min), up: "playing more minutes", down: "playing fewer minutes" },
    { label: "Touches", decimals: 1, adv: true, mean: (log, adv) => adv && adv.touches, up: "seeing more touches", down: "seeing fewer touches" },
    { label: "Usage %", decimals: 1, unit: "%", adv: true, mean: (log, adv) => adv && adv.usage, up: "higher usage", down: "lower usage" },
  ],
};

// One metric's number over a list of games, or null if none of them have the data.
function opportunityValue(metric, logs) {
  const present = (value) => value !== null && value !== undefined && !Number.isNaN(value);

  if (metric.ratio) {
    let top = 0;
    let bottom = 0;
    logs.forEach((log) => {
      const adv = advancedFor(log);
      const t = metric.ratio.top(log, adv);
      const b = metric.ratio.bottom(log, adv);
      if (present(t) && present(b)) {
        top += t;
        bottom += b;
      }
    });
    return bottom > 0 ? (top / bottom) * 100 : null;
  }

  const values = logs.map((log) => metric.mean(log, advancedFor(log))).filter(present);
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

// "up", "down" or "flat" (within 5% of the season average, or nothing to compare).
function opportunityDirection(filtered, season) {
  if (filtered === null || season === null || season === 0) return "flat";
  const change = (filtered - season) / Math.abs(season);
  if (change > 0.05) return "up";
  if (change < -0.05) return "down";
  return "flat";
}

const OPPORTUNITY_ARROWS = {
  up: `<i class="bi bi-arrow-up-short lh-opp-up" role="img" aria-label="Higher than the season average"></i>`,
  down: `<i class="bi bi-arrow-down-short lh-opp-down" role="img" aria-label="Lower than the season average"></i>`,
  flat: `<i class="bi bi-dash lh-opp-flat" role="img" aria-label="About the same as the season average"></i>`,
};

// "taking more shots, getting to the line less and seeing more touches than the season average."
function opportunityInsight(metrics, directions) {
  const changed = metrics.map((metric, index) => ({ metric, direction: directions[index] })).filter((item) => item.direction !== "flat");
  if (changed.length === 0) return "In line with the season averages.";
  const phrases = changed.map((item) => (item.direction === "up" ? item.metric.up : item.metric.down));
  const joined = phrases.length > 1 ? `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}` : phrases[0];
  const sentence = joined.charAt(0).toUpperCase() + joined.slice(1);
  // The rate-style phrases already say "the season rate", so only the count phrases need the ending.
  return /season rate|at a (higher|lower) rate/.test(joined) ? `${sentence}.` : `${sentence} than the season average.`;
}

// games = the filtered game logs (the same ones as the chart), newest first.
function renderOpportunity(games) {
  const box = document.getElementById("opportunityBody");
  const tab = CHART_STAT_TABS.find((option) => option.propType === pageState.propType);
  document.getElementById("opportunityTab").textContent = tab.label;
  const metrics = OPPORTUNITY_METRICS[pageState.propType];
  const seasonGames = seasonLogs();

  const results = metrics.map((metric) => {
    // Advanced stats still downloading, or failed: say so instead of guessing.
    if (metric.adv && usageStatus === "loading") return { text: "…", season: "", direction: "flat" };
    const filtered = games.length ? opportunityValue(metric, games) : null;
    const season = opportunityValue(metric, seasonGames);
    const format = (value) => (value === null ? "–" : `${value.toFixed(metric.decimals)}${metric.unit || ""}`);
    return { text: format(filtered), season: format(season), direction: opportunityDirection(filtered, season) };
  });

  const loading = metrics.some((metric) => metric.adv) && usageStatus === "loading";
  let insight = opportunityInsight(metrics, results.map((result) => result.direction));
  if (games.length === 0) insight = "No games for these filters.";
  else if (results.every((result) => result.text === "–")) insight = "No data for these games.";
  if (loading) insight = "Loading advanced stats...";

  box.innerHTML = `
    <div class="lh-opp-grid">
      ${metrics.map((metric, index) => `
        <div>
          <div class="lh-label">${metric.label}</div>
          <div class="lh-drawer-stat">${results[index].text}${results[index].text === "–" || results[index].text === "…" ? "" : OPPORTUNITY_ARROWS[results[index].direction]}</div>
          <div class="small text-muted">Season ${results[index].season}</div>
        </div>`).join("")}
    </div>
    ${insight ? `<div class="lh-opp-insight">${insight}</div>` : ""}`;
}

// ---------- Role card (minutes / usage trend) ----------

// Draws the Role chart for the same games as the main chart. games = log lines newest first,
// rows = the same games from calculateHitRate (same order).
function renderRole(games, rows) {
  try {
    drawRole(games, rows);
  } catch (error) {
    console.error("Role chart failed:", error);
    roleChart.clear("Couldn't draw the Role chart.");
  }
}

function drawRole(games, rows) {
  const metric = pageState.roleMetric;
  if (games.length === 0) {
    roleChart.clear("No games for these filters.");
    return;
  }
  if (metric === "usage" && usageStatus === "loading") {
    roleChart.clear("Loading usage...");
    return;
  }
  if (metric === "usage" && usageStatus === "failed") {
    roleChart.clear("Usage data is unavailable right now.");
    return;
  }

  // The chart reads left to right, so oldest first.
  const points = games.map((log, index) => ({
    row: rows[index],
    minutes: minutesDecimal(log.min),
    usage: ((advancedFor(log) || {}).usage ?? null),
  })).reverse();

  // The dashed line: the player's average over the whole season (not the filter), for the same metric.
  const seasonValues = seasonLogs()
    .map((log) => (metric === "minutes" ? minutesDecimal(log.min) : ((advancedFor(log) || {}).usage ?? null)))
    .filter((value) => value !== null);
  const average = seasonValues.length ? seasonValues.reduce((total, value) => total + value, 0) / seasonValues.length : null;

  roleChart.draw(points, { metric, average });
}

// Hit rate, average, chart and game log for the current tab, window, split and line.
function renderProps() {
  if (!playerLogs) return; // still loading: the skeletons are showing

  const tab = CHART_STAT_TABS.find((option) => option.propType === pageState.propType);
  // The number games are scored against: the alt line / book line (lines mode), or the milestone minus 0.5 (research
  // mode, where "25+" means >= 25: see lineForScoring in js/components/propChart.js).
  const line = lineForScoring(playerChart.activeLine());

  // The games in this window and split, newest first (pickWindowLogs in js/core/stats.js),
  // scored against the line. The table below uses the very same games.
  const games = pickWindowLogs(splitLogs(playerLogs, pageState.split), pageState.windowSize, usingCurrentSeason);
  const result = calculateHitRate(games, tab.stat, line ?? 0, "all");

  // The same window and split WITHOUT the teammate chips: the "All games" line in the With / Without card.
  const allGames = pickWindowLogs(splitLogs(playerLogs, pageState.split, false), pageState.windowSize, usingCurrentSeason);
  renderWithoutSummary(result, calculateHitRate(allGames, tab.stat, line ?? 0, "all"), line);

  renderToolbar();

  const summary = document.getElementById("playerSummary");
  const message = document.getElementById("playerMessage");
  latestView = result.totalGames === 0 ? null : { result, line, tab };
  document.getElementById("playerShare").disabled = latestView === null;

  if (result.totalGames === 0) {
    summary.innerHTML = "";
    document.getElementById("playerMilestone").textContent = "";
    playerChart.clear();
    message.textContent = Object.keys(pageState.teammates).length
      ? "No games match these filters."
      : pageState.split === "all" ? "No games played yet." : `No ${pageState.split} games in this window.`;
    message.hidden = false;
    renderGameLog([], result, line);
    renderRole([], []);
    renderOpportunity([]);
    return;
  }

  const hitRateText = line === null
    ? "–"
    : `${result.hits}/${result.totalGames} <span class="text-muted">(${Math.round(result.hitRate)}%)</span>`;
  summary.innerHTML = `
    <div class="lines-only">
      <div class="lh-label">Hit rate${line !== null ? ` <span class="lh-alt-tag">o${lineText(line)}</span>` : ""}</div>
      <div class="lh-drawer-stat">${hitRateText}</div>
    </div>
    <div>
      <div class="lh-label">Average</div>
      <div class="lh-drawer-stat">${formatStatValue(result.average)}</div>
    </div>`;

  // Research mode: "25+ PTS in 7 of last 10 · avg 24.3"
  const milestone = playerChart.activeLine();
  const milestoneBox = document.getElementById("playerMilestone");
  if (milestone !== null) {
    const outOf = typeof pageState.windowSize === "number" ? `last ${result.totalGames}` : `${result.totalGames} games`;
    milestoneBox.innerHTML = `<strong>${milestone}+ ${propCode(pageState.propType).toUpperCase()}</strong> in <strong>${result.hits} of ${outOf}</strong> · avg ${formatStatValue(result.average)}`;
  } else {
    milestoneBox.textContent = "";
  }

  message.hidden = !(pageState.windowSize === "season" && !usingCurrentSeason);
  message.textContent = "This season hasn't started, so Season shows last season.";

  // The chart reads left to right, so oldest goes first.
  playerChart.setTonight(Boolean(nextGame)); // the dashed "?" bar for the next game
  playerChart.draw([...result.games].reverse(), `${pageState.propType}|${pageState.windowSize}|${pageState.split}|${JSON.stringify(pageState.teammates)}`);
  renderGameLog(games, result, line);
  renderRole(games, result.games);
  renderOpportunity(games);
}

// ---------- With / Without teammates ----------
//
// How a game is counted for a teammate chip:
//   PLAYED     = the teammate has a stat line in that game with minutes above 0 (playedInGame, js/core/stats.js),
//                and that line is for the SAME team as our player's line in that game.
//   WITH       = the teammate PLAYED in the game.
//   WITHOUT    = the teammate was on the team at that time but did NOT play (no line, or 0 minutes).
//   ON THE TEAM = a game date is on or after the teammate's first stat line for that team (even a 0 minute
//                one). Before that they hadn't joined yet, so the game is left out while their chip is on.
// Several chips combine with AND: a game must pass every one.

const TOP_TEAMMATES = 8;
const TEAMMATE_CACHE_PREFIX = "lh-with-without:";
const TEAMMATE_CACHE_MS = 10 * 60 * 1000; // like the homepage's hit rates: saved for 10 minutes

// "34:30" -> 34.5, "00" -> 0
function minutesDecimal(min) {
  const [minutes, seconds] = String(min || "0").split(":");
  return (Number(minutes) || 0) + (Number(seconds) || 0) / 60;
}

// Does this game pass every active chip?  log = one of OUR player's stat lines.
function passesTeammateFilter(log) {
  return Object.entries(pageState.teammates).every(([id, mode]) => {
    const mate = teammates && teammates.find((candidate) => candidate.id === Number(id));
    if (!mate) return true;
    const playedForTeam = mate.played.get(log.game.id) === log.team.id;
    if (mode === "with") return playedForTeam;
    return mate.wasOnTeam(log.team.id, log.game.date) && !mate.played.has(log.game.id);
  });
}

// Turns the saved lines ([gameId, date, teamId, minutes, season]) into what the filter needs.
function buildTeammate(saved, currentTeamId) {
  const played = new Map();   // gameId -> the team they played for
  const firstDate = {};       // teamId -> date of their first stat line for that team
  const lastDate = {};        // teamId -> date of their last stat line for that team
  let totalMinutes = 0;
  saved.lines.forEach(([gameId, date, teamId, minutes]) => {
    if (!firstDate[teamId] || date < firstDate[teamId]) firstDate[teamId] = date;
    if (!lastDate[teamId] || date > lastDate[teamId]) lastDate[teamId] = date;
    if (minutes > 0) {
      played.set(gameId, teamId);
      totalMinutes += minutes;
    }
  });
  return {
    id: saved.id,
    shortName: `${saved.first[0]}. ${saved.last}`,
    initials: `${saved.first[0]}${saved.last[0]}`.toUpperCase(),
    minutesPerGame: played.size ? totalMinutes / played.size : 0,
    played,
    // A current teammate is still on the team today, so no end date for the current team.
    wasOnTeam: (teamId, date) => Boolean(firstDate[teamId]) && date >= firstDate[teamId] && (teamId === currentTeamId || date <= lastDate[teamId]),
  };
}

// Reads the saved copy from sessionStorage if it's under 10 minutes old.
function readTeammateCache(key) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    return saved && Date.now() - saved.savedAt < TEAMMATE_CACHE_MS ? saved.teammates : null;
  } catch (error) {
    return null; // storage blocked or the text isn't valid: just ask the API
  }
}

// After the main player's data is in: the team's roster, then ALL of their games in two lists of
// batched requests (current season, plus last season only if our player's own log reaches into it).
async function loadTeammates() {
  if (!player.team) return;
  const season = currentSeasonYear();
  const needPrevious = playerLogs.previous.length > 0;
  const key = `${TEAMMATE_CACHE_PREFIX}${playerId}:${player.team.id}:${season}:${needPrevious ? 2 : 1}`;

  let saved = readTeammateCache(key);
  if (!saved) {
    const roster = await bdlGetAllPages(`${BDL_BASE}/players/active?team_ids[]=${player.team.id}&per_page=100`);
    const mates = roster.filter((mate) => mate.id !== playerId);
    const ids = mates.map((mate) => mate.id);
    const [current, previous] = await Promise.all([
      fetchGameLogsForPlayers(ids, season),
      needPrevious ? fetchGameLogsForPlayers(ids, season - 1) : {},
    ]);
    // Keep only the few fields the filter needs, so the saved copy stays small.
    const slim = (log) => [log.game.id, log.game.date, log.team.id, minutesDecimal(log.min)];
    saved = mates.map((mate) => ({
      id: mate.id,
      first: mate.first_name,
      last: mate.last_name,
      lines: [...(current[mate.id] || []), ...(previous[mate.id] || [])].map(slim),
    }));
    try {
      sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), teammates: saved }));
    } catch (error) {
      // storage full or blocked: it just won't be cached
    }
  }

  teammates = saved
    .map((mate) => buildTeammate(mate, player.team.id))
    .filter((mate) => mate.played.size > 0)
    .sort((a, b) => b.minutesPerGame - a.minutesPerGame)
    .slice(0, TOP_TEAMMATES);
}

// Each chip cycles neutral -> with -> without -> neutral.
const NEXT_TEAMMATE_MODE = { neutral: "with", with: "without", without: "neutral" };

function renderTeammateChips() {
  const box = document.getElementById("withoutChips");
  box.classList.remove("placeholder-glow");
  box.innerHTML = "";
  if (!teammates || !teammates.length) {
    box.innerHTML = `<span class="text-muted small">No teammate data available.</span>`;
    return;
  }

  teammates.forEach((mate) => {
    const mode = pageState.teammates[mate.id] || "neutral";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `lh-ww-chip is-${mode}`;
    button.setAttribute("aria-label", `${mate.shortName}: ${mode === "neutral" ? "no filter" : mode}. Click to change.`);
    const avatarTeam = player.team ? player.team.abbreviation : "";
    const avatarAway = nextGame ? nextGame.visitor_team.abbreviation : "";
    const avatarHome = nextGame ? nextGame.home_team.abbreviation : "";
    button.innerHTML = `<span class="lh-ww-avatar" data-avatar-team="${avatarTeam}" data-away="${avatarAway}" data-home="${avatarHome}" style="${teamAvatarStyle(avatarTeam, avatarAway || undefined, avatarHome || undefined)}" aria-hidden="true">${mate.initials}</span>
      <span>${mate.shortName}</span>
      ${mode === "neutral" ? "" : `<span class="lh-ww-state">${mode === "with" ? "With" : "Without"}</span>`}`;
    button.addEventListener("click", () => {
      const next = NEXT_TEAMMATE_MODE[mode];
      if (next === "neutral") delete pageState.teammates[mate.id];
      else pageState.teammates[mate.id] = next;
      renderTeammateChips();
      renderProps();
    });
    box.appendChild(button);
  });
  document.getElementById("withoutClear").hidden = Object.keys(pageState.teammates).length === 0;
}

// "6/8 (75%) · avg 27.4", or just the average when there's no line to hit.
function rateText(result, line) {
  if (result.totalGames === 0) return "no games";
  // line is the scoring line: in research mode that is the milestone minus 0.5, so "25+ in 7/10".
  let rate = "";
  if (line !== null) {
    rate = isResearchMode()
      ? `${line + 0.5}+ in ${result.hits}/${result.totalGames} · `
      : `${result.hits}/${result.totalGames} (${Math.round(result.hitRate)}%) · `;
  }
  return `${rate}avg ${formatStatValue(result.average)}`;
}

// "Without J. Duren: 6/8 (75%) · avg 27.4" above "All games: 15/27 (56%) · avg 23.3".
function renderWithoutSummary(filtered, all, line) {
  const box = document.getElementById("withoutSummary");
  const active = Object.entries(pageState.teammates);
  if (!teammates) return;
  if (!active.length) {
    box.innerHTML = `<div class="text-muted small">Tap a teammate once for games with them, twice for games without them.</div>`;
    return;
  }

  const label = active
    .map(([id, mode]) => `${mode === "with" ? "With" : "Without"} ${teammates.find((mate) => mate.id === Number(id)).shortName}`)
    .join(" · ");
  box.innerHTML = `
    <div class="lh-ww-row"><span class="lh-ww-label">${label}</span> ${rateText(filtered, line)}</div>
    <div class="lh-ww-row text-muted"><span class="lh-ww-label">All games</span> ${rateText(all, line)}</div>
    ${filtered.totalGames < 5 ? `<div class="lh-ww-warn">Small sample: only ${filtered.totalGames} ${filtered.totalGames === 1 ? "game" : "games"}.</div>` : ""}`;
}

document.getElementById("withoutClear").addEventListener("click", () => {
  pageState.teammates = {};
  renderTeammateChips();
  renderProps();
});

// ---------- Share the chart as a picture ----------

// "L10 · Home · Without J. Duren": which games the chart is showing.
function shareFilterText() {
  const windowText = pageState.windowSize === "season" ? "Season" : `L${pageState.windowSize}`;
  const splitText = { all: "All games", home: "Home games", away: "Away games" }[pageState.split];
  const mates = Object.entries(pageState.teammates).map(([id, mode]) => {
    const mate = teammates && teammates.find((candidate) => candidate.id === Number(id));
    return mate ? `${mode === "with" ? "With" : "Without"} ${mate.shortName}` : null;
  }).filter(Boolean);
  return [windowText, splitText, ...mates].join(" · ");
}

document.getElementById("playerShare").addEventListener("click", (event) => {
  if (!latestView || !player) return;
  const { result, line, tab } = latestView;
  const hasBookLine = Boolean(linesByProp[pageState.propType]);
  let lineLabel = "–";
  if (line !== null) {
    if (playerChart.isAltLine()) lineLabel = `${lineText(line)} (alt)`;
    else lineLabel = hasBookLine ? lineText(line) : `${lineText(line)} (avg)`; // no book line: the season average starts it
  }
  shareChartCard(playerChart, {
    name: `${player.first_name} ${player.last_name}`,
    meta: [player.team && player.team.abbreviation, player.position].filter(Boolean).join(" · "),
    propLabel: tab.label,
    filterText: shareFilterText(),
    lineText: lineLabel,
    hitRateText: line === null ? "–" : `${result.hits}/${result.totalGames} (${Math.round(result.hitRate)}%)`,
    averageText: formatStatValue(result.average),
  }, event.currentTarget);
});

// ---------- Game summary pop-up (click a bar) ----------

const gameBoxScores = {}; // gameId -> the game's stat lines, so reopening a game doesn't ask the API again
let gameModal = null;

// "34:12" or "34" -> 34
function minutesNumber(min) {
  return Number(String(min || "").split(":")[0]) || 0;
}

// One team's box score as a table. Players who didn't play are left out.
function boxScoreTable(teamName, lines) {
  const played = lines.filter(playedInGame).sort((a, b) => minutesNumber(b.min) - minutesNumber(a.min));
  const rows = played.map((line) => `
    <tr class="${line.player.id === playerId ? "lh-box-current" : ""}">
      <td><a href="player.html?id=${line.player.id}&prop=${propCode(pageState.propType)}" class="lh-player-link">${line.player.first_name[0]}. ${line.player.last_name}</a></td>
      <td class="text-end">${minutesNumber(line.min)}</td>
      <td class="text-end">${line.pts}</td>
      <td class="text-end">${line.reb}</td>
      <td class="text-end">${line.ast}</td>
      <td class="text-end">${line.fg3m}</td>
    </tr>`).join("");
  return `
    <div class="lh-label mt-3 mb-2">${teamName}</div>
    <div class="table-responsive">
      <table class="table table-sm align-middle mb-0 lh-game-log">
        <thead><tr><th>Player</th><th class="text-end">MIN</th><th class="text-end">PTS</th><th class="text-end">REB</th><th class="text-end">AST</th><th class="text-end">3PM</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function openGameSummary(game) {
  if (!game || !game.gameId) return;
  const body = document.getElementById("gameModalBody");
  const title = document.getElementById("gameModalTitle");

  // Header from what we already know: opponent, date, final score.
  const team = player.team ? player.team.abbreviation : "";
  const matchup = game.homeAway === "home" ? `${game.opponent} @ ${team}` : `${team} @ ${game.opponent}`;
  const fullDate = new Date(`${game.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  title.textContent = matchup;
  const result = gameResultHtml(game);
  body.innerHTML = `
    <div class="d-flex flex-wrap align-items-baseline gap-3">
      <span class="text-muted">${fullDate}</span>
      ${result ? `<span class="lh-drawer-stat">${result}</span>` : ""}
    </div>
    <div id="gameModalBox" class="text-muted mt-3">Loading box score…</div>`;

  gameModal = gameModal || new bootstrap.Modal(document.getElementById("gameModal"));
  gameModal.show();

  const box = () => document.getElementById("gameModalBox");
  try {
    if (!gameBoxScores[game.gameId]) {
      gameBoxScores[game.gameId] = await bdlGetAllPages(`${BDL_BASE}/stats?game_ids[]=${game.gameId}&per_page=100`);
    }
    const lines = gameBoxScores[game.gameId];
    // The player's team first, then the other one.
    const byTeam = {};
    lines.forEach((line) => {
      (byTeam[line.team.id] = byTeam[line.team.id] || { name: line.team.full_name || line.team.abbreviation, lines: [] }).lines.push(line);
    });
    const ownId = player.team ? String(player.team.id) : null;
    const ids = Object.keys(byTeam).sort((a, b) => (a === ownId ? -1 : b === ownId ? 1 : 0));
    box().className = "";
    box().innerHTML = ids.length ? ids.map((id) => boxScoreTable(byTeam[id].name, byTeam[id].lines)).join("") : `<span class="text-muted">No box score available.</span>`;
  } catch (error) {
    console.error(error);
    if (box()) box().textContent = `Couldn't load the box score: ${error.message}`;
  }
}

// ---------- 6. Other players (sidebar) ----------

// Every active player on both teams in the next game. Players with no posted line are still listed.
async function loadSidePlayers() {
  if (!nextGame) return;
  const teamIds = [nextGame.home_team.id, nextGame.visitor_team.id];
  const [roster, propsJson] = await Promise.all([
    bdlGetAllPages(`${BDL_BASE}/players/active?${teamIds.map((id) => `team_ids[]=${id}`).join("&")}&per_page=100`),
    // The lines are a bonus: if they fail, the roster still shows.
    bdlGet(`${PROPS_URL}?game_id=${nextGame.id}`).catch(() => ({ data: [] })),
  ]);
  pickOneLinePerPlayer(propsJson.data).forEach((prop) => {
    sideLines[prop.player_id] = sideLines[prop.player_id] || {};
    sideLines[prop.player_id][prop.prop_type] = Number(prop.line_value);
  });

  // Stars first (highest points line), then everyone without a line, A to Z.
  const pointsLine = (p) => (sideLines[p.id] && sideLines[p.id].points) || 0;
  const order = (a, b) => pointsLine(b) - pointsLine(a) || a.last_name.localeCompare(b.last_name);
  const all = roster.filter((p) => p.team).sort(order);
  sidePlayers = {
    team: all.filter((p) => p.team.id === player.team.id),
    opponent: all.filter((p) => p.team.id !== player.team.id),
  };
}

function renderSidePlayers() {
  const tabs = document.getElementById("playerSideTabs");
  const list = document.getElementById("playerSideList");
  const team = player && player.team ? player.team.abbreviation : "Team";
  let opponent = "Opponent";
  if (nextGame) {
    opponent = nextGame.home_team.abbreviation === team ? nextGame.visitor_team.abbreviation : nextGame.home_team.abbreviation;
  }

  tabs.innerHTML = "";
  [["team", team], ["opponent", `vs ${opponent}`]].forEach(([value, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = value === sideTab ? "btn btn-outline-secondary active" : "btn btn-outline-secondary";
    button.textContent = label;
    button.addEventListener("click", () => { sideTab = value; renderSidePlayers(); });
    tabs.appendChild(button);
  });

  const people = sidePlayers ? sidePlayers[sideTab] : [];
  if (!people.length) {
    list.innerHTML = `<div class="text-muted small p-3">${nextGame ? "No players found." : "No upcoming game."}</div>`;
    return;
  }

  // Each row opens that player on the same prop tab, with this prop's line on the right.
  const code = propCode(pageState.propType);
  list.innerHTML = people.map((p) => {
    const line = (sideLines[p.id] || {})[pageState.propType];
    return `<a href="player.html?id=${p.id}&prop=${code}" class="list-group-item list-group-item-action lh-players-row${p.id === playerId ? " is-current" : ""}">
      <span class="lh-players-name">${p.first_name[0]}. ${p.last_name}</span>
      <span class="text-muted small">${p.position || ""}</span>
      ${line === undefined
        ? `<span class="ms-auto text-muted small lines-only">No lines available</span>`
        : `<span class="ms-auto lh-players-line lines-only">${line}</span>`}
    </a>`;
  }).join("");
}

// ---------- Injury report card (sidebar) ----------

// Out first, then Doubtful, Questionable, Day-To-Day.
function injuryOrder(status) {
  const text = (status || "").toLowerCase();
  if (text.startsWith("out")) return 0;
  if (text.includes("doubt")) return 1;
  if (text.includes("question")) return 2;
  return 3;
}

// The badge next to the name: OUT red, DTD yellow, Q light grey (Doubtful uses yellow, anything else grey).
function injuryStatusBadge(status) {
  const text = (status || "").toLowerCase();
  if (text.startsWith("out")) return { label: "OUT", className: "is-out" };
  if (text.includes("day")) return { label: "DTD", className: "is-dtd" };
  if (text.includes("question")) return { label: "Q", className: "is-q" };
  if (text.includes("doubt")) return { label: "Doubtful", className: "is-dtd" };
  return { label: status || "?", className: "is-q" };
}

// The injury reports for this team and, if there is a next game, the opponent: one request, both teams.
async function loadInjuryCard() {
  const box = document.getElementById("injuryList");
  if (!player || !player.team) {
    box.innerHTML = `<div class="text-muted small p-3">No team yet.</div>`;
    return;
  }

  // This team first, then the opponent (if we know the next game).
  const teams = [{ id: player.team.id, abbr: player.team.abbreviation }];
  if (nextGame) {
    const isHome = nextGame.home_team.id === player.team.id;
    const other = isHome ? nextGame.visitor_team : nextGame.home_team;
    teams.push({ id: other.id, abbr: other.abbreviation });
  }

  try {
    const injuries = await bdlGetAllPages(`${BDL_BASE}/player_injuries?${teams.map((team) => `team_ids[]=${team.id}`).join("&")}&per_page=100`);
    box.innerHTML = "";

    teams.forEach((team) => {
      const heading = document.createElement("div");
      heading.className = "lh-injury-team lh-label";
      heading.textContent = team.abbr;
      box.appendChild(heading);

      const hurt = injuries
        .filter((item) => item.player && item.player.team_id === team.id)
        .sort((a, b) => injuryOrder(a.status) - injuryOrder(b.status));
      if (hurt.length === 0) {
        const none = document.createElement("div");
        none.className = "lh-injury-none text-muted small";
        none.textContent = "No injuries reported.";
        box.appendChild(none);
        return;
      }
      hurt.forEach((item) => box.appendChild(injuryItem(item)));
    });
  } catch (error) {
    console.warn("Injury report unavailable:", error);
    box.innerHTML = `<div class="text-muted small p-3">Injury report is unavailable right now.</div>`;
  }
}

// One injured player: name (links to their page), status badge, and a "Details" dropdown with the description.
// Built with createElement / textContent, so text from the API can never turn into HTML.
function injuryItem(item) {
  const badge = injuryStatusBadge(item.status);
  const detailsId = `inj-${item.player.id}`;

  const wrap = document.createElement("div");
  wrap.className = "lh-injury-item";

  const head = document.createElement("div");
  head.className = "lh-injury-head";

  const name = document.createElement("a");
  name.className = "lh-injury-name lh-player-link";
  name.href = `player.html?id=${item.player.id}`;
  name.textContent = `${item.player.first_name.charAt(0)}. ${item.player.last_name}`;

  const status = document.createElement("span");
  status.className = `lh-inj-badge ${badge.className}`;
  status.textContent = badge.label;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "lh-explain-toggle collapsed ms-auto";
  toggle.setAttribute("data-bs-toggle", "collapse");
  toggle.setAttribute("data-bs-target", `#${detailsId}`);
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", detailsId);
  toggle.setAttribute("aria-label", `Show injury details for ${item.player.first_name} ${item.player.last_name}`);
  toggle.innerHTML = `Details <i class="bi bi-chevron-down lh-mi-chevron" aria-hidden="true"></i>`;

  head.append(name, status, toggle);

  const details = document.createElement("div");
  details.className = "collapse";
  details.id = detailsId;
  const text = document.createElement("p");
  text.className = "lh-explain-text lh-injury-desc";
  text.textContent = item.description || "No details yet.";
  details.appendChild(text);
  if (item.return_date) {
    const back = document.createElement("p");
    back.className = "lh-injury-back";
    back.textContent = `Expected back: ${weekdayDate(item.return_date)}`;
    details.appendChild(back);
  }

  wrap.append(head, details);
  return wrap;
}

// ---------- Loading ----------

function showPlayerError(text) {
  document.getElementById("playerHeader").innerHTML = `<div class="text-danger">${text}</div>`;
}

// The team's next game (today's counts until it's final), and this player's lines for it.
async function loadNextGameAndLines() {
  if (!player.team) return;
  const today = new Date();
  const inAMonth = new Date();
  inAMonth.setDate(inAMonth.getDate() + 30);

  const games = await bdlGetAllPages(
    `${BDL_BASE}/games?team_ids[]=${player.team.id}&start_date=${apiDate(today)}&end_date=${apiDate(inAMonth)}&per_page=100`
  );
  nextGame = games
    .filter((game) => game.status !== "Final")
    .sort((a, b) => new Date(a.datetime || a.date) - new Date(b.datetime || b.date))[0] || null;
  if (!nextGame) return;

  // player_id = only this player's props, so it's one small request.
  const propsJson = await bdlGet(`${PROPS_URL}?game_id=${nextGame.id}&player_id=${playerId}`);
  lhOdds.ingest(propsJson.data); // every sportsbook's lines, for the toolbar's best odds (js/data/odds.js)
  pickOneLinePerPlayer(propsJson.data).forEach((prop) => {
    linesByProp[prop.prop_type] = prop;
  });
}

async function loadPlayerPage() {
  renderPropTabs();
  renderToggles();
  renderRoleToggle();

  if (!playerId) {
    showPlayerError("No player picked. Open a player from a game page.");
    return;
  }

  try {
    // 1. Who the player is (we need their team for the next game).
    const playerJson = await bdlGet(`${BDL_BASE}/players/${playerId}`);
    player = playerJson.data;

    // 2. Everything else at the same time: injuries, next game + lines, and game logs
    //    (this season, plus last season if fewer than 20 games: loadPlayerGameLogs in js/core/stats.js).
    //    The injury and next game are extras: if they fail, the page still works without them.
    const [injuries, , loaded] = await Promise.all([
      bdlGet(`${BDL_BASE}/player_injuries?player_ids[]=${playerId}`).then((json) => json.data).catch(() => []),
      loadNextGameAndLines().catch((error) => console.warn("Next game unavailable:", error)),
      loadPlayerGameLogs([playerId], PLAYER_GAMES_NEEDED),
    ]);

    playerLogs = loaded.logsByPlayer[playerId];
    usingCurrentSeason = loaded.showingCurrentSeason;

    renderHeader(injuries[0] || null);
    renderSidePlayers();
    // The Shot Chart is season-level (js/components/shotChart.js): it loads on its own and ignores the filters.
    // Then the Zone Matchup card, which reuses the Shot Chart's numbers. Opponent = the next game's other team.
    const opponentId = nextGame && player.team
      ? (nextGame.home_team.id === player.team.id ? nextGame.visitor_team.id : nextGame.home_team.id)
      : null;
    loadInjuryCard(); // the sidebar's injury report (this team + the next opponent)
    loadShotChart(playerId).then((shotData) => loadZoneMatchup(shotData, opponentId, player.team ? player.team.id : null));
    // Usage % loads after the page is up: the Role card and the USG% column fill in when it arrives.
    loadAdvanced()
      .then(() => { usageStatus = "ready"; renderProps(); })
      .catch((error) => {
        console.warn("Usage unavailable:", error);
        usageStatus = "failed";
        renderProps();
      });
    // The teammate chips load after everything else; the page works without them.
    loadTeammates()
      .then(() => { renderTeammateChips(); renderProps(); })
      .catch((error) => {
        console.warn("Teammates unavailable:", error);
        document.getElementById("withoutChips").innerHTML = `<span class="text-muted small">Teammate data unavailable.</span>`;
      });
    loadSidePlayers().then(renderSidePlayers).catch((error) => console.warn("Players list unavailable:", error));
    renderAverages();
    document.getElementById("playerChartSkeleton").hidden = true;
    resetPlayerLine();
    renderProps();
  } catch (error) {
    console.error(error);
    showPlayerError(`Couldn't load this player: ${error.message}`);
  }
}

// Back: to the page we came from, or the schedule if this page was opened directly.
document.getElementById("playerBack").addEventListener("click", (event) => {
  if (document.referrer && window.history.length > 1) {
    event.preventDefault();
    window.history.back();
  }
});

loadPlayerPage();

// Research mode switched on or off (js/components/nav.js): redraw what depends on it (the chart's line, the With / Without text).
document.addEventListener("lh-mode-change", () => renderProps());
