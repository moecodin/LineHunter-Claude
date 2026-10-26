// LineHunter - js/components/samePosition.js
// The "Same Position vs BOS" card on player.html (right under the prop chart): how players at this player's position did
// against the opponent in its last 10 finished games, each scored against THIS player's current line for the selected prop tab.
//
// Position groups go by the FIRST listed position: G and G-F = Guards, F, F-G and F-C = Forwards, C and C-F = Centers.
// Lines under 10 minutes are left out (garbage time / DNP-CD rows would drag the numbers down).
//
// Data (two requests per opponent, cached in sessionStorage lh-same-pos:TEAM for 10 minutes):
//   GET /v1/games?team_ids[]=OPP&seasons[]=SEASON&per_page=100   -> the opponent's games (last season if none are Final yet)
//   GET /v1/stats?game_ids[]=…&per_page=100 (paged)              -> every stat line in its last 10 Final games
// Only the other team's lines are kept: the players who FACED the opponent.

const SAME_POS_GAMES = 10;
const SAME_POS_MIN_MINUTES = 10;
const SAME_POS_ROWS = 8;                      // rows shown before "Show all (N)"
const SAME_POS_CACHE_MS = 10 * 60 * 1000;
const SAME_POS_GROUPS = { G: "guards", F: "forwards", C: "centers" };

const samePosState = {
  playerId: null,
  group: null,       // "G", "F" or "C"
  opponents: [],     // [{ id, abbr, fullName }] for the dropdown
  opponent: null,    // the team on screen
  data: null,        // { season, isLastSeason, games, rows } for that team, or null while loading
  status: "loading", // "loading", "ready", "failed"
  propType: "points",
  line: null,        // the chart's active line (the milestone in research mode)
};

// "G-F" -> "G". Unknown or empty -> null.
function samePosGroup(position) {
  const first = String(position || "").trim().charAt(0).toUpperCase();
  return SAME_POS_GROUPS[first] ? first : null;
}

// "34:12" -> 34.2, "34" -> 34, "" -> 0
function samePosMinutes(min) {
  const [minutes, seconds] = String(min || "0").split(":");
  return (Number(minutes) || 0) + (Number(seconds) || 0) / 60;
}

function readSamePosCache(key) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    return saved && Date.now() - saved.savedAt < SAME_POS_CACHE_MS ? saved.data : null;
  } catch (error) {
    return null;
  }
}

function writeSamePosCache(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch (error) {
    // storage full or blocked: it just downloads again next time
  }
}

// ---------- Data ----------

// The opponent's Final games in one season, newest first.
async function samePosFinishedGames(teamId, season) {
  const games = await bdlGetAllPages(`${BDL_BASE}/games?team_ids[]=${teamId}&seasons[]=${season}&per_page=100`);
  return games.filter((game) => game.status === "Final").sort((a, b) => b.date.localeCompare(a.date));
}

// Every stat line by the players who faced this team in its last 10 Final games (this season, else last season).
async function loadSamePositionData(teamId) {
  const key = `lh-same-pos:${teamId}`;
  const cached = readSamePosCache(key);
  if (cached) return cached;

  let season = currentSeasonYear();
  let games = await samePosFinishedGames(teamId, season);
  const isLastSeason = games.length === 0;
  if (isLastSeason) {
    season -= 1;
    games = await samePosFinishedGames(teamId, season);
  }
  games = games.slice(0, SAME_POS_GAMES);

  let rows = [];
  if (games.length) {
    const ids = games.map((game) => `game_ids[]=${game.id}`).join("&");
    const lines = await bdlGetAllPages(`${BDL_BASE}/stats?${ids}&per_page=100`);
    rows = lines
      .filter((line) => line.team && line.team.id !== teamId && line.player && line.game)
      .map((line) => ({
        playerId: line.player.id,
        name: `${line.player.first_name} ${line.player.last_name}`,
        position: line.player.position || "",
        team: line.team.abbreviation,
        isHome: line.game.home_team_id === line.team.id,
        date: line.game.date,
        min: samePosMinutes(line.min),
        pts: line.pts ?? 0,
        reb: line.reb ?? 0,
        ast: line.ast ?? 0,
        fg3m: line.fg3m ?? 0,
      }));
  }

  const data = { season, isLastSeason, games: games.length, rows };
  writeSamePosCache(key, data);
  return data;
}

