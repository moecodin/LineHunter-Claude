// LineHunter - js/components/samePosition.js
// The "Same Position vs BOS" card on player.html (half width, right under the prop chart, Zone Matchup beside it): how players
// at this player's position did against the opponent in its last 10 finished games, each scored against THIS player's current
// line for the selected prop tab, and compared with their own norm (their last 10 games against other teams).
//
// The headline is the norm gap, not the over count: "Guards vs WAS: +0.1 AST vs their avg · Neutral". 2 of 13 going over
// 6.5 AST says little when those guards only average 3.8 anyway; guards getting fewer than usual against WAS is the signal.
//
// Position groups go by the FIRST listed position: G and G-F = Guards, F, F-G and F-C = Forwards, C and C-F = Centers.
// Lines under 10 minutes are left out (garbage time / DNP-CD rows would drag the numbers down).
//
// Data (cached in sessionStorage lh-same-pos-v2:TEAM:GROUP for 10 minutes):
//   GET /v1/games?team_ids[]=OPP&seasons[]=SEASON&per_page=100   -> the opponent's games (last season if none are Final yet)
//   GET /v1/stats?game_ids[]=…&per_page=100 (paged)              -> every stat line in its last 10 Final games
//   GET /v1/stats?player_ids[]=…(5 per request)&start_date=…     -> the listed players' recent games, for their norm
// Wide screens: rows grouped by game, a bar per stat with a tick at the line, and an L10 column.
// Under 992px the card is full width and keeps the plain table (Date, Player, MIN, stat, L10).

const SAME_POS_GAMES = 10;
const SAME_POS_MIN_MINUTES = 10;
const SAME_POS_ROWS = 6;                      // rows shown before "Show all (N)"
const SAME_POS_NORM_GAMES = 10;               // a player's norm = their last 10 games against other teams
const SAME_POS_NORM_DAYS = 40;                // ...looked for in this many days (10 games fit easily)
const SAME_POS_VERDICT_SHARE = 0.10;          // 10% above / below the norm = Favorable / Tough
const SAME_POS_SMALL_SAMPLE = 5;              // under 5 opponent games = "Small sample"
const SAME_POS_CACHE_MS = 10 * 60 * 1000;
const SAME_POS_GROUPS = { G: "guards", F: "forwards", C: "centers" };

const samePosState = {
  playerId: null,
  group: null,       // "G", "F" or "C"
  opponents: [],     // [{ id, abbr, fullName }] for the dropdown
  opponent: null,    // the team on screen
  data: null,        // { season, isLastSeason, games, rows, norms } for that team, or null while loading
  status: "loading", // "loading", "ready", "failed"
  propType: "points",
  line: null,        // the chart's active line (the milestone in research mode)
  open: false,       // "Show all" pressed (kept across redraws)
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

// Each player's norm: totals over their last 10 games (10+ minutes) NOT against this team.
// norms[playerId] = { games, pts, reb, ast, fg3m }. Players with no such games are left out.
async function loadSamePosNorms(playerIds, teamId) {
  if (playerIds.length === 0) return {};
  const since = new Date();
  since.setDate(since.getDate() - SAME_POS_NORM_DAYS);
  const start = since.toLocaleDateString("en-CA");
  const groups = splitIntoGroups(playerIds, PLAYERS_PER_REQUEST);
  const answers = await Promise.all(groups.map((group) =>
    bdlGetAllPages(`${BDL_BASE}/stats?${playerIdParams(group)}&start_date=${start}&per_page=100`)));

  const byPlayer = {};
  answers.flat().forEach((line) => {
    if (!line.player || !line.game || line.game.home_team_id === teamId || line.game.visitor_team_id === teamId) return;
    if (samePosMinutes(line.min) < SAME_POS_MIN_MINUTES) return;
    (byPlayer[line.player.id] = byPlayer[line.player.id] || []).push(line);
  });

  const norms = {};
  Object.entries(byPlayer).forEach(([id, lines]) => {
    const recent = lines.sort((a, b) => b.game.date.localeCompare(a.game.date)).slice(0, SAME_POS_NORM_GAMES);
    norms[id] = recent.reduce((total, line) => ({
      games: total.games + 1,
      pts: total.pts + (line.pts ?? 0),
      reb: total.reb + (line.reb ?? 0),
      ast: total.ast + (line.ast ?? 0),
      fg3m: total.fg3m + (line.fg3m ?? 0),
    }), { games: 0, pts: 0, reb: 0, ast: 0, fg3m: 0 });
  });
  return norms;
}

// Every 10+ minute line by players of this group who faced this team in its last 10 Final games (this season, else
// last season), plus those players' norms.
async function loadSamePositionData(teamId, group) {
  const key = `lh-same-pos-v2:${teamId}:${group}`;
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
        gameId: line.game.id,
        date: line.game.date,
        min: samePosMinutes(line.min),
        pts: line.pts ?? 0,
        reb: line.reb ?? 0,
        ast: line.ast ?? 0,
        fg3m: line.fg3m ?? 0,
      }))
      .filter((row) => row.min >= SAME_POS_MIN_MINUTES && samePosGroup(row.position) === group);
  }

  // The norm is a nice extra: if it fails the card still shows, with "–" in the L10 column.
  const norms = await loadSamePosNorms([...new Set(rows.map((row) => row.playerId))], teamId)
    .catch((error) => { console.warn("Same position norms unavailable:", error); return {}; });

  const data = { season, isLastSeason, games: games.length, rows, norms };
  writeSamePosCache(key, data);
  return data;
}

