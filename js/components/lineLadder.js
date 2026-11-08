// LineHunter - js/components/lineLadder.js
// The line ladder (the beta's signature piece, PR #5 beta-website/DESIGN.md "Line Ladder"), on the player page under the chart.
// Lines mode only. The line on the chart and up to 3 lines either side of it, side by side. For each line:
//   - a bar from a white break-even line: green up when the hit rate is above what the odds need, rose down when below. The
//     biggest gap on the ladder fills the room, with a floor of 10 points so tiny gaps stay tiny. Hollow under 5 games.
//   - the line, the record ("7-3"), the hit rate (colored by the How-Often Rule: 49% and below rose, 50-74% gold, 75%+ teal),
//     the best odds a book posts for that exact line + side, and the gap to break-even ("▲3.3%").
//   - three dots: does the line clear break-even over the last 10, the last 20, and every game this season? Filled = yes,
//     hollow = no, a dash = under 5 games there.
// Odds only exist where a book actually posts that line, so most lines have none: they show "No odds", no bar and dashes.
// The book's own line wears a "Posted" tag; the line on the chart is outlined. Clicking a line moves the chart to it.
// Bars travel to their new values (280 ms on the beta's curve, through the line when they change sides); none with reduced motion.
//
//   const ladder = createLineLadder(host, { onPick(line) });
//   ladder.render({ line, posted, side, current, windows: { l10, l20, all }, oddsFor(line) -> { odds, book } | null });
//     current = the chart's games' values; windows = values for the dots; side = "over" | "under".
//   ladder.hide()

const LADDER_SPAN = 3;       // lines each side of the chart's line
const LADDER_MIN_GAP = 10;   // the bar scale's floor, in percentage points
const LADDER_MIN_GAMES = 5;  // fewer games: hollow bar, dashed dots

// What the price needs to break even, in %: −110 -> 52.4, +120 -> 45.5.
function breakEvenPct(odds) {
  if (!Number.isFinite(odds) || odds === 0) return null;
  return odds < 0 ? (-odds / (-odds + 100)) * 100 : (100 / (odds + 100)) * 100;
}

function ladderHitRateClass(pct) {
  const rounded = Math.round(pct);
  return rounded >= 75 ? "is-high" : rounded >= 50 ? "is-mid" : "is-low";
}