// ---------- Drawing ----------

function samePosText(text) {
  const body = document.getElementById("samePosBody");
  body.className = "text-muted small py-4 text-center";
  body.textContent = text;
  document.getElementById("samePosToggle").hidden = true;
}

// "Show all (N)" / "Show fewer", like the game log's button.
// The open / closed state survives redraws (tab, line or team changes).
let samePosTotal = 0;
let samePosOpen = false;
function updateSamePosToggle(total) {
  samePosTotal = total;
  const button = document.getElementById("samePosToggle");
  button.hidden = total <= SAME_POS_ROWS;
  button.classList.toggle("collapsed", !samePosOpen);
  button.setAttribute("aria-expanded", String(samePosOpen));
  document.getElementById("samePosToggleText").textContent = samePosOpen ? "Show fewer" : `Show all (${total})`;
}

function samePosRowHtml(row, stat, scoringLine) {
  const value = statValue(row, stat);
  let tone = "";
  if (scoringLine !== null) tone = value > scoringLine ? "is-over" : value < scoringLine ? "is-under" : "is-push";
  const opp = samePosState.opponent.abbr;
  const badge = teamBadgeHtml(row.team, row.isHome ? opp : row.team, row.isHome ? row.team : opp);
  return `<tr${row.playerId === samePosState.playerId ? ` class="lh-sp-self"` : ""}>
      <td class="text-nowrap">${monthDayDate(row.date)}</td>
      <td class="text-nowrap"><a href="player.html?id=${row.playerId}&prop=${propCode(samePosState.propType)}" class="lh-sp-name">${row.name}</a> ${badge}
        <span class="text-muted small">${row.position}</span></td>
      <td class="text-end">${Math.round(row.min)}</td>
      <td class="text-end lh-col-active ${tone}">${value}</td>
    </tr>`;
}

function renderSamePositionCard() {
  if (!samePosState.opponent) return;
  document.getElementById("samePosOpp").textContent = samePosState.opponent.abbr;
  if (!samePosState.group) { samePosText("No position is listed for this player."); return; }
  if (samePosState.status === "loading") { samePosText(`Loading ${samePosState.opponent.abbr}'s recent games...`); return; }
  if (samePosState.status === "failed") { samePosText("Matchup data is unavailable right now."); return; }

  const data = samePosState.data;
  const groupWord = SAME_POS_GROUPS[samePosState.group];
  if (data.games === 0) { samePosText(`${samePosState.opponent.abbr} hasn't finished a game yet.`); return; }

  const tab = CHART_STAT_TABS.find((option) => option.propType === samePosState.propType);
  const code = propCode(samePosState.propType).toUpperCase();
  const scoringLine = lineForScoring(samePosState.line);
  const rows = data.rows
    .filter((row) => row.min >= SAME_POS_MIN_MINUTES && samePosGroup(row.position) === samePosState.group)
    .sort((a, b) => b.date.localeCompare(a.date) || statValue(b, tab.stat) - statValue(a, tab.stat));

  const gamesText = `last ${data.games} game${data.games === 1 ? "" : "s"}${data.isLastSeason ? " of last season" : ""}`;
  if (rows.length === 0) { samePosText(`No ${groupWord} played ${SAME_POS_MIN_MINUTES}+ minutes against ${samePosState.opponent.abbr} in its ${gamesText}.`); return; }

  const values = rows.map((row) => statValue(row, tab.stat));
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  let summary = `${groupWord.charAt(0).toUpperCase()}${groupWord.slice(1)} averaged <strong>${formatStatValue(average)} ${code}</strong>`;
  if (scoringLine !== null) {
    const hits = values.filter((value) => value > scoringLine).length;
    summary = isResearchMode()
      ? `<strong>${hits} of ${rows.length}</strong> ${groupWord} reached <strong>${samePosState.line}+ ${code}</strong> · avg ${formatStatValue(average)}`
      : `<strong>${hits} of ${rows.length}</strong> ${groupWord} went over <strong>${lineText(samePosState.line)} ${code}</strong> · avg ${formatStatValue(average)}`;
  }

  const body = document.getElementById("samePosBody");
  body.className = "";
  const rowsHtml = rows.map((row) => samePosRowHtml(row, tab.stat, scoringLine));
  body.innerHTML = `
    <div class="lh-sp-summary mb-2">${summary}</div>
    <div class="lh-label text-muted mb-2">${samePosState.opponent.abbr}'s ${gamesText} · ${SAME_POS_MIN_MINUTES}+ minutes</div>
    <div class="table-responsive">
      <table class="table table-sm align-middle mb-0 lh-sp-table">
        <thead><tr><th>Date</th><th>Player</th><th class="text-end">MIN</th><th class="text-end">${code}</th></tr></thead>
        <tbody>${rowsHtml.slice(0, SAME_POS_ROWS).join("")}</tbody>
        <tbody id="samePosMore" class="collapse${samePosOpen ? " show" : ""}">${rowsHtml.slice(SAME_POS_ROWS).join("")}</tbody>
      </table>
    </div>`;
  ["shown.bs.collapse", "hidden.bs.collapse"].forEach((eventName) => {
    document.getElementById("samePosMore").addEventListener(eventName, () => {
      samePosOpen = eventName === "shown.bs.collapse";
      updateSamePosToggle(samePosTotal);
    });
  });
  updateSamePosToggle(rowsHtml.length);
}

