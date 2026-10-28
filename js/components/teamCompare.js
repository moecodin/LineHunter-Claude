// LineHunter - js/components/teamCompare.js
// The "Matchup Details" card on game.html: a butterfly chart of the two teams' season numbers. It is always visible
// (directly under the props / stats card) and only downloads its data when it scrolls into view.
//
// Real API shapes (checked against live responses). All three are
//   GET /nba/v1/team_season_averages/general?season=2025&season_type=regular&type=<base|opponent|advanced>&per_page=100
// and return one row per team (30), data[i].team = { id, abbreviation, ... }, data[i].stats = { ... }:
//   type=base      -> pts, reb, ast, fg3m, fg_pct (0.474), fg3_pct (0.371), tov        (plus *_rank fields: we rank ourselves)
//   type=opponent  -> opp_pts (points allowed)
//   type=advanced  -> pace, off_rating, def_rating, net_rating
// A season with no games comes back as { data: [] } (2026 does until games are played).
//
// Needs js/core/stats.js (bdlGetAllPages, currentSeasonYear).

const TEAM_GENERAL_URL = "/api/bdl/nba/v1/team_season_averages/general";
const COMPARE_CACHE_MS = 60 * 60 * 1000;

// The 12 rows, in order. better: "high" (bigger is better), "low" (smaller is better), or "none" (Pace: no better or worse).
// type + field = where the number lives in the API response.
const COMPARE_STATS = [
  { key: "pts", label: "PPG", type: "base", field: "pts", better: "high" },
  { key: "oppPts", label: "Opp PPG", type: "opponent", field: "opp_pts", better: "low" },
  { key: "pace", label: "Pace", type: "advanced", field: "pace", better: "none" },
  { key: "off", label: "Off Rtg", type: "advanced", field: "off_rating", better: "high" },
  { key: "def", label: "Def Rtg", type: "advanced", field: "def_rating", better: "low" },
  { key: "net", label: "Net Rtg", type: "advanced", field: "net_rating", better: "high" },
  { key: "reb", label: "RPG", type: "base", field: "reb", better: "high" },
  { key: "ast", label: "APG", type: "base", field: "ast", better: "high" },
  { key: "fg3m", label: "3PM", type: "base", field: "fg3m", better: "high" },
  { key: "fgPct", label: "FG%", type: "base", field: "fg_pct", better: "high", percent: true },
  { key: "fg3Pct", label: "3P%", type: "base", field: "fg3_pct", better: "high", percent: true },
  { key: "tov", label: "TOV", type: "base", field: "tov", better: "low" },
];

const COMPARE_MIN_BAR = 10; // the weakest team in the league still gets a 10% bar, so it's visible

let compareLoaded = false; // true once the first open has started the download

// ---------- Data ----------

// { season, teams: { teamId: { abbr, pts: 118.5, oppPts: 116, ... } } } for all 30 teams, or null if neither season has data.
async function loadTeamComparisonData(season) {
  const key = `lh-team-compare:${season}`;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    if (saved && Date.now() - saved.savedAt < COMPARE_CACHE_MS) return saved.data;
  } catch (error) {
    // storage blocked: just download
  }

  const types = [...new Set(COMPARE_STATS.map((stat) => stat.type))];
  const lists = await Promise.all(types.map((type) =>
    bdlGetAllPages(`${TEAM_GENERAL_URL}?season=${season}&season_type=regular&type=${type}&per_page=100`)
  ));

  const teams = {};
  types.forEach((type, index) => {
    lists[index].forEach((row) => {
      teams[row.team.id] = teams[row.team.id] || { abbr: row.team.abbreviation };
      COMPARE_STATS.filter((stat) => stat.type === type).forEach((stat) => {
        teams[row.team.id][stat.key] = row.stats[stat.field] ?? null;
      });
    });
  });

  const data = Object.keys(teams).length ? { season, teams } : null;
  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch (error) {
    // storage full or blocked: it just won't be cached
  }
  return data;
}

// ---------- Numbers ----------

// For one stat: each team's rank (1 = best, ties share a rank) and the league's lowest and highest value.
function compareLeague(stat, teams) {
  const values = Object.values(teams).map((team) => team[stat.key]).filter((value) => value !== null && value !== undefined);
  const beats = (a, b) => (stat.better === "low" ? a < b : a > b); // "a is better than b" (Pace counts bigger as #1)
  const rankOf = (value) => 1 + values.filter((other) => beats(other, value)).length;
  return { min: Math.min(...values), max: Math.max(...values), rankOf };
}

// Bar length 10-100%: the league's worst team is short, the best is full. Lower-is-better stats are flipped.
function barPercent(stat, value, league) {
  if (league.max === league.min) return 100;
  const raw = (value - league.min) / (league.max - league.min);
  const goodness = stat.better === "low" ? 1 - raw : raw;
  return COMPARE_MIN_BAR + (100 - COMPARE_MIN_BAR) * goodness;
}

function compareValueText(stat, value) {
  if (value === null || value === undefined) return "–";
  return stat.percent ? `${(value * 100).toFixed(1)}%` : value.toFixed(1);
}

// ---------- Drawing ----------

