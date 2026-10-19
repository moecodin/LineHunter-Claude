// LineHunter - js/components/fanCards.js
// Research mode's two cards on the schedule page, shown where Top Hit Rates and the Hit List are in lines mode:
//   "Hot Players": players on tonight's slate whose last-5 average is furthest above their season average, per stat.
//   "Streaks":     small cards of players on a run: 30+ PTS ("30 Piece Chicken Nuggets"), 10+ REB, 8+ AST, 3+ 3PM,
//                  plus the BBQ Chicken card (js/components/bbq.js).
// No betting lines are used. js/components/top-hit-rates.js builds slate.fan (one entry per player, from the game logs it already
// downloads and caches) and calls showFanCards(slate); this file only draws it.
//
// Needs js/components/top-hit-rates.js (slate.fan) and js/components/hit-list.js (shortName), js/core/stats.js (miniGraph, formatStatValue).

const HOT_FILTERS = [
  { code: "pts", label: "PTS" },
  { code: "reb", label: "REB" },
  { code: "ast", label: "AST" },
  { code: "3pm", label: "3PM" },
  { code: "pra", label: "PRA" },
];
const HOT_ROW_COUNT = 8;
const STREAK_MIN = 3;       // a run shorter than this isn't listed
const NUGGET_MIN = 2;       // ...except 30-point runs, which are rare: 2 straight is enough
const STREAK_MAX_ROWS = 5;

// One card each. key = the streak field built in js/components/top-hit-rates.js, code = the prop code used in the game page link.
// "nuggets" is the 30-point run (count + average points, min 2 straight); the others are plain runs (min STREAK_MIN).
const STREAK_CARDS = [
  { key: "nuggets", code: "pts", icon: "bi-stars", label: "30 Piece Chicken Nuggets", blurb: "Straight games with 30+ PTS (2 or more)" },
  { key: "reb", code: "reb", icon: "bi-window", label: "Glass Cleaners", blurb: "Most straight games with 10+ REB" },
  { key: "ast", code: "ast", icon: "bi-coin", label: "Dime Droppers", blurb: "Most straight games with 8+ AST" },
  { key: "fg3m", code: "3pm", icon: "bi-droplet", label: "Splash Zone", blurb: "Most straight games with 3+ 3PM" },
];

let fanSlate = null;
let hotFilter = "pts";

// ---------- Hot Players ----------

function renderHotPills() {
  const pills = document.getElementById("hotPlayersPills");
  pills.hidden = false;
  pills.innerHTML = "";
  HOT_FILTERS.forEach((filter) => {
    const item = document.createElement("li");
    item.className = "nav-item";
    const button = document.createElement("button");
    button.type = "button";
    button.className = filter.code === hotFilter ? "nav-link active text-nowrap" : "nav-link text-nowrap";
    button.textContent = filter.label;
    button.addEventListener("click", () => {
      hotFilter = filter.code;
      renderHotPills();
      renderHotRows();
    });
    item.appendChild(button);
    pills.appendChild(item);
  });
}

function renderHotRows() {
  const list = document.getElementById("hotPlayersList");
  list.removeAttribute("aria-busy");
  list.className = "";

  // Last-5 average minus season average, biggest first. Only players trending UP are listed.
  const rows = fanSlate.fan
    .map((player) => ({ player, stat: player.st[hotFilter] }))
    .filter(({ stat }) => stat.l5 !== null && stat.season !== null && stat.l5 > stat.season)
    .map((item) => ({ ...item, diff: item.stat.l5 - item.stat.season }))
    .sort((a, b) => b.diff - a.diff)
    .slice(0, HOT_ROW_COUNT);

  if (rows.length === 0) {
    list.innerHTML = `<div class="lh-top-message text-muted">No one on tonight's slate is trending above their season average for this stat.</div>`;
    return;
  }

  list.innerHTML = rows.map(({ player, stat, diff }) => {
    // Mini graph: the last 10 games, teal where the player reached their season average (rounded), gray where they didn't.
    const milestone = Math.max(1, Math.round(stat.season));
    const games = stat.vals.map((value) => ({ value, overUnder: value >= milestone ? "over" : "under" }));
    return `
      <a class="lh-fan-row" href="game.html?id=${player.gameId}&player=${player.playerId}&prop=${hotFilter}">
        <div class="lh-fan-player">
          <span class="fw-semibold">${player.name}</span> ${teamBadgeForMatchup(player.team, player.matchup)}
          <div class="small text-muted">${player.matchup}</div>
        </div>
        <div class="lh-fan-stat">${formatStatValue(stat.l5)} ${hotFilter.toUpperCase()} L5 · <span class="lh-fan-up">+${diff.toFixed(1)}</span> vs season</div>
        <div class="lh-fan-graph">${miniGraph(games)}</div>
      </a>`;
  }).join("");
  if (typeof limitRowsOnPhones === "function") limitRowsOnPhones(list, ".lh-fan-row");
}