// ---------- Numbers ----------

// A player's norm for one stat ("pts", "pts+reb+ast"...), or null.
function samePosNorm(playerId, stat) {
  const norm = samePosState.data.norms[playerId];
  return norm && norm.games ? statValue(norm, stat) / norm.games : null;
}

// "+0.1" / "−1.6"
function samePosSigned(value) {
  const text = Math.abs(value).toFixed(1);
  return value >= 0.05 ? `+${text}` : value <= -0.05 ? `−${text}` : "0.0";
}

// ---------- Drawing ----------

function samePosText(text) {
  const body = document.getElementById("samePosBody");
  body.className = "text-muted small py-4 text-center";
  body.textContent = text;
  document.getElementById("samePosToggle").hidden = true;
}

function updateSamePosToggle(total) {
  const button = document.getElementById("samePosToggle");
  button.hidden = total <= SAME_POS_ROWS;
  button.setAttribute("aria-expanded", String(samePosState.open));
  button.classList.toggle("collapsed", !samePosState.open);
  document.getElementById("samePosToggleText").textContent = samePosState.open ? "Show fewer" : `Show all (${total})`;
  document.getElementById("samePosBody").classList.toggle("is-open", samePosState.open);
}

// over / under / push against the scoring line ("" with no line)
function samePosTone(value, scoringLine) {
  if (scoringLine === null) return "";
  return value > scoringLine ? "is-over" : value < scoringLine ? "is-under" : "is-push";
}

function samePosNameHtml(row) {
  return `<a href="player.html?id=${row.playerId}&prop=${propCode(samePosState.propType)}" class="lh-sp-name">${row.name}</a>`;
}

// "7.8" over "+2.2" (green when they beat their norm against this team). compact (the phone table): "7.8" and a small
// green ▲ / red ▼ badge instead of the number, nothing when equal.
function samePosNormHtml(row, value, stat, compact) {
  const norm = samePosNorm(row.playerId, stat);
  if (norm === null) return `<span class="text-muted">–</span>`;
  const gap = value - norm;
  const tone = gap >= 0.05 ? "is-over" : gap <= -0.05 ? "is-under" : "";
  if (compact) {
    const arrow = tone === "is-over" ? "up" : tone === "is-under" ? "down" : "";
    const label = tone === "is-over" ? "above" : "below";
    return `<span class="lh-sp-norm">${norm.toFixed(1)}</span>${arrow ? ` <span class="lh-sp-arrow ${tone}" title="${samePosSigned(gap)} vs their L10" aria-label="${label} their L10 average"><i class="bi bi-arrow-${arrow}-short" aria-hidden="true"></i></span>` : ""}`;
  }
  return `<span class="lh-sp-norm">${norm.toFixed(1)}</span><span class="lh-sp-gap ${tone}">${samePosSigned(gap)}</span>`;
}

