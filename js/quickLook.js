// LineHunter - js/quickLook.js
// The "Quick look" toggle on each game card of the schedule page. Opening it shows, for that game:
//   - the spread and total (the first book that posts both),
//   - who is on each team's injury report (names and status),
//   - the game's single best L10 hit-rate prop (from the Top Hit Rates data already loaded or cached).
// Nothing is downloaded until a card is opened the first time.
//
// Real API shapes (checked against live responses):
//   Odds:      GET /nba/v2/odds?game_ids[]=ID -> data[] one row per sportsbook:
//              { vendor: "draftkings", spread_home_value: "-1.5", spread_away_value: "1.5", total_value: "221.5", ... }
//              (strings; a book may have null for the total or the spread)
//   Injuries:  GET /v1/player_injuries?team_ids[]=2&team_ids[]=9&per_page=100 -> data[] { player: { team_id, ... }, status, ... }
//
// Needs js/stats.js, js/top-hit-rates.js (readTopCache, topSlate) and js/hit-list.js (shortName).

const ODDS_URL = "https://api.balldontlie.io/nba/v2/odds";
const QUICKLOOK_CACHE_MS = 10 * 60 * 1000;
const QUICKLOOK_PREFERRED_BOOK = "draftkings";

const QUICKLOOK_MAX_NAMES = 4; // names shown per team before "+N more"
const quickLooks = []; // every card's { game, body }, so the top prop can fill in when the hit-rate data arrives

// ---------- Data ----------

// The first book that posts both a spread and a total (DraftKings first), or null.
function pickOddsRow(rows) {
  const complete = rows.filter((row) => row.spread_home_value !== null && row.total_value !== null);
  return complete.find((row) => row.vendor === QUICKLOOK_PREFERRED_BOOK) || complete[0] || null;
}

async function fetchQuickLookData(game) {
  const key = `lh-quicklook-v2:${game.id}`;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    if (saved && Date.now() - saved.savedAt < QUICKLOOK_CACHE_MS) return saved.data;
  } catch (error) {
    // storage blocked: just download
  }

  const teamIds = [game.home_team.id, game.visitor_team.id];
  // Each part can fail on its own: the others still show.
  const [oddsJson, injuries] = await Promise.all([
    bdlGet(`${ODDS_URL}?game_ids[]=${game.id}`).catch(() => null),
    bdlGetAllPages(`${BDL_BASE}/player_injuries?${teamIds.map((id) => `team_ids[]=${id}`).join("&")}&per_page=100`).catch(() => null),
  ]);

  const row = oddsJson ? pickOddsRow(oddsJson.data || []) : null;
  // The players on one team's injury report: [{ name: "J. Tatum", status: "Out", description }], or null if that request failed.
  const playersFor = (teamId) => (injuries
    ? injuries.filter((item) => item.player && item.player.team_id === teamId).map((item) => ({
      name: `${item.player.first_name.charAt(0)}. ${item.player.last_name}`,
      status: item.status || "",
      description: item.description || "",
    }))
    : null);
  const data = {
    odds: row ? { spreadHome: Number(row.spread_home_value), total: Number(row.total_value), book: row.vendor } : null,
    oddsFailed: oddsJson === null,
    injuryHome: playersFor(game.home_team.id),
    injuryAway: playersFor(game.visitor_team.id),
  };

  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch (error) {
    // storage full or blocked: it just won't be cached
  }
  return data;
}

// ---------- Drawing ----------

// "-1.5" / "+0.5" / "PK"
function spreadText(value) {
  if (value === 0) return "PK";
  return value > 0 ? `+${value}` : `${value}`;
}

// The best L10 prop in this game from the Top Hit Rates data (already in memory, or in sessionStorage), or a short message.
function topPropText(game) {
  const day = game.date.slice(0, 10);
  const slate = (typeof topSlate !== "undefined" && topSlate && topSlate.date === day ? topSlate : null) || readTopCache(day);
  if (!slate) return `<span class="text-muted">still loading…</span>`;
  const best = (slate.rows || []).find((row) => row.gameId === game.id); // rows are already best first
  if (!best) return `<span class="text-muted">none with enough games</span>`;
  return `${shortName(best.name)} ${best.code.toUpperCase()} o${best.line} · <strong>${best.hits}/${best.totalGames}</strong>`;
}

function renderQuickLook(game, body, data) {
  const home = game.home_team.abbreviation;
  const away = game.visitor_team.abbreviation;
  const line = (label, value, extraClass = "") => `<div class="${extraClass}"><span class="lh-label">${label}</span>${value}</div>`;

  let odds = `<span class="text-muted">${data.oddsFailed ? "unavailable" : "not posted yet"}</span>`;
  if (data.odds) odds = `${home} ${spreadText(data.odds.spreadHome)} · O/U ${data.odds.total}`;

  // "J. Tatum (Out), D. Carter (DTD)". The first few names show; the rest become "+N more".
  const shortStatus = (status) => (/^out/i.test(status) ? "Out" : /day/i.test(status) ? "DTD" : /question/i.test(status) ? "Q" : /doubt/i.test(status) ? "D" : status);
  const names = (players) => {
    if (players.length === 0) return `<span class="text-muted">none</span>`;
    const shown = players.slice(0, QUICKLOOK_MAX_NAMES).map((player) =>
      `<span title="${player.description.replace(/"/g, "&quot;")}">${player.name}${player.status ? ` <span class="text-muted">(${shortStatus(player.status)})</span>` : ""}</span>`).join(", ");
    const extra = players.length - QUICKLOOK_MAX_NAMES;
    return extra > 0 ? `${shown} <span class="text-muted">+${extra} more</span>` : shown;
  };
  const injuryLines = (abbr, players) => `<div class="lh-ql-injury"><strong>${abbr}</strong> ${players === null ? `<span class="text-muted">unavailable</span>` : names(players)}</div>`;

  body.innerHTML = `
    ${line("Spread / Total", odds, "lines-only")}
    <div><span class="lh-label">Injury report</span></div>
    ${injuryLines(away, data.injuryAway)}
    ${injuryLines(home, data.injuryHome)}
    <div data-top-prop class="lines-only">${line("Top prop", topPropText(game))}</div>`;
}

// ---------- Hooking up one card ----------

// col = the card's slide element, game = the game. The card's markup (app.js) has #ql-GAMEID (the collapse) and .lh-ql-body.
function setUpQuickLook(col, game) {
  const panel = col.querySelector(`#ql-${game.id}`);
  const body = col.querySelector(".lh-ql-body");
  if (!panel || !body) return;

  let started = false;
  quickLooks.push({ game, body, started: () => started });
  panel.addEventListener("shown.bs.collapse", async () => {
    if (started) return; // only the first open downloads anything
    started = true;
    try {
      renderQuickLook(game, body, await fetchQuickLookData(game));
    } catch (error) {
      console.error("Quick look failed:", error);
      body.innerHTML = `<span class="text-muted">Couldn't load the quick look right now.</span>`;
      started = false; // let the next open try again
    }
  });
}

// Called by js/top-hit-rates.js when the hit-rate data arrives: any card already open fills in its top prop.
function refreshQuickLookTopProps() {
  quickLooks.forEach(({ game, body, started }) => {
    const slot = body.querySelector("[data-top-prop]");
    if (started() && slot) slot.innerHTML = `<div><span class="lh-label">Top prop</span>${topPropText(game)}</div>`;
  });
}
