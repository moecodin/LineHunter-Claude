// LineHunter - js/components/prop-toolbar.js
// The prop toolbar at the top of the player drawer (game page) and the player page's chart card. Lines mode only: research
// mode keeps the chart's milestone control and hides the toolbar (lines-only).
//
//   [ player + matchup ]                                  (only where `head` is passed: the page has no header of its own)
//   [ stat selector ]                                     (the page's existing stat tabs, moved in here)
//   [ - 24.5 + ]  [ Over | Under ]  [ odds boxes ]  [ + ADD TO MY HUNTS ]
//
// - The stepper moves the line in 1-point steps and keeps the Over / Under choice (the odds follow the new line). The page owns the line (the chart's
//   setActiveLine), so it passes onStep(newLine) and redraws; the graph's dashed line and hit colors follow it.
// - Pick a side: up to 3 sportsbook odds boxes (best payout first, outlined, odds in teal) and a "+N" box. Nothing picked: a
//   small hint. No book posts that exact line + side: no odds, a disabled Add button, no note.
// - Add puts { line, side, best odds, best book, isAlt } in My Hunts (isAlt = the line is not the main line). When that exact
//   pick is in the slip the button is teal and reads "IN MY HUNTS"; tapping it again removes it. (One leg per player + stat:
//   js/core/hunts.js replaces the old one.)
//
// Needs js/core/hunts.js, js/data/odds.js, js/components/hunt-button.js and lineText() from js/components/propChart.js.

