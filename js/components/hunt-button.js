// LineHunter - js/components/hunt-button.js
// The one "+" button that adds a prop to My Hunts (js/core/hunts.js). Used by the game page's props table, the player drawer,
// the player page, Top Hit Rates and the Hit List cards.
//
//   huntButtonHtml(leg, { label, labelIn, labelOut, iconFirst, className })  -> the button's HTML.
//       leg = { playerId, player, team, opp, gameId, tipoff, stat, side, line, odds, book, isAlt }.
//       label = optional text before the icon ("O", "Over 24.5", ...). labelIn / labelOut = the text for each state instead
//       ("IN MY HUNTS" / "ADD TO MY HUNTS"); iconFirst puts the icon before the text.
// "+" when the leg is not in the slip, a check mark (in teal) when it is; tapping the check removes it. One click handler for the whole
// page (capture phase, so a button inside a clickable row or card never also opens the row's drawer or link), and every
// button on the page updates when the slip changes. lines-only: research mode hides them.

const HUNT_STAT_WORDS = { points: "Points", rebounds: "Rebounds", assists: "Assists", threes: "Threes", steals: "Steals", blocks: "Blocks", turnovers: "Turnovers" };

// "points_rebounds_assists" -> "Points + Rebounds + Assists"
function huntStatName(stat) {
  return String(stat || "").split("_").map((word) => HUNT_STAT_WORDS[word] || word.charAt(0).toUpperCase() + word.slice(1)).join(" + ");
}

function huntLegLabel(leg) {
  return `${leg.side === "under" ? "Under" : "Over"} ${leg.line} ${huntStatName(leg.stat)}`;
}

const huntAttr = (text) => String(text).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function huntButtonState(button, inSlip) {
  const leg = JSON.parse(button.dataset.huntLeg);
  button.classList.toggle("is-in", inSlip);
  button.setAttribute("aria-pressed", String(inSlip));
  button.setAttribute("aria-label", `${inSlip ? "Remove" : "Add"} ${leg.player} ${huntLegLabel(leg)} ${inSlip ? "from" : "to"} My Hunts`);
  button.title = inSlip ? "In My Hunts: tap to remove" : "Add to My Hunts";
  const icon = button.querySelector(".lh-add-icon");
  if (icon) icon.className = `lh-add-icon bi ${inSlip ? "bi-check-lg" : "bi-plus-lg"}`;
  const text = button.querySelector(".lh-add-label");
  if (text && button.dataset.huntLabelIn) text.textContent = inSlip ? button.dataset.huntLabelIn : button.dataset.huntLabelOut;
}

function huntButtonHtml(leg, { label = "", labelIn = "", labelOut = "", iconFirst = false, className = "" } = {}) {
  if (!leg || leg.line === null || leg.line === undefined || Number.isNaN(Number(leg.line))) return "";
  const data = { ...leg, line: Number(leg.line) };
  const inSlip = lhHunts.has(data);
  const text = labelIn ? (inSlip ? labelIn : labelOut) : label;
  const textHtml = text ? `<span class="lh-add-label">${text}</span>` : "";
  const iconHtml = `<i class="lh-add-icon bi ${inSlip ? "bi-check-lg" : "bi-plus-lg"}" aria-hidden="true"></i>`;
  return `<button type="button" class="lh-add lines-only${inSlip ? " is-in" : ""}${className ? ` ${className}` : ""}" data-hunt-add${labelIn ? ` data-hunt-label-in="${huntAttr(labelIn)}" data-hunt-label-out="${huntAttr(labelOut)}"` : ""}
      data-hunt-id="${huntAttr(lhHunts.idFor(data))}" data-hunt-leg="${huntAttr(JSON.stringify(data))}" aria-pressed="${inSlip}"
      aria-label="${huntAttr(`${inSlip ? "Remove" : "Add"} ${data.player} ${huntLegLabel(data)} ${inSlip ? "from" : "to"} My Hunts`)}"
      title="${inSlip ? "In My Hunts: tap to remove" : "Add to My Hunts"}">${iconFirst ? iconHtml + textHtml : textHtml + iconHtml}</button>`;
}

// Capture phase: runs before the row / card click handlers, and stops them.
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-hunt-add]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const id = button.dataset.huntId;
  if (lhHunts.has(id)) lhHunts.remove(id);
  else lhHunts.add(JSON.parse(button.dataset.huntLeg));
}, true);

// Enter / Space on a button inside a row that also listens for Enter: keep the row from opening.
document.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.closest && event.target.closest("[data-hunt-add]")) event.stopPropagation();
}, true);

document.addEventListener("lh-hunts-change", () => {
  document.querySelectorAll("[data-hunt-add]").forEach((button) => huntButtonState(button, lhHunts.has(button.dataset.huntId)));
});