// Wide screens: one row of the game-grouped list.
function samePosListRowHtml(row, stat, scoringLine, scale, extra) {
  const value = statValue(row, stat);
  const tick = samePosState.line === null ? "" : `<span class="lh-sp-tick" style="left: ${Math.min(100, (samePosState.line / scale) * 100)}%"></span>`;
  return `<div class="lh-sp-row${row.playerId === samePosState.playerId ? " lh-sp-self" : ""}${extra ? " lh-sp-extra" : ""}">
      <div class="lh-sp-who">${samePosNameHtml(row)}<span class="lh-sp-meta">${Math.round(row.min)} min · ${row.position}</span></div>
      <div class="lh-sp-barwrap">
        <span class="lh-sp-track"><span class="lh-sp-fill ${samePosTone(value, scoringLine)}" style="width: ${Math.min(100, (value / scale) * 100)}%"></span>${tick}</span>
        <span class="lh-sp-value ${samePosTone(value, scoringLine)}">${value}</span>
      </div>
      <div class="lh-sp-l10">${samePosNormHtml(row, value, stat)}</div>
    </div>`;
}

// Phones and tablets: the plain table row (Date, Player, MIN, stat, L10).
function samePosTableRowHtml(row, stat, scoringLine, extra) {
  const value = statValue(row, stat);
  const opp = samePosState.opponent.abbr;
  const badge = teamBadgeHtml(row.team, row.isHome ? opp : row.team, row.isHome ? row.team : opp);
  const classes = [row.playerId === samePosState.playerId ? "lh-sp-self" : "", extra ? "lh-sp-extra" : ""].filter(Boolean).join(" ");
  return `<tr${classes ? ` class="${classes}"` : ""}>
      <td class="text-nowrap">${monthDayDate(row.date)}</td>
      <td class="text-nowrap">${samePosNameHtml(row)} ${badge}
        <span class="text-muted small">${row.position}</span></td>
      <td class="text-end">${Math.round(row.min)}</td>
      <td class="text-end lh-col-active ${samePosTone(value, scoringLine)}">${value}</td>
      <td class="text-end text-nowrap">${samePosNormHtml(row, value, stat, true)}</td>
    </tr>`;
}