// Download (or reuse) one team's data, then draw. A newer pick wins if the user switches teams while it loads.
async function showSamePositionTeam(team) {
  samePosState.opponent = team;
  samePosState.status = "loading";
  samePosState.data = null;
  renderSamePositionCard();
  if (!samePosState.group) return;
  try {
    const data = await loadSamePositionData(team.id);
    if (samePosState.opponent !== team) return;
    samePosState.data = data;
    samePosState.status = "ready";
  } catch (error) {
    console.error("Same position card failed:", error);
    if (samePosState.opponent !== team) return;
    samePosState.status = "failed";
  }
  renderSamePositionCard();
}

// ---------- The card ----------

// Called by js/pages/player.js once the player and next game are known. opponentId = the next game's opponent, or null:
// like the Zone Matchup card, no upcoming game = the first team alphabetically with a "No upcoming game" note.
async function loadSamePosition({ playerId, position, ownTeamId, opponentId }) {
  samePosState.playerId = playerId;
  samePosState.group = samePosGroup(position);
  const select = document.getElementById("samePosTeam");
  const note = document.getElementById("samePosNote");

  try {
    const teams = (await bdlGet(`${BDL_BASE}/teams`)).data;
    samePosState.opponents = teams
      .filter((team) => team.id <= 30 && team.id !== ownTeamId) // ids 1-30 are today's teams; the rest are historical
      .map((team) => ({ id: team.id, abbr: team.abbreviation, fullName: team.full_name }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  } catch (error) {
    console.error("Teams unavailable:", error);
    samePosText("Matchup data is unavailable right now.");
    return;
  }
  if (samePosState.opponents.length === 0) { samePosText("Matchup data is unavailable right now."); return; }

  const upcoming = samePosState.opponents.find((team) => team.id === opponentId);
  const chosen = upcoming || samePosState.opponents[0];
  note.textContent = upcoming ? "Next game" : "No upcoming game";

  select.innerHTML = samePosState.opponents.map((team) => `<option value="${team.id}">${team.fullName}</option>`).join("");
  select.value = String(chosen.id);
  select.disabled = false;
  select.onchange = () => {
    const picked = samePosState.opponents.find((team) => team.id === Number(select.value));
    note.textContent = upcoming && picked.id === upcoming.id ? "Next game" : "";
    showSamePositionTeam(picked);
  };

  showSamePositionTeam(chosen);
}

// Called by renderProps in js/pages/player.js: the prop tab or the line changed. Redraws from the data in memory.
function renderSamePosition(propType, line) {
  samePosState.propType = propType;
  samePosState.line = line;
  renderSamePositionCard();
}
