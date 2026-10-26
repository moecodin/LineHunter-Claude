// LineHunter - js/pages/hunt-score.js
// The Hunt Score page (hunt-score.html?date=YYYY-MM-DD; default today in New York). Every prop the engine scored for that day
// (/api/hunt, js/components/hunt-score.js), the better side per player + prop, highest score first; Out / Doubtful players are left
// out and game-time decisions carry a GTD tag. Stat tabs, a "65+ only" switch, 25 rows then "Show more". Each row shows its first
// "why" sentence and its three biggest factors; "See all factors" opens the rest of the reasons and how the score was built.

const HS_PAGE_ROWS = 25;
const HS_TABS = [
  { code: "all", label: "All" }, { code: "pts", label: "PTS" }, { code: "reb", label: "REB" },
  { code: "ast", label: "AST" }, { code: "3pm", label: "3PM" }, { code: "pra", label: "PRA" },
];

const hsState = { stat: "all", topOnly: false, shown: HS_PAGE_ROWS, open: new Set() };
let hsData = null;

const hsList = document.getElementById("huntScoreList");
const hsDate = (() => {
  const asked = new URLSearchParams(location.search).get("date");
  return asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : huntTodayET();
})();

// One row per player + prop: the side with the higher score. Out / Doubtful are dropped (GTD stays, tagged).
function hsRows() {
  const best = {};
  (hsData.props || []).forEach((prop) => {
    if (prop.injured && !prop.gtd) return;
    const key = `${prop.playerId}-${prop.stat}`;
    if (!best[key] || prop.score > best[key].score) best[key] = prop;
  });
  return Object.values(best)
    .filter((prop) => hsState.stat === "all" || prop.stat === hsState.stat)
    .filter((prop) => !hsState.topOnly || prop.score >= HUNT_TOP_MIN)
    .sort((a, b) => b.score - a.score || a.player.localeCompare(b.player));
}

function hsRenderTabs() {
  const tabs = document.getElementById("huntScoreTabs");
  tabs.innerHTML = HS_TABS.map((tab) => `
    <li class="nav-item"><button type="button" class="nav-link text-nowrap${tab.code === hsState.stat ? " active" : ""}" data-hs-stat="${tab.code}"${tab.code === hsState.stat ? ' aria-current="true"' : ""}>${tab.label}</button></li>`).join("");
}

function hsRender() {
  hsList.removeAttribute("aria-busy");
  const rows = hsRows();
  if (rows.length === 0) {
    const text = hsDate > huntTodayET()
      ? "Hunt Scores show up on game day."
      : (hsData.props || []).length ? "No props match these filters." : "No props to score yet. Lines usually post on game day.";
    hsList.innerHTML = `<div class="lh-top-message text-muted">${text}</div>`;
    return;
  }
  const shown = rows.slice(0, hsState.shown);
  const more = rows.length - shown.length;
  hsList.innerHTML = shown.map((prop, index) => huntFullRowHtml(prop, index + 1, hsState.open.has(`${prop.playerId}-${prop.stat}-${prop.side}`))).join("")
    + (more > 0 ? `<div class="lh-hs-morewrap"><button type="button" class="btn btn-ghost btn-sm" data-hs-more>Show more (${more})</button></div>` : "");
}

function hsMeta() {
  const meta = document.getElementById("huntScoreMeta");
  const games = new Set((hsData.props || []).map((prop) => prop.gameId)).size;
  const day = new Date(`${hsDate}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  meta.textContent = games ? `${day} · ${games} ${games === 1 ? "game" : "games"}` : day;
}

document.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-hs-stat]");
  if (tab) {
    hsState.stat = tab.dataset.hsStat;
    hsState.shown = HS_PAGE_ROWS;
    hsRenderTabs();
    if (hsData) hsRender();
    return;
  }
  const toggle = event.target.closest("[data-hunt-toggle]");
  if (toggle) {
    const key = toggle.dataset.huntToggle;
    if (hsState.open.has(key)) hsState.open.delete(key); else hsState.open.add(key);
    hsRender();
    const row = hsList.querySelector(`[data-hunt-key="${key}"] [data-hunt-toggle]`);
    if (row) row.focus();
    return;
  }
  if (event.target.closest("[data-hs-more]")) {
    hsState.shown += HS_PAGE_ROWS;
    hsRender();
  }
});

document.getElementById("huntScoreTop").addEventListener("change", (event) => {
  hsState.topOnly = event.target.checked;
  hsState.shown = HS_PAGE_ROWS;
  if (hsData) hsRender();
});

// A sportsbook picked elsewhere (js/data/odds.js) changes which odds show.
document.addEventListener("lh-book-change", () => { if (hsData) hsRender(); });

async function hsLoad() {
  hsRenderTabs();
  try {
    hsData = await loadHunts(hsDate);
    hsMeta();
    hsRender();
    if (await ensureHuntOdds(hsData.props || [])) hsRender(); // odds arrived: draw the chips and price the Add buttons
  } catch (error) {
    console.error(error);
    hsList.removeAttribute("aria-busy");
    hsList.innerHTML = `<div class="lh-top-message text-muted">Couldn't load the Hunt Score right now. Try again in a minute.</div>`;
  }
}

hsLoad();
