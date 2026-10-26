// LineHunter - js/pages/today.js
// The Today page (schedule.html) under the games carousel:
//   1. a row of tool tiles (LH_TOOLS in js/components/nav.js), each with one live teaser read from data the page already loads:
//      Hunt Score = the top hunt (/api/hunt), Top Hit Rates / Hit List / Hot Players / Streaks / Matchup Analyzer = the slate that
//      js/components/top-hit-rates.js builds and caches (it fires "lh-top-slate" when it is ready);
//   2. the "Top 5 Hunts" card (lines mode): the engine's top hunts for the picked day, with a "See all" link to hunt-score.html.
// js/pages/app.js calls showTodayForDay(day, games) whenever a day is picked.

let todayDay = null;     // "2026-10-26": the day picked in the pager
let todayHunts = null;   // /api/hunt's answer for todayDay
let todaySlate = null;   // the Top Hit Rates slate for todayDay
let todayHuntsRequest = 0;

const TODAY_TOOLS = document.getElementById("todayTools");
const TODAY_HUNTS = document.getElementById("todayHuntsList");

// "Jalen Brunson" -> "Brunson", "Gary Trent Jr." -> "Trent Jr."
function todayLastName(name) {
  const words = String(name || "").split(" ").filter(Boolean);
  return words.length > 1 ? words.slice(1).join(" ") : name;
}

// ---------- Tool tiles ----------

function renderToolTiles() {
  if (!TODAY_TOOLS) return;
  TODAY_TOOLS.innerHTML = LH_TOOLS.map((tool) => `
    <a class="lh-tool-tile ${lhToolModeClass(tool)}" href="${tool.href}" data-tool="${tool.key}">
      <span class="lh-tool-tile-head">
        <span class="lh-tool-tile-icon"><i class="bi ${tool.icon}" aria-hidden="true"></i></span>
        <span class="lh-tool-tile-name">${tool.name}</span>
        <i class="bi bi-chevron-right lh-tool-tile-go" aria-hidden="true"></i>
      </span>
      <span class="lh-tool-tile-teaser placeholder-glow" data-tool-teaser="${tool.key}"><span class="placeholder col-8 rounded"></span></span>
    </a>`).join("");
}

// label = muted words, value = the highlighted part ("Top hunt:" "Brunson 82"). value empty = a muted note only.
function setTeaser(key, label, value = "") {
  const box = TODAY_TOOLS && TODAY_TOOLS.querySelector(`[data-tool-teaser="${key}"]`);
  if (!box) return;
  box.classList.remove("placeholder-glow");
  box.innerHTML = `${label}${value ? ` <b>${value}</b>` : ""}`;
}

// The tool pages open on the same day (their saved slate loads instantly).
function updateToolLinks() {
  if (!TODAY_TOOLS || !todayDay) return;
  TODAY_TOOLS.querySelectorAll("[data-tool]").forEach((tile) => {
    const tool = LH_TOOLS.find((item) => item.key === tile.dataset.tool);
    if (!tool) return;
    if (tool.key === "matchup") return; // set by the slate teaser (needs a player)
    tile.href = `${tool.href}?date=${todayDay}`;
  });
}

function huntTeaser() {
  if (!todayHunts) return;
  const top = huntTopList(todayHunts)[0];
  if (top) setTeaser("hunt", "Top hunt:", `${todayLastName(top.player)} ${top.score}`);
  else if (todayHunts.props && todayHunts.props.length) setTeaser("hunt", "No 65+ hunts yet");
  else setTeaser("hunt", todayDay > huntTodayET() ? "Scores show on game day" : "No props to score yet");
}