function createPropToolbar(container, { statTabs = null, showHead = false, onStep = () => {}, onSide = () => {} } = {}) {
  container.classList.add("lh-ptb", "lines-only");
  container.innerHTML = `
    <div class="lh-ptb-head" ${showHead ? "" : "hidden"}>
      <span class="lh-ptb-name"></span><span class="lh-ptb-match"></span>
    </div>
    <div class="lh-ptb-stat" data-slot="stat"></div>
    <div class="lh-ptb-controls">
      <div class="lh-ptb-line">
        <div class="lh-ptb-step" role="group" aria-label="Change the line">
          <button type="button" class="lh-ptb-stepbtn" data-step="-1" aria-label="Lower the line by 1">−</button>
          <output class="lh-ptb-value" aria-live="polite">–</output>
          <button type="button" class="lh-ptb-stepbtn" data-step="1" aria-label="Raise the line by 1">+</button>
        </div>
        <div class="lh-ptb-sides" role="group" aria-label="Over or under">
          <button type="button" class="lh-ptb-side lh-ptb-side--over" data-side="over" aria-pressed="false">Over</button>
          <button type="button" class="lh-ptb-side lh-ptb-side--under" data-side="under" aria-pressed="false">Under</button>
        </div>
      </div>
      <div class="lh-ptb-odds" data-slot="odds"></div>
      <div class="lh-ptb-add" data-slot="add"></div>
    </div>`;

  const parts = {
    head: container.querySelector(".lh-ptb-head"),
    name: container.querySelector(".lh-ptb-name"),
    match: container.querySelector(".lh-ptb-match"),
    statSlot: container.querySelector('[data-slot="stat"]'),
    value: container.querySelector(".lh-ptb-value"),
    down: container.querySelector('[data-step="-1"]'),
    up: container.querySelector('[data-step="1"]'),
    sides: [...container.querySelectorAll("[data-side]")],
    odds: container.querySelector('[data-slot="odds"]'),
    add: container.querySelector('[data-slot="add"]'),
  };

  let side = null; // "over", "under", or null (nothing picked)
  let line = null;

  // The page's stat tabs live in the toolbar in lines mode and go back to where they were in research mode (the toolbar is hidden then).
  let statHome = null;
  if (statTabs) {
    statHome = document.createComment("stat tabs home");
    statTabs.parentNode.insertBefore(statHome, statTabs);
  }
  const placeStatTabs = () => {
    if (!statTabs) return;
    if (isResearchMode()) statHome.parentNode.insertBefore(statTabs, statHome.nextSibling);
    else parts.statSlot.appendChild(statTabs);
  };
  placeStatTabs();
  document.addEventListener("lh-mode-change", placeStatTabs);

  parts.down.addEventListener("click", () => step(-1));
  parts.up.addEventListener("click", () => step(1));
  function step(direction) {
    if (line === null) return;
    const next = Math.max(0.5, line + direction); // 1-point steps, never below 0.5
                                                  // a chosen side stays chosen: the odds follow the new line
    onStep(next);
  }
  parts.sides.forEach((button) => button.addEventListener("click", () => {
    side = button.dataset.side;
    onSide(side);
  }));

  const oddsText = (odds) => (odds > 0 ? `+${odds}` : `${odds}`);

  // ctx = { head: { name, matchup }, line, mainLine, legBase: { playerId, player, team, opp, gameId, tipoff, stat }, stat }
  //   stat = the API prop type ("points"); line = the line on the chart (null = no line to move).
  function render(ctx) {
    line = ctx.line;
    if (showHead && ctx.head) {
      parts.name.textContent = ctx.head.name;
      parts.match.textContent = ctx.head.matchup || "";
    }

    parts.value.textContent = line === null ? "–" : lineText(line);
    parts.down.disabled = line === null || line <= 0.5;
    parts.up.disabled = line === null;
    parts.sides.forEach((button) => {
      button.disabled = line === null;
      const on = button.dataset.side === side;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", String(on));
    });

    parts.odds.innerHTML = "";
    parts.add.innerHTML = "";
    parts.odds.hidden = false;
    parts.add.hidden = false;

    if (line === null) {
      parts.odds.innerHTML = `<span class="lh-ptb-hint">No line posted</span>`;
      parts.add.hidden = true;
      return;
    }
    if (!side) {
      parts.odds.innerHTML = `<span class="lh-ptb-hint">Pick over or under</span>`;
      parts.add.hidden = true;
      return;
    }

    const books = lhOdds.getOdds(ctx.legBase.playerId, ctx.stat, line, side);
    if (books.length === 0) {                // no book posts this exact line + side: keep the side, hide the odds, disable Add (no note)
      parts.odds.hidden = true;
      parts.add.innerHTML = `<button type="button" class="lh-add lines-only lh-add--block" disabled aria-disabled="true"><i class="lh-add-icon bi bi-plus-lg" aria-hidden="true"></i><span class="lh-add-label">ADD TO MY HUNTS</span></button>`;
      return;
    }

    const shown = books.slice(0, 3);
    parts.odds.innerHTML = shown.map((entry, index) => `
        <span class="lh-ptb-box${index === 0 ? " is-best" : ""}" title="${entry.vendor}">
          <span class="lh-ptb-book">${entry.book}</span><span class="lh-ptb-price">${oddsText(entry.odds)}</span>
        </span>`).join("")
      + (books.length > 3 ? `<span class="lh-ptb-box lh-ptb-more" title="${books.slice(3).map((entry) => `${entry.book} ${oddsText(entry.odds)}`).join(", ")}"><span class="lh-ptb-price">+${books.length - 3}</span></span>` : "");

    const best = books[0];
    parts.add.innerHTML = huntButtonHtml({
      ...ctx.legBase,
      side,
      line,
      odds: best.odds,
      book: best.vendor,
      isAlt: ctx.mainLine === null || ctx.mainLine === undefined || line !== ctx.mainLine,
    }, { labelOut: "ADD TO MY HUNTS", labelIn: "IN MY HUNTS", iconFirst: true, className: "lh-add--block" });
  }

  return {
    render,
    getSide: () => side,
    // A new player or prop: start with nothing picked, or with the side the player opened the prop from.
    setSide(next) { side = next === "over" || next === "under" ? next : null; },
  };
}
