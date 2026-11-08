// LineHunter - js/components/playerHunt.js
// The Hunt Score on player.html (lines mode only): tonight's score from the engine (/api/hunt, via loadHunts in
// js/components/hunt-score.js) for the selected stat tab. Two parts: #playerHuntHead beside the name (one big number, the pick,
// chance + odds, Add, and the engine's three "why" sentences) and the #playerHunt "Score build-up" section (the steps from the
// season baseline: one row per factor with what it moved, a bar from the center line and the running score).
// The better side is shown (the engine scores both). No scored prop (no line, game started, research mode): the section hides.
//
// Needs js/components/hunt-score.js (loadHunts, huntPickText, huntBestOdds, huntLeg, huntOddsHtml, huntFactorDetail,
// huntPoints), js/components/hunt-button.js (huntButtonHtml) and propCode() from js/pages/player.js.

let playerHuntRun = 0;   // newer calls win when the tab changes while a download is in flight
let playerHuntShown = ""; // "player:propType:date" already drawn (renderProps calls this on every window / line change)

// The engine's date for a game: its ET calendar date ("2026-10-27").
function playerHuntDate(game) {
  return game && game.date ? String(game.date).slice(0, 10) : null;
}

// The scored prop to show: this player + stat, the side with the higher score.
function playerHuntPick(data, playerId, code) {
  const props = (data && Array.isArray(data.props) ? data.props : []).filter((prop) => prop.playerId === playerId && prop.stat === code);
  return props.sort((a, b) => b.score - a.score)[0] || null;
}

// The verdict (the beta's wedge): the pick and its context on the navy side; on the indigo wedge the Hunt Score, the chance,
// the book's fair chance and the edge, then the Hunt line; under both the engine's three reasons, then Add.
// fair / edge / projection are only shown when the engine sent them.
function playerHuntHeadHtml(prop) {
  const best = huntBestOdds(prop);
  const num = (n) => Number.isFinite(n);
  const role = (prop.factors || []).find((factor) => factor.key === "role" && factor.out);
  const b2b = (prop.factors || []).some((factor) => factor.key === "b2b");
  const proj = prop.projection || {};
  const readout = [
    `<div><span class="lh-vd-k">Hunt Score</span><span class="lh-vd-n is-score">${prop.score}</span><span class="lh-vd-s">of 100</span></div>`,
    num(prop.chance) ? `<div><span class="lh-vd-k">Chance</span><span class="lh-vd-n">${prop.chance}%</span><span class="lh-vd-s">the sim's ${prop.side}</span></div>` : "",
    num(prop.fair) ? `<div><span class="lh-vd-k">Book's fair</span><span class="lh-vd-n">${prop.fair}%</span><span class="lh-vd-s">${best ? `${best.odds > 0 ? `+${best.odds}` : best.odds} at ${best.book}` : "cut taken out"}</span></div>` : "",
    num(prop.edge) ? `<div><span class="lh-vd-k">Edge</span><span class="lh-vd-n">${prop.edge >= 0 ? "▲" : "▼"}${Math.abs(prop.edge)}</span><span class="lh-vd-s">points</span></div>` : "",
  ].join("");
  const huntLine = num(proj.mean)
    ? `Hunt line ${proj.mean.toFixed(1)}${num(proj.p10) && num(proj.p90) ? ` (most games ${Math.round(proj.p10)} to ${Math.round(proj.p90)})` : ""}.`
    : "";
  const context = [
    role ? `Out: <b>${role.out}</b>` : "",
    b2b ? "Back-to-back" : "",
    prop.gtd ? `<span class="lh-hs-tag lh-hs-tag--gtd">GTD</span>` : "",
  ].filter(Boolean).join(" · ");
  return `
    <div class="lh-vd lh-ph--${prop.side}">
      <div class="lh-vd-left">
        <span class="lh-vd-label">Hunt Score · tonight ${huntMatchup(prop)}</span>
        <h2 class="lh-vd-pick"><span class="lh-vd-side">${prop.side === "under" ? "Under" : "Over"}</span> ${huntPickText(prop).replace(/^(Over|Under) /, "")}</h2>
        ${context ? `<p class="lh-vd-ctx">${context}</p>` : ""}
        <p class="lh-vd-small">Past results and a simulation, not a prediction.</p>
      </div>
      <div class="lh-vd-wedge">
        <div class="lh-vd-readout">${readout}</div>
        ${huntLine ? `<p class="lh-vd-line">${huntLine}</p>` : ""}
      </div>
      <ol class="lh-vd-why">${(prop.why || []).map((sentence) => `<li>${sentence}</li>`).join("")}</ol>
      <div class="lh-vd-foot">
        <a href="#playerHunt" class="lh-vd-link">See the score build-up</a>
        ${huntButtonHtml(huntLeg(prop, best), { labelOut: "ADD THIS PICK", labelIn: "IN MY HUNTS", iconFirst: true, className: "lh-hs-add lh-ph-add" })}
      </div>
    </div>`;
}

