// LineHunter - js/pages/standings.js
// The Standings page (standings.html): East and West, as a Conference view (ranked lists with the play-in line) or a
// Division view (small cards). Needs js/core/stats.js (BDL_BASE, bdlGet, bdlGetAllPages, currentSeasonYear).
//
// Data:
//   Standings: GET /v1/standings?season=2025 -> 30 rows { team: { id, full_name, abbreviation, conference, division }, wins, losses,
//              home_record: "31-9", road_record: "28-13" }  (a season nobody has played yet comes back as { data: [] })
//   Games:     GET /v1/games?team_ids[]=ID&seasons[]=2025&per_page=100 -> L10 and the streak are worked out from each team's
//              most recent finished regular-season games, not from the standings.
// Season: the new season shows as soon as its median team has played a game (STANDINGS_MIN_GAMES); only before opening night is
// last season's final table shown, labeled "2025–26 final". GB is worked out from the leader's wins and losses.

const STANDINGS_MIN_GAMES = 1;
const STANDINGS_CACHE_MINUTES = 10;

// One color per division (CSS variables --lh-div-*, a set per theme). The over / under colors are not used for these.
const DIVISIONS = {
  East: ["Atlantic", "Central", "Southeast"],
  West: ["Northwest", "Pacific", "Southwest"],
};

let standingsData = null;     // { season, label, teams: [...] } once loaded
let standingsView = "conference";

// ---------- Cache ----------

function standingsCacheRead(key) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    return saved && Date.now() - saved.savedAt < STANDINGS_CACHE_MINUTES * 60000 ? saved.data : null;
  } catch (error) {
    return null;
  }
}

function standingsCacheWrite(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch (error) {
    // storage full or blocked: it just won't be cached
  }
}

// ---------- Loading ----------

async function fetchStandingsRows(season) {
  const key = `lh-standings-page:${season}`;
  const cached = standingsCacheRead(key);
  if (cached) return cached;
  const json = await bdlGet(`${BDL_BASE}/standings?season=${season}`);
  const rows = (json.data || []).map((row) => ({
    id: row.team.id,
    name: row.team.full_name,
    abbr: row.team.abbreviation,
    conference: row.team.conference,
    division: row.team.division,
    wins: row.wins,
    losses: row.losses,
    home: row.home_record || "–",
    road: row.road_record || "–",
  }));
  standingsCacheWrite(key, rows);
  return rows;
}