// Teasers that read the slate (lines and research mode tools).
function slateTeasers(slate, message) {
  if (!slate || slate.noGames || !slate.rows || slate.rows.length === 0) {
    const note = slate && slate.noGames ? "No games this day" : message ? "No lines posted yet" : "Loading...";
    ["top", "hitlist"].forEach((key) => setTeaser(key, note));
    ["hot", "streaks", "matchup"].forEach((key) => setTeaser(key, slate && slate.noGames ? "No games this day" : "Slate not set yet"));
    return;
  }

  // Top Hit Rates: the best L10 record (8+ games), either side.
  let best = null;
  slate.rows.forEach((row) => {
    const part = row.w && row.w[10];
    if (!part || part.totalGames < 8) return;
    ["over", "under"].forEach((side) => {
      const hits = part[side].hits;
      const rate = hits / part.totalGames;
      if (!best || rate > best.rate || (rate === best.rate && part.totalGames > best.total)) best = { row, side, hits, total: part.totalGames, rate };
    });
  });
  if (best) setTeaser("top", "Best L10:", `${todayLastName(best.row.name)} ${best.hits}/${best.total} ${best.side === "under" ? "U " : ""}${HUNT_STAT_LABEL[best.row.code] || best.row.code.toUpperCase()}`);
  else setTeaser("top", "Not enough games yet");

  // Hit List: how many slips are ready (BBQ Chicken and Brick City are not slips).
  if (typeof HITLIST_CATEGORIES !== "undefined" && typeof buildSlip === "function") {
    const ready = HITLIST_CATEGORIES.filter((category) => !category.bbq && !category.brick && buildSlip(category, slate));
    if (ready.length) setTeaser("hitlist", `${ready.length} ${ready.length === 1 ? "slip" : "slips"} ·`, ready[0].label);
    else setTeaser("hitlist", "No slips yet for this slate");
  }

  // Hot Players: the biggest jump in points over the last 5 games.
  const fan = slate.fan || [];
  const hot = fan
    .filter((player) => player.st && player.st.pts && player.st.pts.l5 !== null && player.st.pts.season !== null && player.st.pts.l5 > player.st.pts.season)
    .sort((a, b) => (b.st.pts.l5 - b.st.pts.season) - (a.st.pts.l5 - a.st.pts.season))[0];
  if (hot) setTeaser("hot", "Hottest:", `${todayLastName(hot.name)} +${(hot.st.pts.l5 - hot.st.pts.season).toFixed(1)} PTS`);
  else setTeaser("hot", "Nobody trending up yet");

  // Streaks: the longest active run on any card.
  let run = null;
  fan.forEach((player) => {
    const options = [
      { count: player.nuggets && player.nuggets.count >= 2 ? player.nuggets.count : 0, mark: "30+ PTS" },
      { count: player.streaks && player.streaks.reb >= 3 ? player.streaks.reb : 0, mark: "10+ REB" },
      { count: player.streaks && player.streaks.ast >= 3 ? player.streaks.ast : 0, mark: "8+ AST" },
      { count: player.streaks && player.streaks.fg3m >= 3 ? player.streaks.fg3m : 0, mark: "3+ 3PM" },
    ];
    options.forEach((option) => {
      if (option.count && (!run || option.count > run.count)) run = { player, ...option };
    });
  });
  if (run) setTeaser("streaks", "Longest:", `${todayLastName(run.player.name)} ${run.count} straight ${run.mark}`);
  else setTeaser("streaks", "No active streaks");

  matchupTeaser();
}

// Matchup Analyzer: the top hunt's player against tonight's opponent, else the hottest player.
function matchupTeaser() {
  const tile = TODAY_TOOLS && TODAY_TOOLS.querySelector('[data-tool="matchup"]');
  const fan = todaySlate && todaySlate.fan ? todaySlate.fan : [];
  if (!tile || fan.length === 0) return;
  const top = todayHunts ? huntTopList(todayHunts)[0] : null;
  let pick = top ? fan.find((player) => player.playerId === top.playerId) : null;
  let stat = top ? top.stat : "pts";
  if (!pick) {
    pick = [...fan].filter((player) => player.st && player.st.pts && player.st.pts.l5 !== null && player.st.pts.season !== null)
      .sort((a, b) => (b.st.pts.l5 - b.st.pts.season) - (a.st.pts.l5 - a.st.pts.season))[0];
    stat = "pts";
  }
  if (!pick || !pick.oppId) {
    setTeaser("matchup", "Any player against any team");
    return;
  }
  tile.href = `matchup.html?player=${pick.playerId}&opp=${pick.oppId}&stat=${stat}`;
  setTeaser("matchup", "Featured:", `${todayLastName(pick.name)} ${pick.matchup || ""}`.trim());
}

