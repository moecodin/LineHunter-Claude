// LineHunter - js/components/propChart.js
// The shared prop chart: one player's games as bars against a line. Used by the player drawer
// on game.html and by player.html, so both look and behave the same.
//
// What it draws into the box you give it:
//   - the Chart.js bar chart (green = over, red = under, gray = push) with a dashed line at the line
//   - a hover / tap tooltip: "@BOS · Oct 22", "31 PTS · 34 min", "W 112–105"
//   - the alt line control "−  29.5  +", a faint "Book 29.5" marker while the line is moved, and Reset
//
// Also here, because both pages need them: the stat tabs list and the L5 / L10 / L20 / Season buttons.
//
// Needs Chart.js loaded first.
//
// How a page uses it:
//   const chart = createPropChart(document.getElementById("someBox"), { height: 260, onLineChange: redraw });
//   chart.setLine({ book: 26.5, milestone: 25, average: 24.3 }); // when the player or prop changes (also clears any alt line); milestone + average are for research mode
//   const line = chart.activeLine();      // the alt line if one is picked, otherwise the book line
//   chart.draw(gamesOldestFirst, "key");  // the games, scored against activeLine()
//   onLineChange runs when − / + / Reset is clicked: recalculate with activeLine() and draw again.

// The stat tabs on the drawer and the player page. propType matches the odds API's prop names,
// so we can find the line for each tab.
const CHART_STAT_TABS = [
  { propType: "points", label: "Points", stat: "pts" },
  { propType: "rebounds", label: "Rebounds", stat: "reb" },
  { propType: "assists", label: "Assists", stat: "ast" },
  { propType: "threes", label: "3PM", stat: "fg3m" },
  { propType: "points_rebounds_assists", label: "P+R+A", stat: "pts+reb+ast" },
];

// How many recent games to look at. "season" = every game of the season (last season if this one hasn't started).
const WINDOWS = [
  { label: "L5", value: 5 },
  { label: "L10", value: 10 },
  { label: "L20", value: 20 },
  { label: "Season", value: "season" },
];

// Short names for tooltips and tables: "18 PTS · 7 REB · 6 AST = 31"
const STAT_SHORT_NAMES = { pts: "PTS", reb: "REB", ast: "AST", fg3m: "3PM", stl: "STL", blk: "BLK", turnover: "TO" };

// Every color on a chart comes from the CSS variables in css/styles.css, read each time the chart draws (so the theme can change).
function chartColors() {
  const value = (name) => cssVar(name);
  return {
    over: value("--lh-over"),
    under: value("--lh-under"),
    push: value("--lh-push"),     // exactly on the line
    noLine: value("--lh-accent"), // blue when there's no line at all
    line: value("--lh-accent"),   // the dashed line and its arrow ends
    text: value("--lh-text"),     // the numbers above the bars
    textRgb: value("--lh-text-rgb"),
    muted: value("--lh-muted"),   // axis labels
    lineRgb: value("--lh-line-rgb"), // grid lines
  };
}

// While one bar is hovered, the others fade to this see-through version of their color
// (a hex color + "4D" = 30% opacity), and their numbers to this opacity.
const DIMMED_BAR_ALPHA = "4D";
const DIMMED_TEXT_OPACITY = 0.35;

const ALT_STEP = 0.5;  // each − / + click moves the line this much
const ALT_MIN = 0.5;   // the line never goes below this
const MILESTONE_MIN = 1; // research mode: the milestone never goes below this

// ---------- Buttons ----------

// A row of toggle buttons (Bootstrap button group). options = [{ label, value }].
// onPick(value) runs when a button is clicked.
function renderToggleButtons(group, options, activeValue, onPick) {
  group.innerHTML = "";

  options.forEach((option) => {
    const isActive = option.value === activeValue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = isActive ? "btn btn-ghost active" : "btn btn-ghost";
    button.setAttribute("aria-pressed", String(isActive));
    button.textContent = option.label;
    if (option.title) button.title = option.title;
    if (option.disabled) button.disabled = true;
    button.addEventListener("click", () => onPick(option.value));
    group.appendChild(button);
  });
}

// L5 / L10 / L20 / Season. Used above the props table, in the drawer, and on the player page.
function renderWindowButtons(group, activeSize, onPick) {
  renderToggleButtons(group, WINDOWS, activeSize, onPick);
}