// The build-up table: season baseline, one row per factor, the Hunt Score.
function playerHuntStepsHtml(prop) {
  const factors = prop.factors || [];
  const base = Number.isFinite(prop.base) ? prop.base : 50;
  let running = base;
  const steps = factors.map((factor) => {
    running += factor.points;
    const width = Math.min(Math.abs(factor.points) / 10, 1) * 50; // ±10 points fill one half
    const tone = factor.points > 0 ? "is-help" : factor.points < 0 ? "is-hurt" : "";
    const detail = huntFactorDetail(factor, prop);
    return `
      <div class="lh-ph-step">
        <span class="lh-ph-name">${factor.label}${detail ? `<small>${detail}</small>` : ""}</span>
        <span class="lh-ph-bar" aria-hidden="true"><span class="${tone}" style="width: ${width}%"></span></span>
        <span class="lh-ph-delta ${tone}">${huntPoints(factor.points)}</span>
        <span class="lh-ph-run">${running.toFixed(1)}</span>
      </div>`;
  }).join("");

  return `
    <div class="lh-ph-steps lh-ph--${prop.side}">
      <div class="lh-ph-step lh-ph-step--head"><span>Step</span><span>◂ hurts · helps ▸</span><span>Δ</span><span>Score</span></div>
      <div class="lh-ph-step">
        <span class="lh-ph-name">Season baseline<small>season rate and minutes, average opponent</small></span>
        <span class="lh-ph-bar" aria-hidden="true"></span>
        <span class="lh-ph-delta">—</span>
        <span class="lh-ph-run">${base.toFixed(1)}</span>
      </div>
      ${steps}
      <div class="lh-ph-step lh-ph-step--total">
        <span class="lh-ph-name">Hunt Score${Number.isFinite(prop.chance) ? `<small>${prop.chance}% chance of the ${prop.side}</small>` : ""}</span><span></span><span></span>
        <span class="lh-ph-run">${prop.score}</span>
      </div>
    </div>`;
}

async function renderPlayerHunt(playerId, propType, game) {
  const section = document.getElementById("playerHunt");
  const body = document.getElementById("playerHuntBody");
  const head = document.getElementById("playerHuntHead");
  if (!section || !body || !head) return;
  const hide = () => { section.hidden = true; head.hidden = true; };
  const date = playerHuntDate(game);
  const key = `${playerId}:${propType}:${date}`;
  if (key === playerHuntShown) return;
  playerHuntShown = key;
  const run = ++playerHuntRun;
  if (!date) {
    hide();
    return;
  }
  try {
    const data = await loadHunts(date);
    if (run !== playerHuntRun) return;
    const prop = playerHuntPick(data, playerId, propCode(propType));
    if (!prop) {
      hide();
      return;
    }
    if (await ensureHuntOdds([prop]) && run !== playerHuntRun) return;
    head.innerHTML = playerHuntHeadHtml(prop);
    body.innerHTML = playerHuntStepsHtml(prop);
    head.hidden = false;
    section.hidden = false;
  } catch (error) {
    console.warn("Player Hunt Score:", error);
    if (run === playerHuntRun) hide();
  }
}