// A team's finished regular-season games, newest first: [{ date, won }]
async function fetchResults(teamId, season) {
  const key = `lh-standings-games:${teamId}:${season}`;
  const cached = standingsCacheRead(key);
  if (cached) return cached;
  const games = await bdlGetAllPages(`${BDL_BASE}/games?team_ids[]=${teamId}&seasons[]=${season}&per_page=100`);
  const results = games
    .filter((game) => game.status === "Final" && !game.postseason)
    .map((game) => {
      const home = game.home_team.id === teamId;
      const mine = home ? game.home_team_score : game.visitor_team_score;
      const theirs = home ? game.visitor_team_score : game.home_team_score;
      return { date: game.date.slice(0, 10), won: mine > theirs };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  standingsCacheWrite(key, results);
  return results;
}

// "7-3" and { type: "W", count: 4 } from a newest-first list of results
function formFrom(results) {
  const last10 = results.slice(0, 10);
  const wins = last10.filter((game) => game.won).length;
  let count = 0;
  for (const game of results) {
    if (game.won !== results[0].won) break;
    count += 1;
  }
  return {
    l10: last10.length ? `${wins}-${last10.length - wins}` : "–",
    streak: results.length ? { type: results[0].won ? "W" : "L", count } : null,
  };
}

const gamesPlayed = (row) => row.wins + row.losses;
const winPct = (row) => (gamesPlayed(row) ? row.wins / gamesPlayed(row) : 0);

async function loadStandings() {
  const current = currentSeasonYear();
  let season = current;
  let rows = await fetchStandingsRows(season).catch(() => []);
  const played = rows.map(gamesPlayed).sort((a, b) => a - b);
  const median = played.length ? played[Math.floor(played.length / 2)] : 0;
  if (median < STANDINGS_MIN_GAMES) {
    season = current - 1;
    rows = await fetchStandingsRows(season);
  }
  if (rows.length === 0) throw new Error("No standings");

  const results = await Promise.all(rows.map((row) => fetchResults(row.id, season).catch(() => [])));
  const teams = rows.map((row, index) => ({ ...row, ...formFrom(results[index]) }));

  // Ranks and games behind: best record first, ties by wins. GB = ((leader W - W) + (L - leader L)) / 2.
  const byRecord = (a, b) => (winPct(b) - winPct(a)) || (b.wins - a.wins);
  const gamesBehind = (leader, row) => ((leader.wins - row.wins) + (row.losses - leader.losses)) / 2;
  ["East", "West"].forEach((conference) => {
    const list = teams.filter((team) => team.conference === conference).sort(byRecord);
    list.forEach((team, index) => { team.rank = index + 1; team.gb = gamesBehind(list[0], team); });
  });
  Object.values(DIVISIONS).flat().forEach((division) => {
    const list = teams.filter((team) => team.division === division).sort(byRecord);
    list.forEach((team) => { team.divGb = gamesBehind(list[0], team); });
  });

  const current26 = season === current;
  return {
    season,
    label: current26 ? `${season}–${String(season + 1).slice(2)}` : `${season}–${String(season + 1).slice(2)} final`,
    teams,
  };
}

// ---------- Drawing ----------

const divisionClass = (division) => `lh-div-${division.toLowerCase()}`;
const formatGb = (gb) => (gb === 0 ? "–" : Number.isInteger(gb) ? String(gb) : gb.toFixed(1));
const formatPct = (row) => (gamesPlayed(row) ? winPct(row).toFixed(3).replace(/^0/, "") : "–");

function streakHtml(streak) {
  if (!streak) return `<span class="text-muted">–</span>`;
  return `<span class="lh-st-streak lh-st-streak--${streak.type === "W" ? "win" : "loss"}">${streak.type}${streak.count}</span>`;
}

function conferenceList(conference) {
  const teams = standingsData.teams.filter((team) => team.conference === conference).sort((a, b) => a.rank - b.rank);
  const rows = [];
  teams.forEach((team) => {
    rows.push(`
      <div class="lh-st-row" role="row">
        <span class="c-rank">${team.rank}</span>
        <span class="c-team"><i class="lh-div-dot ${divisionClass(team.division)}" title="${team.division}"></i><span class="lh-st-name">${team.name}</span></span>
        <span class="c-wl">${team.wins}–${team.losses}</span>
        <span class="c-pct">${formatPct(team)}</span>
        <span class="c-gb">${formatGb(team.gb)}</span>
        <span class="c-home">${team.home}</span>
        <span class="c-road">${team.road}</span>
        <span class="c-l10">${team.l10}</span>
        <span class="c-streak">${streakHtml(team.streak)}</span>
      </div>`);
    if (team.rank === 6) rows.push(`<div class="lh-st-sep"><span>Play-in</span></div>`);
    if (team.rank === 10) rows.push(`<div class="lh-st-sep"><span>Out</span></div>`);
  });

  const legend = DIVISIONS[conference].map((division) =>
    `<span class="lh-st-legend-item"><i class="lh-div-dot ${divisionClass(division)}"></i>${division}</span>`).join("");

  return `
    <section class="lh-st-conf" aria-label="${conference}ern Conference">
      <h2 class="lh-st-heading">${conference}ern Conference</h2>
      <div class="lh-st-scroll">
        <div class="lh-st-table" role="table">
          <div class="lh-st-row lh-st-head" role="row">
            <span class="c-rank">#</span><span class="c-team">Team</span><span class="c-wl">W–L</span><span class="c-pct">PCT</span>
            <span class="c-gb">GB</span><span class="c-home">Home</span><span class="c-road">Road</span><span class="c-l10">L10</span><span class="c-streak">Strk</span>
          </div>
          ${rows.join("")}
        </div>
      </div>
      <div class="lh-st-legend">${legend}</div>
    </section>`;
}

function divisionCard(division) {
  const teams = standingsData.teams.filter((team) => team.division === division).sort((a, b) => (a.divGb - b.divGb) || (winPct(b) - winPct(a)));
  return `
    <section class="lh-st-card ${divisionClass(division)}" aria-label="${division} Division">
      <h3 class="lh-st-card-title">${division}</h3>
      <div class="lh-st-card-head"><span>Team</span><span>W–L</span><span>GB</span><span>Strk</span></div>
      ${teams.map((team) => `
        <div class="lh-st-card-row">
          <span class="lh-st-name">${team.name}</span><span>${team.wins}–${team.losses}</span><span>${formatGb(team.divGb)}</span><span>${streakHtml(team.streak)}</span>
        </div>`).join("")}
    </section>`;
}

function renderStandings() {
  const body = document.getElementById("standingsBody");
  body.removeAttribute("aria-busy");
  const columns = ["East", "West"].map((conference) => `
    <div class="col-12 col-lg-6">
      ${standingsView === "conference"
        ? conferenceList(conference)
        : `<h2 class="lh-st-heading">${conference}ern Conference</h2><div class="lh-st-cards">${DIVISIONS[conference].map(divisionCard).join("")}</div>`}
    </div>`).join("");
  body.innerHTML = `<div class="row g-4 g-xl-5">${columns}</div>`;
  document.getElementById("standingsSeason").textContent = standingsData.label;
}

function renderViewToggle() {
  const group = document.getElementById("standingsView");
  group.innerHTML = "";
  [["conference", "Conference"], ["division", "Division"]].forEach(([value, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = value === standingsView ? "btn btn-ghost active" : "btn btn-ghost";
    button.setAttribute("aria-pressed", String(value === standingsView));
    button.textContent = label;
    button.addEventListener("click", () => {
      standingsView = value;
      renderViewToggle();
      if (standingsData) renderStandings();
    });
    group.appendChild(button);
  });
}

function showStandingsMessage(html) {
  const body = document.getElementById("standingsBody");
  body.removeAttribute("aria-busy");
  body.innerHTML = `<div class="text-muted py-4">${html}</div>`;
}

async function startStandings() {
  renderViewToggle();
  try {
    standingsData = await loadStandings();
    renderStandings();
  } catch (error) {
    console.error(error);
    showStandingsMessage("Couldn't load the standings right now. Try again in a minute.");
  }
}

startStandings();