// ---------- Text helpers ----------

// Lines always show one decimal, so "18" and "18.5" line up while stepping: 18 -> "18.0"
function lineText(value) {
  return Number(value).toFixed(1);
}

// "2025-10-22" -> "10/22"
function shortDate(isoDate) {
  const [, month, day] = isoDate.split("-");
  return `${Number(month)}/${Number(day)}`;
}

// "2025-10-22" -> "Oct 22" (noon, so the date can't slip a day in any time zone)
function monthDayDate(isoDate) {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Away games get an @ in front, like on a schedule: "@BOS" = at Boston, "BOS" = Boston visited us.
function opponentLabel(game) {
  return game.homeAway === "away" ? `@${game.opponent}` : game.opponent;
}

// "W 112–105" / "L 98–101" from the player's team's side, as HTML with the win / loss color.
// Empty if the score is missing. game = a row from calculateHitRate.
function gameResultHtml(game) {
  if (!game.teamScore && !game.opponentScore) return "";
  const won = game.teamScore > game.opponentScore;
  return `<span class="lh-result ${won ? "is-win" : "is-loss"}">${won ? "W" : "L"} ${game.teamScore}–${game.opponentScore}</span>`;
}

// "31 PTS · 34 min", or for combos two lines: "18 PTS · 7 REB · 6 AST = 31" and "34 min"
function tooltipStatLines(game) {
  const minutes = `${game.minutes} min`;
  if (game.parts.length === 1) {
    return [`${game.value} ${STAT_SHORT_NAMES[game.parts[0].key]} · ${minutes}`];
  }
  const breakdown = game.parts.map((part) => `${part.value} ${STAT_SHORT_NAMES[part.key]}`).join(" · ");
  return [`${breakdown} = ${game.value}`, minutes];
}

// The divider in the animated bars (The Board and the player page). games = oldest first (rows from calculateHitRate);
// seasonGames = how many games the player has played this season. Past 10 games this season: the last 5 games are set apart,
// labeled "Last 5 avg 27.8" (only when the chart shows more than 5). Before that: where last season ends and this one starts,
// labeled "2026-27". Neither applies: null.
function chartDivider(games, seasonGames, season = currentSeasonYear()) {
  if (!games || games.length < 2) return null;
  if (seasonGames > 10) {
    if (games.length <= 5) return null;
    const last = games.slice(-5);
    const average = last.reduce((sum, game) => sum + game.value, 0) / last.length;
    return { beforeIndex: games.length - 5, label: `Last 5 avg ${average.toFixed(1)}` };
  }
  const first = games.findIndex((game) => game.season === season);
  if (first <= 0) return null;
  return { beforeIndex: first, label: `${season}-${String(season + 1).slice(2)}` };
}

// The number a game's stat is compared with. A betting line is compared as "over" (value > line); a research-mode
// milestone "25+" means value >= 25, and every stat is a whole number, so that is the same as value > 24.5.
function lineForScoring(line) {
  if (line === null || line === undefined) return null;
  return isResearchMode() ? line - 0.5 : line;
}

// ---------- Chart.js plugin: the dashed lines and the numbers on the bars ----------
// A Chart.js plugin is an object with functions that Chart.js calls while drawing.
// afterDatasetsDraw runs right after the bars are drawn, so we draw on top of them.

// One horizontal dashed line across the chart at "value". Returns its height in pixels.
function drawDashedLine(chart, value, { color, dash, width }) {
  const { ctx, chartArea, scales } = chart;
  const y = scales.y.getPixelForValue(value); // turns 26.5 into a height in pixels
  ctx.setLineDash(dash);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(chartArea.left, y);
  ctx.lineTo(chartArea.right, y);
  ctx.stroke();
  ctx.setLineDash([]); // back to solid for anything drawn after
  return y;
}

const lineAndValuesPlugin = {
  id: "lhLineAndValues",
  afterDatasetsDraw(chart, args, options) {
    const { ctx, chartArea } = chart;
    ctx.save();

    // 1. A faint second marker: the book's line while an alt line is picked ("Book 29.5"), or in research mode the
    //    season average ("Avg 24.3").
    if (options.bookLine !== null && options.bookLine !== options.line) {
      const y = drawDashedLine(chart, options.bookLine, { color: `rgba(${options.colors.textRgb}, 0.3)`, dash: [3, 4], width: 1 });
      ctx.fillStyle = `rgba(${options.colors.textRgb}, 0.55)`;
      ctx.font = "500 10px Satoshi, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${options.bookLabel || "Book"} ${lineText(options.bookLine)}`, chartArea.right - 2, y - 3);
    }

    // 2. The line we're measuring against (book or alt): dashed blue (the site accent), 6px dash, 4px gap,
    //    with a small arrow marker at each end pointing in at the line, like a handle.
    if (options.line !== null) {
      const y = drawDashedLine(chart, options.line, { color: options.colors.line, dash: [6, 4], width: 2 });
      ctx.fillStyle = options.colors.line;
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y - 5);          // left end: triangle pointing right
      ctx.lineTo(chartArea.left + 8, y);
      ctx.lineTo(chartArea.left, y + 5);
      ctx.closePath();
      ctx.moveTo(chartArea.right, y - 5);         // right end: triangle pointing left
      ctx.lineTo(chartArea.right - 8, y);
      ctx.lineTo(chartArea.right, y + 5);
      ctx.closePath();
      ctx.fill();
    }

    // 3. Each bar's number, just above the bar. While a bar is hovered, the other numbers fade too.
    ctx.fillStyle = options.colors.text;
    ctx.font = "700 12px Satoshi, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const values = chart.data.datasets[0].data;
    const hovered = chart.$lhHovered ?? null; // set by createPropChart's onHover
    chart.getDatasetMeta(0).data.forEach((bar, index) => {
      ctx.globalAlpha = hovered === null || hovered === index ? 1 : DIMMED_TEXT_OPACITY;
      ctx.fillText(values[index], bar.x, bar.y - 4);
    });
    ctx.globalAlpha = 1;

    ctx.restore();
  },
};