// ---------- Top 5 Hunts card ----------

function renderTodayHunts() {
  if (!TODAY_HUNTS) return;
  const seeAll = document.getElementById("todayHuntsAll");
  if (seeAll && todayDay) seeAll.href = `hunt-score.html?date=${todayDay}`;
  if (!todayHunts) return;
  const list = huntTopList(todayHunts);
  TODAY_HUNTS.removeAttribute("aria-busy");
  if (list.length === 0) {
    const text = todayDay > huntTodayET()
      ? "Hunt Scores show up on game day."
      : todayHunts.props && todayHunts.props.length ? "No props scored 65+ yet." : "No props to score yet.";
    TODAY_HUNTS.innerHTML = `<div class="lh-top-message text-muted">${text}</div>`;
    return;
  }
  TODAY_HUNTS.innerHTML = list.slice(0, 5).map((prop, index) => huntCompactRowHtml(prop, index + 1)).join("");
}

function renderTodayHuntsLoading() {
  if (!TODAY_HUNTS) return;
  TODAY_HUNTS.setAttribute("aria-busy", "true");
  TODAY_HUNTS.innerHTML = `<div class="lh-hunt-row placeholder-glow" aria-hidden="true"><span class="placeholder col-12 rounded"></span></div>`.repeat(5);
}

// ---------- Phones: Top Hunts | Top Hit Rates switch (one card at a time under 768px; CSS shows both on wider screens) ----------

document.querySelectorAll("[data-today-pick]").forEach((button) => {
  button.addEventListener("click", () => {
    const pair = document.querySelector(".lh-today-pair");
    if (pair) pair.dataset.pick = button.dataset.todayPick;
    document.querySelectorAll("[data-today-pick]").forEach((other) => {
      const on = other === button;
      other.classList.toggle("is-on", on);
      other.setAttribute("aria-pressed", String(on));
    });
  });
});

// ---------- Called by js/pages/app.js ----------

async function showTodayForDay(day) {
  todayDay = day;
  todayHunts = null;
  todaySlate = null;
  renderToolTiles();
  updateToolLinks();
  renderTodayHuntsLoading();
  const seeAll = document.getElementById("todayHuntsAll");
  if (seeAll) seeAll.href = `hunt-score.html?date=${day}`;
  const topAll = document.getElementById("topHitRatesAll");
  if (topAll) topAll.href = `top-hit-rates.html?date=${day}`;

  const request = ++todayHuntsRequest;
  try {
    const data = await loadHunts(day);
    if (request !== todayHuntsRequest) return;
    todayHunts = data;
    huntTeaser();
    renderTodayHunts();
    matchupTeaser();
    if (await ensureHuntOdds(huntTopList(data)) && request === todayHuntsRequest) renderTodayHunts(); // odds arrived: draw the chips
  } catch (error) {
    if (request !== todayHuntsRequest) return;
    console.error(error);
    setTeaser("hunt", "Couldn't load scores");
    if (TODAY_HUNTS) {
      TODAY_HUNTS.removeAttribute("aria-busy");
      TODAY_HUNTS.innerHTML = `<div class="lh-top-message text-muted">Couldn't load the Hunt Score right now. Try again in a minute.</div>`;
    }
  }
}

// js/components/top-hit-rates.js: the slate for the picked day is ready (or has a message instead).
document.addEventListener("lh-top-slate", (event) => {
  const { slate, message } = event.detail || {};
  if (slate && todayDay && slate.date && slate.date !== todayDay) return; // an older day
  todaySlate = slate || null;
  slateTeasers(todaySlate, message);
  renderTodayHunts(); // the slate fed js/data/odds.js: the hunt rows get their odds chips
});

renderToolTiles();