function compareRowHtml(stat, awayTeam, homeTeam, league) {
  const awayValue = awayTeam[stat.key];
  const homeValue = homeTeam[stat.key];
  const hasBoth = awayValue !== null && awayValue !== undefined && homeValue !== null && homeValue !== undefined;

  // Better team = over color, the other = under color. Pace, a tie or missing data = neutral gray.
  let awayTone = "neutral";
  let homeTone = "neutral";
  if (hasBoth && stat.better !== "none" && awayValue !== homeValue) {
    const awayBetter = stat.better === "low" ? awayValue < homeValue : awayValue > homeValue;
    awayTone = awayBetter ? "over" : "under";
    homeTone = awayBetter ? "under" : "over";
  }

  const chip = (value) => {
    if (value === null || value === undefined) return `<span class="lh-tc-rank">–</span>`;
    const rank = league.rankOf(value);
    const tone = stat.better === "none" ? "neutral" : rank <= 10 ? "over" : rank >= 21 ? "under" : "neutral";
    return `<span class="lh-tc-rank is-${tone}" title="#${rank} of 30 in ${stat.label}${stat.better === "none" ? " (1 = fastest)" : " (1 = best)"}">#${rank}</span>`;
  };
  const bar = (value, tone, side) => `<div class="lh-tc-bar is-${side}"><span class="is-${tone}" style="width: ${value === null || value === undefined ? 0 : barPercent(stat, value, league)}%"></span></div>`;

  return `
    <div class="lh-tc-row">
      <div class="lh-tc-val is-away"><span>${compareValueText(stat, awayValue)}</span>${chip(awayValue)}</div>
      ${bar(awayValue, awayTone, "away")}
      <div class="lh-tc-label">${stat.label}</div>
      ${bar(homeValue, homeTone, "home")}
      <div class="lh-tc-val is-home">${chip(homeValue)}<span>${compareValueText(stat, homeValue)}</span></div>
    </div>`;
}

function renderTeamComparison(game, data, usedLastSeason) {
  const awayTeam = data.teams[game.visitor_team.id];
  const homeTeam = data.teams[game.home_team.id];
  const body = document.getElementById("teamCompareBody");
  if (!awayTeam || !homeTeam) {
    body.innerHTML = `<div class="text-muted small py-3 text-center">Comparison data isn't available for these teams.</div>`;
    return;
  }

  const rows = COMPARE_STATS.map((stat) => compareRowHtml(stat, awayTeam, homeTeam, compareLeague(stat, data.teams)));
  // The header line while the ratings are hidden: "NYK better in 8 of 11" (Pace has no better or worse)
  const summary = document.getElementById("ratingsSummary");
  if (summary) {
    let awayBetter = 0;
    let homeBetter = 0;
    COMPARE_STATS.filter((stat) => stat.better !== "none").forEach((stat) => {
      const a = awayTeam[stat.key];
      const h = homeTeam[stat.key];
      if (a === null || a === undefined || h === null || h === undefined || a === h) return;
      const awayWins = stat.better === "low" ? a < h : a > h;
      if (awayWins) awayBetter += 1; else homeBetter += 1;
    });
    const total = COMPARE_STATS.filter((stat) => stat.better !== "none").length;
    const lead = awayBetter === homeBetter ? null : awayBetter > homeBetter
      ? `${game.visitor_team.abbreviation} better in ${awayBetter} of ${total}` : `${game.home_team.abbreviation} better in ${homeBetter} of ${total}`;
    summary.textContent = `${lead || `Even: ${awayBetter} each`}${usedLastSeason ? " · last season" : ""}`;
  }
  body.innerHTML = `
    <div class="d-flex justify-content-end align-items-baseline gap-2 mb-3">
      <span class="lh-label text-muted">${usedLastSeason ? "Last season" : `${data.season}-${String(data.season + 1).slice(2)} season`} · season averages</span>
    </div>
    <div class="lh-tc-teams"><span>${game.visitor_team.abbreviation}</span><span>${game.home_team.abbreviation}</span></div>
    <div class="lh-tc-grid">
      <div>${rows.slice(0, 6).join("")}</div>
      <div>${rows.slice(6).join("")}</div>
    </div>
    <div class="lh-shot-legend">Longer bar = better, scaled from the league's worst to best team · teal = the better of the two, coral = the other · rank chips: #1 = best of 30</div>`;
}

function renderCompareSkeleton() {
  const row = `<div class="lh-tc-row placeholder-glow" aria-hidden="true"><span class="placeholder col-12 rounded" style="height: 1.1rem"></span></div>`;
  document.getElementById("teamCompareBody").innerHTML = `
    <div class="lh-tc-grid"><div>${row.repeat(6)}</div><div>${row.repeat(6)}</div></div>`;
}

// ---------- The panel ----------

async function loadTeamComparison(game) {
  const body = document.getElementById("teamCompareBody");
  renderCompareSkeleton();
  try {
    let season = game.season;
    let data = await loadTeamComparisonData(season);
    let usedLastSeason = false;
    if (!data) {
      season -= 1; // the 2026 -> 2025 fallback
      data = await loadTeamComparisonData(season);
      usedLastSeason = true;
    }
    if (!data) {
      body.innerHTML = `<div class="text-muted small py-3 text-center">No team stats available yet.</div>`;
      return;
    }
    renderTeamComparison(game, data, usedLastSeason);
  } catch (error) {
    console.error("Team comparison failed:", error);
    body.innerHTML = `<div class="text-muted small py-3 text-center">Team comparison is unavailable right now.</div>`;
  }
}

// Called by js/pages/game.js once the game is known. The "Matchup Details" card is always visible; its numbers download only
// when it scrolls into view, so the top of the page isn't held up by 90 team numbers nobody has looked at yet.
function setUpTeamComparison(game) {
  const card = document.getElementById("matchupDetails");
  if (!card) return;
  renderCompareSkeleton(); // the card shows its loading rows right away

  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting) || compareLoaded) return;
    compareLoaded = true;
    observer.disconnect();
    loadTeamComparison(game);
  }, { rootMargin: "200px 0px" }); // start a little before it is fully on screen
  observer.observe(card);
}