// A y-axis for the HTML bars: up to 5 round steps that cover the tallest bar (or line) plus a little headroom.
function niceScale(highest) {
  const target = Math.max(1, Math.ceil(highest));
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find((candidate) => target / candidate <= 5) || 100;
  const scaleMax = Math.ceil(target / step) * step;
  const ticks = [];
  for (let tick = 0; tick <= scaleMax; tick += step) ticks.push(tick);
  return { scaleMax, ticks };
}

// ---------- The chart ----------

// container: an empty element to build the chart in.
// height: chart height in pixels. maxBarWidth: the widest a bar may get (bars fill most of their slot up to this).
// onLineChange: runs after − / + / Reset (redraw the page's numbers).
// onBarClick: optional. Runs with the game's row when a bar is clicked (the player page opens a game summary).
// externalLine: true = the page has its own prop toolbar (js/components/prop-toolbar.js) that moves the line with
//   setActiveLine(), so the chart's own "Alt line − / +" control stays hidden in lines mode. The research-mode milestone
//   control is not affected.
// animatedBars: true = draw HTML / CSS bars instead of the Chart.js canvas (js/components/animatedBars.js): compact bars (3px gap, capped at
//   maxBarWidth, centered when few), keyed by game so they move, grow and shrink when the range, split or stat changes. The player page uses it.
function createPropChart(container, { height = 260, maxBarWidth = 40, onLineChange = () => {}, onBarClick = null, externalLine = false, animatedBars = false } = {}) {
  container.innerHTML = `
    <div class="lh-chart-scroll" hidden>
      <div class="lh-chart-inner" style="height: ${height}px">
        <canvas role="img" aria-label="Bar chart of recent games against the line"></canvas>
        <div class="lh-chart-tooltip" hidden></div>
      </div>
    </div>
    <div class="lh-alt-line mt-3 lines-only" hidden>
      <span class="lh-label">Alt line</span>
      <div class="lh-alt-stepper" role="group" aria-label="Change the line">
        <button type="button" class="lh-alt-btn" data-alt="down" aria-label="Lower the line by 0.5">−</button>
        <output class="lh-alt-value" aria-live="polite"></output>
        <button type="button" class="lh-alt-btn" data-alt="up" aria-label="Raise the line by 0.5">+</button>
      </div>
      <button type="button" class="btn btn-sm btn-ghost" data-alt="reset" hidden>Reset</button>
    </div>
    <!-- Research mode: a milestone ("25+") instead of a betting line. Same look, steps of 1. -->
    <div class="lh-alt-line lh-milestone mt-3 research-only" hidden>
      <span class="lh-label">Milestone</span>
      <div class="lh-alt-stepper" role="group" aria-label="Change the milestone">
        <button type="button" class="lh-alt-btn" data-ms="down" aria-label="Lower the milestone by 1">−</button>
        <output class="lh-alt-value" data-ms="value" aria-live="polite"></output>
        <button type="button" class="lh-alt-btn" data-ms="up" aria-label="Raise the milestone by 1">+</button>
      </div>
      <button type="button" class="btn btn-sm btn-ghost" data-ms="reset" hidden>Reset</button>
    </div>`;

  const parts = {
    scroll: container.querySelector(".lh-chart-scroll"),
    inner: container.querySelector(".lh-chart-inner"),
    canvas: container.querySelector("canvas"),
    tooltip: container.querySelector(".lh-chart-tooltip"),
    alt: container.querySelector(".lh-alt-line"),
    altValue: container.querySelector(".lh-alt-value"),
    altDown: container.querySelector('[data-alt="down"]'),
    altUp: container.querySelector('[data-alt="up"]'),
    altReset: container.querySelector('[data-alt="reset"]'),
    ms: container.querySelector(".lh-milestone"),
    msValue: container.querySelector('[data-ms="value"]'),
    msDown: container.querySelector('[data-ms="down"]'),
    msUp: container.querySelector('[data-ms="up"]'),
    msReset: container.querySelector('[data-ms="reset"]'),
  };

  // The HTML bars (animatedBars only). Hovering a bar shows the same tooltip box as the canvas chart.
  const bars = animatedBars ? createAnimatedBars(parts.inner, {
    maxBarWidth,
    onHover: (game, centerX, topY) => showBarTooltip(game, centerX, topY),
    onLeave: () => { parts.tooltip.hidden = true; },
    onClick: onBarClick,
  }) : null;
  if (bars) {
    parts.canvas.hidden = true;
    // On a phone a tapped bar stays highlighted, like the tooltip, until the next tap somewhere else.
    document.addEventListener("pointerdown", (event) => {
      if (!parts.inner.contains(event.target) || !event.target.closest(".lh-bar")) bars.unhover();
    });
  }

  let chart = null;    // the current Chart.js chart, so we can destroy it before drawing the next
  let chartKey = null; // which games that chart shows (the page decides, e.g. "player|prop|window")
  let games = [];      // the games behind the bars (oldest first), for the tooltip
  let bookLine = null; // the sportsbook's line (null if there is none)
  let baseLine = null; // where the line starts: the book line, or the page's fallback (player page: their average)
  let altLine = null;  // null = no alt line. A number = the line picked with − / +
  let milestoneBase = null; // research mode: where the milestone starts (the season average, rounded), or null
  let milestoneAlt = null;  // research mode: the milestone picked with − / +, or null
  let averageMarker = null; // research mode: the season average, for the faint "Avg 24.3" marker
  let hoveredIndex = null; // which bar the pointer is on (null = none): the others are dimmed
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The number the chart measures against: the betting line (lines mode) or the milestone (research mode).
  const activeLine = () => (isResearchMode() ? milestoneAlt ?? milestoneBase : altLine ?? baseLine);
  const shownLine = activeLine;

  function tooltipHtml(game) {
    const result = gameResultHtml(game);
    return `
      <div class="lh-tip-title">${opponentLabel(game)} · ${monthDayDate(game.date)}${game.postseason ? ` <span class="lh-post-tag">Post-season</span>` : ""}</div>
      ${tooltipStatLines(game).map((text) => `<div>${text}</div>`).join("")}
      ${result ? `<div class="lh-tip-result">${result}</div>` : ""}`;
  }

  // The HTML bars' version: centered above the hovered bar (centerX / topY are in the chart box), kept inside the box.
  function showBarTooltip(game, centerX, topY) {
    parts.tooltip.innerHTML = tooltipHtml(game);
    parts.tooltip.hidden = false;
    const left = Math.min(Math.max(centerX - parts.tooltip.offsetWidth / 2, 0), parts.inner.clientWidth - parts.tooltip.offsetWidth);
    parts.tooltip.style.left = `${left}px`;
    parts.tooltip.style.top = `${Math.max(topY - parts.tooltip.offsetHeight - 8, 0)}px`;
  }

  // Our own tooltip box, drawn by Chart.js's "external" option.
  // Chart.js's built-in tooltip picks its colors before it knows which bar is hovered, so the
  // W / L color could belong to the previous bar. A plain HTML box gets it right every time.
  function showTooltip({ chart: hovered, tooltip }) {
    const item = tooltip.dataPoints && tooltip.dataPoints[0];
    if (tooltip.opacity === 0 || !item) {
      parts.tooltip.hidden = true;
      return;
    }

    parts.tooltip.innerHTML = tooltipHtml(games[item.dataIndex]);
    parts.tooltip.hidden = false;

    // Centered above the bar, but kept inside the chart box so it never gets cut off.
    const bar = hovered.getDatasetMeta(0).data[item.dataIndex];
    const boxWidth = parts.inner.clientWidth;
    const left = Math.min(Math.max(bar.x - parts.tooltip.offsetWidth / 2, 0), boxWidth - parts.tooltip.offsetWidth);
    const top = Math.max(bar.y - parts.tooltip.offsetHeight - 8, 0);
    parts.tooltip.style.left = `${left}px`;
    parts.tooltip.style.top = `${top}px`;
  }

  // Each bar's color: green / red / gray against the line (blue with no line).
  // While a bar is hovered, every other bar gets the faded version.
  function barColors(line) {
    const palette = chartColors();
    return games.map((game, index) => {
      // Research mode has no "under": a bar that misses the milestone is neutral gray, never red.
      const result = isResearchMode() && game.overUnder === "under" ? "push" : game.overUnder;
      const color = line === null ? palette.noLine : palette[result];
      return hoveredIndex === null || hoveredIndex === index ? color : color + DIMMED_BAR_ALPHA;
    });
  }

  // Is the pointer over the chart right now? Chart.js holds mouse moves until the next frame,
  // so a held-back move can arrive just after the pointer left. Those are ignored.
  let pointerInside = false;

  // The pointer moved over the chart (or left it). elements = the bar it's on, if any.
  // Only redraws when it moves to a different bar, using the short "lhHover" fade set up below.
  function handleHover(event, elements) {
    const index = pointerInside && elements.length ? elements[0].index : null;
    if (index === hoveredIndex) return;
    hoveredIndex = index;
    chart.$lhHovered = index; // read by the plugin to fade the other numbers
    chart.data.datasets[0].backgroundColor = barColors(shownLine());
    chart.update("lhHover");
  }

  // Chart.js hides its tooltip when the pointer leaves the chart, but doesn't tell onHover,
  // so we follow the pointer ourselves and un-dim every bar when it leaves.
  // (Pointer events cover mouse, pen and touch.)
  parts.canvas.addEventListener("pointerenter", () => { pointerInside = true; });
  parts.canvas.addEventListener("pointerdown", () => { pointerInside = true; });
  parts.canvas.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "touch") return; // on phones a tap's highlight stays, like the tooltip, until the next tap
    pointerInside = false;
    if (chart) handleHover(null, []);
  });

  function destroyChart() {
    parts.tooltip.hidden = true;
    hoveredIndex = null;
    if (chart) {
      chart.destroy();
      chart = null;
      chartKey = null;
    }
  }

  // The "−  29.5  +" control and the Reset button (lines mode), and the "−  25+  +" one (research mode).
  // Both are always kept up to date; the CSS class on each shows only the one for the current mode.
  function updateAltControl() {
    const line = altLine ?? baseLine;
    parts.alt.hidden = externalLine || line === null; // no line at all = nothing to move (or the page's toolbar does it)
    if (line !== null) {
      parts.altValue.textContent = lineText(line);
      parts.altDown.disabled = line <= ALT_MIN;
      parts.altReset.hidden = altLine === null;
    }

    const milestone = milestoneAlt ?? milestoneBase;
    parts.ms.hidden = milestone === null;
    if (milestone !== null) {
      parts.msValue.textContent = `${milestone}+`;
      parts.msDown.disabled = milestone <= MILESTONE_MIN;
      parts.msReset.hidden = milestoneAlt === null;
    }
  }

  // − / +: move the line by 0.5 (never below 0.5). Landing back on the starting line = no alt line.
  function changeAltLine(change) {
    const current = altLine ?? baseLine;
    if (current === null) return;
    // Math.round(x * 2) / 2 keeps it on a clean .0 / .5 step, even after many clicks.
    const next = Math.max(ALT_MIN, Math.round((current + change) * 2) / 2);
    altLine = next === baseLine ? null : next;
    onLineChange();
  }

  // Research mode: − / + move the milestone by 1 (never below 1). Landing back on the starting milestone = no change.
  function changeMilestone(change) {
    const current = milestoneAlt ?? milestoneBase;
    if (current === null) return;
    const next = Math.max(MILESTONE_MIN, current + change);
    milestoneAlt = next === milestoneBase ? null : next;
    onLineChange();
  }

  if (onBarClick) parts.canvas.style.cursor = "pointer";

  parts.altDown.addEventListener("click", () => changeAltLine(-ALT_STEP));
  parts.altUp.addEventListener("click", () => changeAltLine(ALT_STEP));
  parts.altReset.addEventListener("click", () => {
    altLine = null;
    onLineChange();
  });
  parts.msDown.addEventListener("click", () => changeMilestone(-1));
  parts.msUp.addEventListener("click", () => changeMilestone(1));
  parts.msReset.addEventListener("click", () => {
    milestoneAlt = null;
    onLineChange();
  });

  let dividerSpec = null; // animatedBars: { beforeIndex, label } or null (chartDivider below picks it)
  let tonightLabel = null; // animatedBars: the label ("vs BOS") for the empty bar at the far right for the next game, or null for none

  let lastDraw = null; // the last draw() arguments, so switching modes or themes can redraw
  document.addEventListener("lh-mode-change", () => {
    if (lastDraw && (chart || bars)) draw(...lastDraw);
  });
  document.addEventListener("lh-theme-change", () => {
    if (lastDraw && chart) draw(...lastDraw); // new colors for the bars, line, numbers, axes and grid
  });

  // gamesOldestFirst: rows from calculateHitRate (already scored against activeLine()), oldest first.
  // key: what these games are, e.g. "237|points|10". Same key as last time = only the line moved.
  function draw(gamesOldestFirst, key) {
    games = gamesOldestFirst;
    lastDraw = [gamesOldestFirst, key];
    const line = shownLine();
    // The faint marker: the book's line while an alt line is picked, or in research mode the season average.
    const research = isResearchMode();
    const book = research ? averageMarker : (altLine !== null ? bookLine : null);
    const palette = chartColors();
    const markerOptions = { line, bookLine: book, bookLabel: research ? "Avg" : "Book", colors: palette };
    const highest = Math.max(...games.map((game) => game.value), line ?? 0, research ? averageMarker ?? 0 : bookLine ?? 0);
    const yMax = Math.ceil(highest * 1.1); // a little headroom above the tallest bar or the line

    parts.scroll.hidden = false;
    updateAltControl();

    if (bars) {
      // HTML bars: no sideways scroll (the bars shrink to fit), and the same game keeps the same bar element.
      parts.inner.style.width = "100%";
      parts.scroll.style.overflowX = "hidden"; // nothing to scroll: the bars always fit
      const { scaleMax, ticks } = niceScale(highest * 1.1);
      parts.tooltip.hidden = true;
      bars.render({
        games, line, bookLine: book, bookLabel: markerOptions.bookLabel, scaleMax, ticks,
        tonight: tonightLabel ? { label: tonightLabel } : null,
        divider: dividerSpec,
        barClass: (game) => {
          if (line === null) return "is-noline";
          // Research mode has no "under": a bar that misses the milestone is neutral gray, never red.
          return `is-${research && game.overUnder === "under" ? "push" : game.overUnder}`;
        },
      });
      return;
    }

    // Same games as the chart already shows, and only the line moved (the − / + buttons)?
    // Then just recolor the bars and move the dashed line. update("none") = no animation, so it's instant.
    if (chart && chartKey === key) {
      chart.data.datasets[0].backgroundColor = barColors(line);
      chart.options.plugins.lhLineAndValues = markerOptions;
      chart.options.scales.y.suggestedMax = yMax;
      chart.options.scales.x.ticks.color = palette.muted;                    // axis labels and grid follow the theme too
      chart.options.scales.y.ticks.color = palette.muted;
      chart.options.scales.y.grid.color = `rgba(${palette.lineRgb}, 0.12)`;
      chart.update("none");
      return;
    }

    // Different games: charts don't replace each other on their own (a new one would be drawn on top
    // of the old one), so destroy() removes the old chart and its hover listeners first.
    destroyChart();

    // Wide windows like "Season" get a sideways scroll instead of squashed bars:
    // at least 38px per bar, or the full width if that's wider.
    parts.inner.style.width = `max(100%, ${games.length * 38}px)`;

    chart = new Chart(parts.canvas, {
      type: "bar",
      data: {
        labels: games.map((game) => [opponentLabel(game), shortDate(game.date)]), // two lines under each bar
        datasets: [{
          data: games.map((game) => game.value),
          backgroundColor: barColors(line),
          borderRadius: 0, // square bars (Swiss look)
          // Thick bars: each bar fills 90% of 90% of its slot (about 81%), up to maxBarWidth.
          categoryPercentage: 0.9,
          barPercentage: 0.9,
          maxBarThickness: maxBarWidth,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false, // fill the box's height
        animation: reducedMotion ? false : { duration: 300 },
        // "index" + intersect: false = the pointer anywhere in a game's column counts as that bar,
        // so short bars (or a 0) are as easy to hover as tall ones.
        interaction: { mode: "index", intersect: false },
        onHover: handleHover,
        onClick: (event, elements) => {
          if (onBarClick && elements.length) onBarClick(games[elements[0].index]);
        },
        // The fade when the hovered bar changes: a quick color change (none for reduced motion).
        transitions: {
          lhHover: { animation: { duration: reducedMotion ? 0 : 180, easing: "easeOutQuad" } },
        },
        layout: { padding: { top: 18 } }, // room for the numbers above the tallest bar
        plugins: {
          legend: { display: false },
          // Hover (or tap on a phone) shows the game's details in our own HTML box (showTooltip).
          tooltip: { enabled: false, external: showTooltip },
          lhLineAndValues: markerOptions, // passed to our plugin as "options"
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: palette.muted,
              autoSkip: false, // show every label; the scroll gives them room
              maxRotation: 0,
              font: { family: "Satoshi, sans-serif", size: 10 },
            },
          },
          y: {
            beginAtZero: true,
            suggestedMax: yMax,
            grid: { color: `rgba(${palette.lineRgb}, 0.12)` },
            ticks: { color: palette.muted, precision: 0 },
          },
        },
      },
      plugins: [lineAndValuesPlugin],
    });
    chartKey = key;

    // Newest games are on the right, so start scrolled all the way right.
    parts.scroll.scrollLeft = parts.scroll.scrollWidth;
  }

  return {
    // The chart as a PNG (for the share picture), or null if nothing is drawn.
    // The chart as a PNG for the share picture (it has the colors of the theme the page is in).
    toImage() {
      if (bars) return bars.toImage();
      return chart ? chart.toBase64Image("image/png", 1) : null;
    },
    // animatedBars: the empty bar for tonight's game, labeled e.g. "vs BOS" (null = no upcoming game, no bar). Takes effect on the next draw().
    setTonight(label) {
      tonightLabel = label || null;
    },
    // animatedBars: the divider for the next draw() (null = none). See chartDivider().
    setDivider(divider) {
      dividerSpec = divider || null;
    },

    // A new player or prop: set the book line (null if none) and an optional fallback starting line.
    // Research mode: milestone = where the milestone starts (the season average rounded, at least 1, or null)
    // and average = the season average for the faint "Avg" marker. Clears any alt line / picked milestone.
    setLine({ book = null, fallback = null, milestone = null, average = null } = {}) {
      bookLine = book;
      baseLine = book ?? fallback;
      altLine = null;
      milestoneBase = milestone;
      milestoneAlt = null;
      averageMarker = average;
    },
    activeLine,
    // The toolbar picks a line: it becomes the alt line, unless it is the starting line again. The caller redraws.
    setActiveLine(value) {
      const next = Math.max(ALT_MIN, Math.round(Number(value) * 2) / 2);
      altLine = next === baseLine ? null : next;
    },
    mainLine: () => baseLine,
    isAltLine: () => (isResearchMode() ? milestoneAlt !== null : altLine !== null),
    draw,
    // Hide the chart and alt control (while loading, or when there are no games).
    clear() {
      lastDraw = null;
      if (bars) bars.clear();
      destroyChart();
      parts.scroll.hidden = true;
      parts.alt.hidden = true;
      parts.ms.hidden = true;
    },
  };
}