function renderSamePositionCard() {
  if (!samePosState.opponent) return;
  const oppAbbr = samePosState.opponent.abbr;
  document.getElementById("samePosOpp").textContent = oppAbbr;
  if (!samePosState.group) { samePosText("No position is listed for this player."); return; }
  if (samePosState.status === "loading") { samePosText(`Loading ${oppAbbr}'s recent games...`); return; }
  if (samePosState.status === "failed") { samePosText("Matchup data is unavailable right now."); return; }

  const data = samePosState.data;
  const groupWord = SAME_POS_GROUPS[samePosState.group];
  const GroupWord = groupWord.charAt(0).toUpperCase() + groupWord.slice(1);
  if (data.games === 0) { samePosText(`${oppAbbr} hasn't finished a game yet.`); return; }

  const tab = CHART_STAT_TABS.find((option) => option.propType === samePosState.propType);
  const code = propCode(samePosState.propType).toUpperCase();
  const scoringLine = lineForScoring(samePosState.line);
  const rows = [...data.rows].sort((a, b) => b.date.localeCompare(a.date) || statValue(b, tab.stat) - statValue(a, tab.stat));

  const gamesText = `${data.games} game${data.games === 1 ? "" : "s"}${data.isLastSeason ? " (last season)" : ""}`;
  if (rows.length === 0) { samePosText(`No ${groupWord} played ${SAME_POS_MIN_MINUTES}+ minutes against ${oppAbbr} in its last ${gamesText}.`); return; }

  // The headline: how much more (or less) than their own norm these players got against this team.
  const values = rows.map((row) => statValue(row, tab.stat));
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const withNorm = rows.map((row, index) => ({ value: values[index], norm: samePosNorm(row.playerId, tab.stat) })).filter((item) => item.norm !== null);
  let verdict = { label: "Neutral", tone: "neutral" };
  let headline = `${GroupWord} vs ${oppAbbr}: avg <strong>${formatStatValue(average)} ${code}</strong>`;
  let normText = "Their averages are unavailable.";
  if (withNorm.length) {
    const vsAvg = withNorm.reduce((sum, item) => sum + item.value, 0) / withNorm.length;
    const normAvg = withNorm.reduce((sum, item) => sum + item.norm, 0) / withNorm.length;
    const gap = vsAvg - normAvg;
    if (normAvg > 0 && gap / normAvg >= SAME_POS_VERDICT_SHARE) verdict = { label: "Favorable", tone: "over" };
    if (normAvg > 0 && gap / normAvg <= -SAME_POS_VERDICT_SHARE) verdict = { label: "Tough", tone: "under" };
    headline = `${GroupWord} vs ${oppAbbr}: <strong class="lh-sp-gap is-${verdict.tone}">${samePosSigned(gap)} ${code}</strong> vs their avg`;
    normText = `${formatStatValue(vsAvg)} vs ${oppAbbr} · ${formatStatValue(normAvg)} in their last ${SAME_POS_NORM_GAMES}`;
  }

  // Under it: the over count against this player's line, one dot per row.
  let countHtml = "";
  if (scoringLine !== null) {
    const hits = values.filter((value) => value > scoringLine).length;
    const what = isResearchMode() ? `reached ${samePosState.line}+ ${code}` : `went over ${lineText(samePosState.line)} ${code}`;
    const dots = values.map((value) => `<span class="lh-sp-dot ${samePosTone(value, scoringLine)}"></span>`).join("");
    countHtml = `<div class="lh-sp-count"><span><strong>${hits} of ${rows.length}</strong> ${what}</span><span class="lh-sp-dots" aria-hidden="true">${dots}</span></div>`;
  }
  const smallSample = data.games < SAME_POS_SMALL_SAMPLE ? ` · <span class="lh-sp-small">Small sample</span>` : "";

  // Wide screens: grouped by game. A game header is "extra" when its first row is.
  const scale = Math.max(...values, samePosState.line || 0, 1) * 1.15;
  let listHtml = "";
  let lastGame = null;
  rows.forEach((row, index) => {
    const extra = index >= SAME_POS_ROWS;
    if (row.gameId !== lastGame) {
      lastGame = row.gameId;
      const opp = samePosState.opponent.abbr;
      const badge = teamBadgeHtml(row.team, row.isHome ? opp : row.team, row.isHome ? row.team : opp);
      listHtml += `<div class="lh-sp-game${extra ? " lh-sp-extra" : ""}">${monthDayDate(row.date)} · ${badge}</div>`;
    }
    listHtml += samePosListRowHtml(row, tab.stat, scoringLine, scale, extra);
  });

  const body = document.getElementById("samePosBody");
  body.className = "";
  body.innerHTML = `
    <div class="lh-sp-head">
      <div class="lh-sp-headline">${headline} <span class="lh-zm-pill is-${verdict.tone}">${verdict.label}</span></div>
      <div class="small text-muted">${normText}</div>
      ${countHtml}
      <div class="lh-label text-muted mt-2">${oppAbbr}'s last ${gamesText} · ${SAME_POS_MIN_MINUTES}+ min${smallSample}</div>
    </div>
    <div class="lh-sp-list d-none d-lg-block">
      <div class="lh-sp-row lh-sp-cols"><span>Player</span><span>${code}${samePosState.line === null ? "" : ` vs ${isResearchMode() ? `${samePosState.line}+` : lineText(samePosState.line)}`}</span><span>L10 avg</span></div>
      ${listHtml}
    </div>
    <div class="table-responsive d-lg-none">
      <table class="table table-sm align-middle mb-0 lh-sp-table">
        <thead><tr><th>Date</th><th>Player</th><th class="text-end">MIN</th><th class="text-end">${code}</th><th class="text-end">L10</th></tr></thead>
        <tbody>${rows.map((row, index) => samePosTableRowHtml(row, tab.stat, scoringLine, index >= SAME_POS_ROWS)).join("")}</tbody>
      </table>
    </div>`;
  updateSamePosToggle(rows.length);
}

// Download (or reuse) one team's data, then draw. A newer pick wins if the user switches teams while it loads.
async function showSamePositionTeam(team) {
  samePosState.opponent = team;
  samePosState.status = "loading";
  samePosState.data = null;
  renderSamePositionCard();
  if (!samePosState.group) return;
  try {
    const data = await loadSamePositionData(team.id, samePosState.group);
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

  document.getElementById("samePosToggle").addEventListener("click", () => {
    samePosState.open = !samePosState.open;
    updateSamePosToggle(samePosState.data ? samePosState.data.rows.length : 0);
  });

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
