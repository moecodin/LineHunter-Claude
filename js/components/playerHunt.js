// LineHunter - js/components/playerHunt.js
// The "Hunt Score" section on player.html (lines mode only): tonight's score from the engine (/api/hunt, via loadHunts in
// js/components/hunt-score.js) for the selected stat tab, as one big number, the pick, and the step-by-step build-up from the
// season baseline (one row per factor: what it moved, a bar from the center line, the running score).
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

function playerHuntHtml(prop) {
  const best = huntBestOdds(prop);
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
    <div class="lh-ph lh-ph--${prop.side}">
      <div class="lh-ph-head">
        <span class="lh-ph-score">${prop.score}</span>
        <span class="lh-ph-of">Hunt Score / 100</span>
        <span class="lh-ph-pick">${huntPickText(prop)}</span>
        <span class="lh-ph-facts">${Number.isFinite(prop.chance) ? `${prop.chance}% chance` : ""}${huntOddsHtml(best)}</span>
        ${prop.gtd ? `<span class="lh-hs-tag lh-hs-tag--gtd">GTD</span>` : ""}
        ${huntButtonHtml(huntLeg(prop, best), { labelOut: "ADD TO MY HUNTS", labelIn: "IN MY HUNTS", iconFirst: true, className: "lh-hs-add lh-ph-add" })}
      </div>
      <div class="lh-ph-steps">
        <div class="lh-ph-step lh-ph-step--head"><span>Step</span><span></span><span>Δ</span><span>Score</span></div>
        <div class="lh-ph-step">
          <span class="lh-ph-name">Season baseline<small>season rate and minutes, average opponent</small></span>
          <span class="lh-ph-bar" aria-hidden="true"></span>
          <span class="lh-ph-delta">—</span>
          <span class="lh-ph-run">${base.toFixed(1)}</span>
        </div>
        ${steps}
        <div class="lh-ph-step lh-ph-step--total">
          <span class="lh-ph-name">Hunt Score</span><span></span><span></span>
          <span class="lh-ph-run">${prop.score}</span>
        </div>
      </div>
    </div>`;
}

async function renderPlayerHunt(playerId, propType, game) {
  const section = document.getElementById("playerHunt");
  const body = document.getElementById("playerHuntBody");
  if (!section || !body) return;
  const date = playerHuntDate(game);
  const key = `${playerId}:${propType}:${date}`;
  if (key === playerHuntShown) return;
  playerHuntShown = key;
  const run = ++playerHuntRun;
  if (!date) {
    section.hidden = true;
    return;
  }
  try {
    const data = await loadHunts(date);
    if (run !== playerHuntRun) return;
    const prop = playerHuntPick(data, playerId, propCode(propType));
    if (!prop) {
      section.hidden = true;
      return;
    }
    if (await ensureHuntOdds([prop]) && run !== playerHuntRun) return;
    body.innerHTML = playerHuntHtml(prop);
    section.hidden = false;
  } catch (error) {
    console.warn("Player Hunt Score:", error);
    if (run === playerHuntRun) section.hidden = true;
  }
}