// ---------- Streaks ----------

function streakCardHtml(card) {
  let players;
  let proofText;
  let emptyText = "No active streaks tonight";

  if (card.key === "nuggets") {
    // Longest 30-point run first, then the higher average points during the run.
    players = fanSlate.fan
      .filter((player) => player.nuggets.count >= NUGGET_MIN)
      .sort((a, b) => b.nuggets.count - a.nuggets.count || b.nuggets.avg - a.nuggets.avg)
      .slice(0, STREAK_MAX_ROWS);
    proofText = (player) => `${player.nuggets.count} straight 30+ · avg ${player.nuggets.avg.toFixed(1)}`;
    emptyText = "No nuggets tonight 🍗 Nobody's on a 30-point run.";
  } else {
    players = fanSlate.fan
      .filter((player) => player.streaks[card.key] >= STREAK_MIN)
      .sort((a, b) => b.streaks[card.key] - a.streaks[card.key])
      .slice(0, STREAK_MAX_ROWS);
    proofText = (player) => `${player.streaks[card.key]} straight`;
  }

  const legs = players.length
    ? players.map((player) => `
        <a class="lh-hitlist-leg" href="game.html?id=${player.gameId}&player=${player.playerId}&prop=${card.code}" title="${player.name} ${player.matchup}">
          <span class="lh-hitlist-name">${shortName(player.name)} ${teamBadgeForMatchup(player.team, player.matchup)}</span>
          <span class="lh-hitlist-proof ms-auto">${proofText(player)}</span>
        </a>`).join("")
    : `<div class="lh-hitlist-empty text-muted">${emptyText}</div>`;

  return `
    <div class="lh-shelf-item">
      <div class="lh-hitlist-card">
        <div class="lh-hitlist-head"><i class="bi ${card.icon}" aria-hidden="true"></i><span>${card.label}</span></div>
        <div class="lh-hitlist-blurb">${card.blurb}</div>
        <div class="lh-hitlist-list">${legs}</div>
      </div>
    </div>`;
}

function renderStreaks() {
  const body = document.getElementById("streaksBody");
  body.removeAttribute("aria-busy");
  body.className = "";
  // The four streak cards, then BBQ Chicken (js/components/bbq.js) and Brick City (js/components/brickCity.js) side by side underneath.
  body.innerHTML = `<div class="lh-shelf-track" id="streaksShelf">${STREAK_CARDS.map(streakCardHtml).join("")}${bbqCardHtml()}${brickCityCardHtml(fanSlate)}</div>`;
  refreshShelf("#streaksShelf"); // js/components/shelf.js: back to the first card, arrows up to date
  fillBbqSlots(fanSlate);
}

// ---------- Called by js/components/top-hit-rates.js ----------

function showFanCards(slate) {
  if (!document.getElementById("hotPlayers")) return;
  fanSlate = slate;
  renderHotPills();
  renderHotRows();
  renderStreaks();
}

function showFanLoading() {
  const list = document.getElementById("hotPlayersList");
  const body = document.getElementById("streaksBody");
  if (!list || !body) return;
  document.getElementById("hotPlayersPills").hidden = true;
  list.setAttribute("aria-busy", "true");
  list.className = "text-muted";
  list.textContent = "Loading players...";
  body.setAttribute("aria-busy", "true");
  body.className = "text-muted";
  body.textContent = "Loading streaks...";
}

// html = the message the betting cards use. Those mention prop lines, so only "No games" passes through.
function showFanMessage(html) {
  const list = document.getElementById("hotPlayersList");
  const body = document.getElementById("streaksBody");
  if (!list || !body) return;
  const text = String(html).includes("No games")
    ? "No games scheduled for this day."
    : "Player stats for tonight's slate will appear here once the slate is set.";
  document.getElementById("hotPlayersPills").hidden = true;
  list.removeAttribute("aria-busy");
  list.className = "";
  list.innerHTML = `<div class="lh-top-message text-muted">${text}</div>`;
  body.removeAttribute("aria-busy");
  body.className = "";
  body.innerHTML = `<div class="lh-top-message text-muted">${text}</div>`;
}