function createLineLadder(host, { onPick = () => {} } = {}) {
  const slots = LADDER_SPAN * 2 + 1;
  host.classList.add("lh-ladder-wrap");
  host.innerHTML = `
    <div class="lh-ladder-head">
      <h3 class="lh-ladder-title">Line ladder</h3>
      <p class="lh-ladder-key">White line = break-even. Green above, red below. <span class="lh-ladder-dotkey">●●●</span> clears break-even in L10, L20, Season.</p>
    </div>
    <div class="lh-ladder" role="group" aria-label="Nearby lines">
      <div class="lh-ladder-labels" aria-hidden="true">
        <span class="lh-ladder-barlabel"><b>Above</b><b>Below</b></span><span>Line</span><span>Record</span><span>Hit rate</span><span>Odds</span><span>Vs B/E</span><span>L10 · L20 · All</span>
      </div>
      ${Array.from({ length: slots }, () => `
        <button type="button" class="lh-ladder-col">
          <span class="lh-ladder-bar"><span class="lh-ladder-zero"></span><span class="lh-ladder-fill"></span><span class="lh-ladder-posted">Posted</span></span>
          <span class="lh-ladder-line"></span>
          <span class="lh-ladder-rec"></span>
          <span class="lh-ladder-hr"></span>
          <span class="lh-ladder-odds"></span>
          <span class="lh-ladder-gap"></span>
          <span class="lh-ladder-dots"></span>
        </button>`).join("")}
    </div>
    <p class="lh-ladder-note">Odds show only where a book posts that exact line. Past results, not a prediction.</p>`;

  const cols = [...host.querySelectorAll(".lh-ladder-col")].map((el) => ({
    el,
    fill: el.querySelector(".lh-ladder-fill"),
    line: el.querySelector(".lh-ladder-line"),
    rec: el.querySelector(".lh-ladder-rec"),
    hr: el.querySelector(".lh-ladder-hr"),
    odds: el.querySelector(".lh-ladder-odds"),
    gap: el.querySelector(".lh-ladder-gap"),
    dots: el.querySelector(".lh-ladder-dots"),
    value: null,
  }));
  cols.forEach((col) => col.el.addEventListener("click", () => { if (col.value !== null) onPick(col.value); }));

  function hide() { host.hidden = true; }

  function render({ line, posted = null, side = "over", current = [], windows = {}, oddsFor = () => null } = {}) {
    if (line === null || line === undefined || !current.length) { hide(); return; }
    host.hidden = false;
    const hit = (value, at) => (side === "under" ? value < at : value > at);
    const rate = (values, at) => (values.length ? (values.filter((value) => hit(value, at)).length / values.length) * 100 : null);

    // Lines: the chart's line ± 1, 2, 3 (never below 0.5).
    const lines = [];
    for (let step = -LADDER_SPAN; step <= LADDER_SPAN; step += 1) lines.push(line + step);
    const rows = lines.map((at) => {
      if (at < 0.5) return null;
      const hits = current.filter((value) => hit(value, at)).length;
      const hr = (hits / current.length) * 100;
      const price = oddsFor(at);
      const be = price ? breakEvenPct(price.odds) : null;
      return { at, hits, n: current.length, hr, price, be, gap: be === null ? null : hr - be };
    });
    const scale = Math.max(LADDER_MIN_GAP, ...rows.filter((row) => row && row.gap !== null).map((row) => Math.abs(row.gap)));

    cols.forEach((col, index) => {
      const row = rows[index];
      col.el.hidden = !row;
      col.value = row ? row.at : null;
      if (!row) return;
      const sideWord = side === "under" ? "Under" : "Over";
      col.el.classList.toggle("is-current", row.at === line);
      col.el.classList.toggle("is-posted", posted !== null && row.at === posted);
      col.el.classList.toggle("is-hollow", row.n < LADDER_MIN_GAMES);
      col.el.classList.toggle("has-no-odds", row.gap === null);
      col.el.setAttribute("aria-pressed", String(row.at === line));
      col.el.setAttribute("aria-label", `${sideWord} ${lineText(row.at)}: ${row.hits} of ${row.n}, ${Math.round(row.hr)}%${row.price ? `, odds ${row.price.odds > 0 ? "+" : ""}${row.price.odds}` : ", no odds posted"}. Show this line on the chart.`);

      // The bar: height = the gap's share of the scale (half the box at most), flipped below the line when negative.
      const height = row.gap === null ? 0 : (Math.abs(row.gap) / scale) * 46;
      col.fill.style.height = `${height.toFixed(1)}%`;
      col.fill.style.transform = `scaleY(${row.gap !== null && row.gap < 0 ? -1 : 1})`;
      col.fill.classList.toggle("is-above", row.gap !== null && row.gap >= 0);
      col.fill.classList.toggle("is-below", row.gap !== null && row.gap < 0);

      col.line.textContent = lineText(row.at);
      col.rec.textContent = `${row.hits}-${row.n - row.hits}`;
      col.hr.textContent = `${Math.round(row.hr)}%`;
      col.hr.className = `lh-ladder-hr ${ladderHitRateClass(row.hr)}`;
      col.odds.innerHTML = row.price
        ? `${row.price.odds > 0 ? "+" : ""}${row.price.odds}${row.price.book ? ` <small class="lh-ladder-book">${row.price.book}</small>` : ""}`
        : `<small>No odds</small>`;
      col.gap.className = `lh-ladder-gap ${row.gap === null ? "" : row.gap >= 0 ? "is-above" : "is-below"}`;
      col.gap.textContent = row.gap === null ? "–" : `${row.gap >= 0 ? "▲" : "▼"}${Math.abs(row.gap).toFixed(1)}%`;

      // The dots: L10, L20, All vs that line's break-even.
      col.dots.innerHTML = ["l10", "l20", "all"].map((key) => {
        const values = windows[key] || [];
        if (row.be === null || values.length < LADDER_MIN_GAMES) return `<i class="is-none">–</i>`;
        return rate(values, row.at) >= row.be ? `<i class="is-on">●</i>` : `<i>○</i>`;
      }).join("");
    });
  }

  // Narrow screens: the ladder scrolls sideways, so start with the chart's line in the middle.
  const grid = host.querySelector(".lh-ladder");
  const centerCurrent = () => {
    const current = grid.querySelector(".lh-ladder-col.is-current");
    if (current && grid.scrollWidth > grid.clientWidth) grid.scrollLeft = current.offsetLeft - (grid.clientWidth - current.offsetWidth) / 2;
  };
  const baseRender = render;
  return { render: (args) => { baseRender(args); requestAnimationFrame(centerCurrent); }, hide };
}
