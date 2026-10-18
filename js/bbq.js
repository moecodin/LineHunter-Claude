// LineHunter - js/bbq.js
// "BBQ Chicken" (hoops slang for an easy matchup): players on tonight's slate facing one of the 5 weakest defenses for
// the stat they produce the most of. Shown in both modes: as a card in the Hit List grid (lines mode, js/hit-list.js)
// and in the Streaks grid (research mode, js/fanCards.js). Both just call fillBbqSlots(slate).
//
// How it works:
//   1. Each team's defense per game for points / rebounds / assists / 3PM allowed, from
//        GET /nba/v1/team_season_averages/general?season=2025&season_type=regular&type=opponent&per_page=100
//      (fields opp_pts, opp_reb, opp_ast, opp_fg3m; this season, else last season), cached in sessionStorage.
//   2. A player's "main stat" = the one of PTS / REB / AST / 3PM where their season average is the highest compared
//      with the average of everyone on tonight's slate (so a big man lands on rebounds, a guard on assists).
//   3. If tonight's opponent allows one of the 5 highest numbers in the league for that stat, the player is listed.
//      Sorted by how bad that opponent's rank is, then by how far above the slate average the player is.
//
// Needs js/stats.js, js/top-hit-rates.js (slate.fan) and js/hit-list.js (shortName).

const BBQ_STATS = [
  { code: "pts", label: "PTS", oppField: "opp_pts" },
  { code: "reb", label: "REB", oppField: "opp_reb" },
  { code: "ast", label: "AST", oppField: "opp_ast" },
  { code: "3pm", label: "3PM", oppField: "opp_fg3m" },
];
const BBQ_WORST_N = 5;        // "one of the 5 worst defenses"
const BBQ_MAX_ROWS = 5;
const BBQ_MIN_POOL = 6;       // need at least this many players on the slate to say who is "above average"
const BBQ_CACHE_MS = 60 * 60 * 1000;
const BBQ_URL = "https://api.balldontlie.io/nba/v1/team_season_averages/general";

let bbqRequest = 0; // goes up with every fill, so a slow old answer can't overwrite a newer one

// "1st", "2nd", "3rd", "4th", "11th", "21st"...
function bbqOrdinal(n) {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}

// { teamId: { abbr, pts, reb, ast, "3pm" } } allowed per game, or null if the season has no games.
async function loadOpponentAllowed(season) {
  const key = `lh-opp-allowed:${season}`;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    if (saved && Date.now() - saved.savedAt < BBQ_CACHE_MS) return saved.data;
  } catch (error) {
    // storage blocked: just download
  }

  const rows = await bdlGetAllPages(`${BBQ_URL}?season=${season}&season_type=regular&type=opponent&per_page=100`);
  let data = null;
  if (rows.length) {
    data = {};
    rows.forEach((row) => {
      data[row.team.id] = { abbr: row.team.abbreviation };
      BBQ_STATS.forEach((stat) => { data[row.team.id][stat.code] = Number(row.stats[stat.oppField]); });
    });
  }
  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch (error) {
    // storage full or blocked: it just won't be cached
  }
  return data;
}

// The listed players for a slate (slate.fan = one entry per player, see js/top-hit-rates.js).
async function bbqPicksFor(slate) {
  const players = (slate.fan || []).filter((player) => player.oppId !== null && player.oppId !== undefined);
  if (players.length < BBQ_MIN_POOL) return [];

  let defenses = await loadOpponentAllowed(currentSeasonYear());
  if (!defenses) defenses = await loadOpponentAllowed(currentSeasonYear() - 1); // the 2026 -> 2025 fallback
  if (!defenses) return [];

  // The slate's average for each stat: the yardstick for "the stat they average the most of".
  const poolMean = {};
  BBQ_STATS.forEach((stat) => {
    const values = players.map((player) => player.st[stat.code].season).filter((value) => value !== null);
    poolMean[stat.code] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  });

  const picks = [];
  players.forEach((player) => {
    let best = null;
    BBQ_STATS.forEach((stat) => {
      const average = player.st[stat.code].season;
      if (average === null || poolMean[stat.code] <= 0) return;
      const ratio = average / poolMean[stat.code];
      if (!best || ratio > best.ratio) best = { stat, average, ratio };
    });
    const opponent = defenses[player.oppId];
    if (!best || !opponent) return;

    // 1 = allows the most in the league (the weakest defense for that stat).
    const rank = 1 + Object.values(defenses).filter((team) => team[best.stat.code] > opponent[best.stat.code]).length;
    if (rank <= BBQ_WORST_N) picks.push({ player, ...best, rank });
  });

  return picks.sort((a, b) => a.rank - b.rank || b.ratio - a.ratio).slice(0, BBQ_MAX_ROWS);
}

function bbqLegHtml(pick) {
  const { player, stat } = pick;
  const place = pick.rank === 1 ? "the most" : `${bbqOrdinal(pick.rank)} most`;
  return `
    <a class="lh-hitlist-leg is-stacked" href="game.html?id=${player.gameId}&player=${player.playerId}&prop=${stat.code}" title="${player.name} ${player.matchup}">
      <span class="lh-hitlist-name">${shortName(player.name)} ${teamBadgeForMatchup(player.team, player.matchup)}</span>
      <span class="lh-hitlist-proof">avg ${formatStatValue(pick.average)} ${stat.label}</span>
      <span class="lh-hitlist-sub">${player.matchup} · allows ${place} ${stat.label}</span>
    </a>`;
}

// Fills every BBQ Chicken card on the page ([data-bbq-slot]). Safe to call when there is none.
async function fillBbqSlots(slate) {
  const slots = document.querySelectorAll("[data-bbq-slot]");
  if (slots.length === 0) return;
  const request = ++bbqRequest;

  let html;
  try {
    const picks = await bbqPicksFor(slate);
    html = picks.length ? picks.map(bbqLegHtml).join("") : `<div class="lh-hitlist-empty text-muted">No easy matchups tonight</div>`;
  } catch (error) {
    console.warn("BBQ Chicken unavailable:", error);
    html = `<div class="lh-hitlist-empty text-muted">Unavailable right now</div>`;
  }
  if (request !== bbqRequest) return;
  document.querySelectorAll("[data-bbq-slot]").forEach((slot) => { slot.innerHTML = html; });
}

// The card's markup, the same look as the other small cards (half width: Brick City sits next to it).
function bbqCardHtml() {
  return `
    <div class="lh-shelf-item">
      <div class="lh-hitlist-card">
        <div class="lh-hitlist-head"><i class="bi bi-fire" aria-hidden="true"></i><span>BBQ Chicken 🍗</span></div>
        <div class="lh-hitlist-blurb" title="Hoops slang: an easy matchup.">Facing one of the 5 weakest defenses for their main stat (points, rebounds, assists or 3PM)</div>
        <div class="lh-hitlist-list" data-bbq-slot><div class="lh-hitlist-empty text-muted">Loading…</div></div>
      </div>
    </div>`;
}
