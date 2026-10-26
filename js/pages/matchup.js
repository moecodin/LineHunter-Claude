// LineHunter - js/pages/matchup.js
// The Matchup Analyzer page (matchup.html?player=ID&opp=TEAM_ID&vs=PLAYER_ID&stat=pts): one player against an opponent
// team and one player on it. Works the same in lines and research mode (no odds anywhere).
//
//   Setup bar        player search, opponent (default: the player's next opponent), "Matched up with" (default: the
//                    opponent's top-minutes player at the same position, or the next one when he is Out / Doubtful),
//                    stat, range (L5 / L10 / L20 / Season / H2H), All / Home / Away, and section chips (localStorage
//                    lh-mx-sections = the hidden ones). The choices stay in the address bar.
//   1. Style clash   the player's play types (share of possessions, points per possession) next to what the opponent
//                    allows on the matching shots, ranked across the 30 teams (#1 = allows the least). The API only has
//                    OFFENSIVE play-type numbers for teams, so each play type is matched with a team defense number:
//                    MX_PLAY_TYPES[].def -> MX_DEFENSE. A Favorable / Neutral / Tough pill from the weighted ranks.
//   2. Tale of the tape  both players' averages over the range and split (game logs), the chosen stat's row highlighted.
//                    H2H = games between the two teams (js/core/h2h.js).
//   3. Defender check  the opposing player's own defense: FG% allowed overall / inside 6 ft / on threes vs what those
//                    shooters normally make, rim defense (tracking), hustle, and one sentence that follows the stat.
//   4. Status & pace both injury reports, pace and defensive rating with ranks, and rest days before the next meeting.
//
// Season-level numbers use this season once the player / team has MX_MIN_GAMES games, else last season (labeled).
// Data (all through /api/bdl; season-level answers cached in sessionStorage for 1 hour):
//   /nba/v1/season_averages/playtype?type=…        the player's play types (10 requests, one per type)
//   /nba/v1/season_averages/defense?type=overall|less_than_6ft|3_pointers, /tracking?type=defense|drives, /hustle
//   /nba/v1/team_season_averages/general?type=misc|opponent|advanced, /shooting?type=5ft_range_opponent (all 30 teams)
//   /v1/players/active?team_ids[]=, /v1/player_injuries, /v1/games, /v1/stats (game logs), season_averages/general

const MX_MIN_GAMES = 5;
const MX_MIN_MINUTES = 10;           // "Matched up with" lists players averaging at least this many minutes
const MX_MAX_ROSTER = 12;
const MX_PLAY_MIN_SHARE = 0.05;      // play types under 5% of the player's possessions are left out
const MX_PLAY_ROWS = 6;
const MX_CACHE_MS = 60 * 60 * 1000;
const MX_SECTIONS_KEY = "lh-mx-sections";

const MX_STATS = [
  { code: "pts", label: "PTS", key: "pts" },
  { code: "reb", label: "REB", key: "reb" },
  { code: "ast", label: "AST", key: "ast" },
  { code: "3pm", label: "3PM", key: "fg3m" },
  { code: "pra", label: "PRA", key: "pra" },
];
const MX_RANGES = [
  { value: 5, label: "L5" }, { value: 10, label: "L10" }, { value: 20, label: "L20" },
  { value: "season", label: "Season" }, { value: "h2h", label: "H2H" },
];
const MX_SPLITS = [{ value: "all", label: "All" }, { value: "home", label: "Home" }, { value: "away", label: "Away" }];
const MX_SECTIONS = [
  { key: "style", label: "Style clash" },
  { key: "tape", label: "Tale of the tape" },
  { key: "defender", label: "Defender check" },
  { key: "status", label: "Status & pace" },
];

// Team defense numbers a play type is matched with. low = true: a lower number is the better defense.
const MX_DEFENSE = {
  fg:        { label: "FG% allowed",        pct: true, get: (t) => t.opponent.opp_fg_pct },
  rim:       { label: "rim FG% allowed",    pct: true, get: (t) => t.range["less_than_5_ft._opp_fg_pct"] },
  paint:     { label: "paint pts allowed",  pct: false, get: (t) => t.misc.opp_pts_paint },
  three:     { label: "3P% allowed",        pct: true, get: (t) => t.opponent.opp_fg3_pct },
  fastbreak: { label: "fast-break pts allowed", pct: false, get: (t) => t.misc.opp_pts_fb },
  second:    { label: "2nd-chance pts allowed", pct: false, get: (t) => t.misc.opp_pts_2nd_chance },
};
const MX_PLAY_TYPES = [
  { type: "isolation", label: "Isolation", def: "fg" },
  { type: "prballhandler", label: "P&R ball handler", def: "rim" },
  { type: "prrollman", label: "P&R roll man", def: "paint" },
  { type: "spotup", label: "Spot-up", def: "three" },
  { type: "postup", label: "Post-up", def: "paint" },
  { type: "transition", label: "Transition", def: "fastbreak" },
  { type: "cut", label: "Cuts", def: "paint" },
  { type: "offscreen", label: "Off screens", def: "three" },
  { type: "handoff", label: "Handoffs", def: "rim" },
  { type: "offrebound", label: "Putbacks", def: "second" },
];

const mxParams = new URLSearchParams(location.search);
const mx = {
  teams: [],          // the 30 teams, A-Z
  me: null,           // { id, name, last, position, team: { id, abbreviation } }
  upcoming: [],       // the player's team's games in the next 30 days (not Final)
  opp: null,          // the opponent team { id, abbreviation, full_name }
  roster: [],         // the opponent's rotation [{ id, name, last, position, group, min, injury }]
  myAvg: null,        // the player's season averages (general/base)
  pickedId: null,
  defaultId: null,
  outStarter: null,
  injuries: [],       // both teams' injury reports
  stat: MX_STATS.find((s) => s.code === mxParams.get("stat")) || MX_STATS[0],
  range: 10,
  split: "all",
  hidden: mxReadHidden(),
  logs: {},           // playerId -> { current, previous } | "loading" | "failed"
  showingCurrentSeason: true,
  h2h: null,          // "loading" | "failed" | { games, logsByPlayer }
  play: null,         // "loading" | "failed" | { season, rows }
  teamDef: null,      // "loading" | "failed" | { season, byTeam }
  defender: {},       // playerId -> "loading" | "failed" | { season, overall, inside, threes, rim, hustle }
  myDrives: null,
  token: 0,           // bumps on every player / opponent change, so late answers for an old pick are ignored
};

// ---------- Small helpers ----------

function mxEscape(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function mxNum(value) {
  return value === null || value === undefined || value === "" || Number.isNaN(Number(value)) ? null : Number(value);
}

function mxFixed(value, digits = 1) {
  return value === null || value === undefined ? "–" : Number(value).toFixed(digits);
}

function mxPct(value) {
  return value === null || value === undefined ? "–" : `${(value * 100).toFixed(1)}%`;
}

// "34:12" -> 34.2, "34.1" -> 34.1
function mxMinutes(min) {
  const [minutes, seconds] = String(min ?? "0").split(":");
  return (Number(minutes) || 0) + (Number(seconds) || 0) / 60;
}

function mxSeasonLabel(year) {
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}

// G, F or C from the FIRST listed position (like the Same Position card).
function mxPosGroup(position) {
  const first = String(position || "").trim().charAt(0).toUpperCase();
  return ["G", "F", "C"].includes(first) ? first : null;
}

// Out / Doubtful = not playing; Questionable / Day-To-Day = game-time decision.
function mxInjuryKind(injury) {
  const status = String(injury ? injury.status : "").toLowerCase();
  if (!status) return null;
  return status.includes("out") || status.includes("doubt") ? "out" : "gtd";
}

function mxStatusBadge(injury) {
  const kind = mxInjuryKind(injury);
  if (kind === "out") return `<span class="lh-ma-badge is-out">${mxEscape(injury.status.toUpperCase())}</span>`;
  if (kind === "gtd") return `<span class="lh-ma-badge is-gtd">GTD</span>`;
  return `<span class="lh-ma-badge is-ok">ACTIVE</span>`;
}

function mxShortName(player) {
  return `${String(player.first_name || "").charAt(0)}. ${player.last_name || ""}`;
}

function mxApiDate(date) {
  return date.toLocaleDateString("en-CA");
}

function mxWeekday(isoDate) {
  return new Date(`${isoDate.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function mxReadHidden() {
  try {
    const list = JSON.parse(localStorage.getItem(MX_SECTIONS_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch (error) {
    return [];
  }
}

function mxSaveHidden() {
  try {
    localStorage.setItem(MX_SECTIONS_KEY, JSON.stringify(mx.hidden));
  } catch (error) {
    // storage blocked: the choice just isn't remembered
  }
}

async function mxCached(key, load) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    if (saved && Date.now() - saved.savedAt < MX_CACHE_MS) return saved.data;
  } catch (error) {
    // unreadable cache: download again
  }
  const data = await load();
  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch (error) {
    // storage full or blocked
  }
  return data;
}

// One player's row of a season-averages category: this season with MX_MIN_GAMES games, else last season.
async function mxPlayerSeasonRow(category, type, playerId) {
  const season = currentSeasonYear();
  const url = (year) => `/api/bdl/nba/v1/season_averages/${category}?season=${year}&season_type=regular${type ? `&type=${type}` : ""}&player_ids[]=${playerId}`;
  const games = (row) => (row ? Number(row.stats.gp ?? row.stats.g ?? 0) : 0);
  const now = (await bdlGet(url(season))).data[0];
  if (games(now) >= MX_MIN_GAMES) return { season, stats: now.stats };
  const last = (await bdlGet(url(season - 1))).data[0];
  if (last) return { season: season - 1, stats: last.stats };
  return now ? { season, stats: now.stats } : null;
}

// ---------- Setup bar ----------

function mxPills(containerId, options, current, onPick) {
  const box = document.getElementById(containerId);
  box.innerHTML = options.map((option) => {
    const active = String(option.value) === String(current);
    return `<button type="button" class="btn btn-ghost${active ? " active" : ""}" data-value="${option.value}"${option.disabled ? " disabled" : ""}
      ${option.title ? `title="${mxEscape(option.title)}"` : ""} aria-pressed="${active}">${option.label}</button>`;
  }).join("");
  box.onclick = (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button || button.disabled) return;
    onPick(button.dataset.value);
  };
}

function mxRenderControls() {
  mxPills("mxStat", MX_STATS.map((s) => ({ value: s.code, label: s.label })), mx.stat.code, (code) => {
    mx.stat = MX_STATS.find((s) => s.code === code);
    mxSyncAddress();
    mxRenderControls();
    mxRenderAll();
  });
  const h2hGames = mx.h2h && typeof mx.h2h === "object" && mx.me ? h2hLogsFor(mx.h2h, mx.me.id).filter(playedInGame).length : null;
  const ranges = MX_RANGES.map((r) => (r.value === "h2h" ? {
    ...r,
    disabled: h2hGames === 0,
    title: mx.opp ? (h2hGames === 0 ? `No games against ${mx.opp.abbreviation} in the last ${H2H_SEASONS} seasons` : `Games against ${mx.opp.abbreviation}, last ${H2H_SEASONS} seasons`) : "",
  } : r));
  mxPills("mxRange", ranges, mx.range, (value) => {
    mx.range = value === "season" || value === "h2h" ? value : Number(value);
    if (mx.range === "h2h") mx.split = "all";
    mxRenderControls();
    mxRenderTape();
  });
  mxPills("mxSplit", MX_SPLITS.map((s) => ({ ...s, disabled: mx.range === "h2h" && s.value !== "all" })), mx.split, (value) => {
    mx.split = value;
    mxRenderControls();
    mxRenderTape();
  });

  const chips = document.getElementById("mxSections");
  chips.innerHTML = `<span class="lh-label me-1">Show</span>` + MX_SECTIONS.map((s) => {
    const on = !mx.hidden.includes(s.key);
    return `<button type="button" class="lh-mx-chip${on ? " is-on" : ""}" data-section="${s.key}" aria-pressed="${on}">
      <i class="bi ${on ? "bi-check2" : "bi-plus"}" aria-hidden="true"></i>${s.label}</button>`;
  }).join("");
  chips.onclick = (event) => {
    const button = event.target.closest("[data-section]");
    if (!button) return;
    const key = button.dataset.section;
    mx.hidden = mx.hidden.includes(key) ? mx.hidden.filter((k) => k !== key) : [...mx.hidden, key];
    mxSaveHidden();
    mxRenderControls();
    mxApplySections();
  };
}

function mxApplySections() {
  document.querySelectorAll("[data-mx-section]").forEach((col) => {
    col.hidden = mx.hidden.includes(col.dataset.mxSection);
  });
}

function mxSyncAddress() {
  const params = new URLSearchParams();
  if (mx.me) params.set("player", mx.me.id);
  if (mx.opp) params.set("opp", mx.opp.id);
  if (mx.pickedId) params.set("vs", mx.pickedId);
  params.set("stat", mx.stat.code);
  history.replaceState(null, "", `${location.pathname}?${params}`);
}

// The page's own player search: picking a result loads that player here (the navbar search still goes to player pages).
function mxInitSearch() {
  const input = document.getElementById("mxSearchInput");
  const results = document.getElementById("mxSearchResults");
  let timer = null;
  let token = 0;
  const note = (text) => { results.innerHTML = `<div class="lh-search-note">${mxEscape(text)}</div>`; results.hidden = false; };
  const run = async (text) => {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) { results.hidden = true; return; }
    const mine = ++token;
    try {
      const longest = words.reduce((a, b) => (b.length > a.length ? b : a));
      const json = await bdlGet(`${BDL_BASE}/players/active?search=${encodeURIComponent(longest)}&per_page=50`);
      if (mine !== token) return;
      const matches = json.data.filter((p) => words.every((word) => `${p.first_name} ${p.last_name}`.toLowerCase().includes(word))).slice(0, 8);
      if (!matches.length) { note("No players found."); return; }
      results.innerHTML = matches.map((p) => `<button type="button" class="lh-search-row lh-mx-result" data-id="${p.id}">
        <span>${mxEscape(`${p.first_name} ${p.last_name}`)}</span>
        <span class="lh-search-meta">${mxEscape([p.team && p.team.abbreviation, p.position].filter(Boolean).join(" · "))}</span></button>`).join("");
      results.hidden = false;
    } catch (error) {
      if (mine === token) note("Search is unavailable right now.");
    }
  };
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => run(input.value.trim()), 300); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { results.hidden = true; input.blur(); }
    if (event.key === "Enter") { const first = results.querySelector("[data-id]"); if (first) first.click(); }
  });
  results.addEventListener("click", (event) => {
    const row = event.target.closest("[data-id]");
    if (!row) return;
    results.hidden = true;
    input.value = "";
    mxLoadPlayer(Number(row.dataset.id), {});
  });
  document.addEventListener("click", (event) => { if (!event.target.closest("#mxSearch")) results.hidden = true; });
}

// ---------- Loading ----------

async function mxInit() {
  mxInitSearch();
  mxRenderControls();
  mxApplySections();
  try {
    const json = await bdlGet(`${BDL_BASE}/teams`);
    mx.teams = json.data.filter((team) => team.id <= 30 && team.conference).sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
  } catch (error) {
    console.warn("Teams unavailable:", error);
  }
  const playerId = Number(mxParams.get("player"));
  if (playerId) mxLoadPlayer(playerId, { opp: Number(mxParams.get("opp")) || null, vs: Number(mxParams.get("vs")) || null });
}

async function mxLoadPlayer(playerId, { opp = null, vs = null }) {
  const token = ++mx.token;
  document.getElementById("mxEmpty").hidden = true;
  document.getElementById("mxHeader").innerHTML = `<div class="text-muted small">Loading player...</div>`;
  try {
    const p = (await bdlGet(`${BDL_BASE}/players/${playerId}`)).data;
    if (token !== mx.token) return;
    mx.myDrives = null;
    mx.me = { id: p.id, name: `${p.first_name} ${p.last_name}`, last: p.last_name, position: p.position || "", team: p.team || null };
    mx.upcoming = [];
    if (mx.me.team) {
      const inAMonth = new Date();
      inAMonth.setDate(inAMonth.getDate() + 30);
      const games = await bdlGetAllPages(`${BDL_BASE}/games?team_ids[]=${mx.me.team.id}&start_date=${mxApiDate(new Date())}&end_date=${mxApiDate(inAMonth)}&per_page=100`);
      mx.upcoming = games.filter((g) => g.status !== "Final").sort((a, b) => new Date(a.datetime || a.date) - new Date(b.datetime || b.date));
    }
    if (token !== mx.token) return;
    const next = mx.upcoming[0];
    const nextOppId = next && mx.me.team ? (next.home_team.id === mx.me.team.id ? next.visitor_team.id : next.home_team.id) : null;
    const fallback = mx.teams.find((t) => !mx.me.team || t.id !== mx.me.team.id);
    const oppId = opp || nextOppId || (fallback && fallback.id);
    mxFillOppSelect(oppId);
    mxSetOpponent(oppId, vs);
  } catch (error) {
    console.warn("Player unavailable:", error);
    if (token === mx.token) document.getElementById("mxHeader").innerHTML = `<div class="text-muted small">That player could not be loaded.</div>`;
  }
}

function mxFillOppSelect(oppId) {
  const select = document.getElementById("mxOpp");
  const own = mx.me && mx.me.team ? mx.me.team.id : null;
  select.innerHTML = mx.teams.filter((t) => t.id !== own).map((t) => `<option value="${t.id}">${mxEscape(t.full_name)}</option>`).join("");
  select.value = String(oppId);
  select.disabled = false;
}

// The opponent's next meeting with the player's team (in the next 30 days), or null.
function mxMeeting() {
  if (!mx.opp) return null;
  return mx.upcoming.find((g) => g.home_team.id === mx.opp.id || g.visitor_team.id === mx.opp.id) || null;
}

async function mxSetOpponent(oppId, vs) {
  const token = ++mx.token;
  mx.opp = mx.teams.find((t) => t.id === oppId) || { id: oppId, abbreviation: "OPP", full_name: "Opponent" };
  mx.roster = [];
  mx.pickedId = null;
  mx.outStarter = null;
  mx.h2h = null;
  mx.logs = {};
  if (mx.range === "h2h") mx.range = 10;
  document.getElementById("mxGrid").hidden = false;
  mxRenderControls();
  mxRenderAll();

  // Things that only need the player and the opponent team start now.
  mxLoadStyle(token);
  mxLoadTeamDefense(token);
  if (mx.me.team) {
    mx.h2h = "loading";
    loadH2H(mx.me.team.id, mx.opp.id)
      .then((h2h) => { if (token === mx.token) mx.h2h = h2h; })
      .catch((error) => { console.warn("H2H unavailable:", error); if (token === mx.token) mx.h2h = "failed"; })
      .then(() => { if (token === mx.token) { mxRenderControls(); mxRenderTape(); } });
  }
  mxLoadRest(token);

  const vsSelect = document.getElementById("mxVs");
  vsSelect.disabled = true;
  vsSelect.innerHTML = `<option>Loading...</option>`;
  try {
    const teamIds = [mx.opp.id, mx.me.team && mx.me.team.id].filter(Boolean);
    const [rosterRows, injuries] = await Promise.all([
      bdlGetAllPages(`${BDL_BASE}/players/active?team_ids[]=${mx.opp.id}&per_page=100`),
      bdlGetAllPages(`${BDL_BASE}/player_injuries?${teamIds.map((id) => `team_ids[]=${id}`).join("&")}&per_page=100`).catch(() => []),
    ]);
    const averages = await loadSeasonAverages([mx.me.id, ...rosterRows.map((row) => row.id)]);
    if (token !== mx.token) return;
    mx.injuries = injuries;
    mx.myAvg = averages[mx.me.id] || null;
    const injuryById = {};
    injuries.forEach((item) => { injuryById[item.player.id] = item; });
    mx.roster = rosterRows
      .filter((row) => averages[row.id])
      .map((row) => ({
        id: row.id, name: `${row.first_name} ${row.last_name}`, last: row.last_name, position: row.position || "",
        group: mxPosGroup(row.position), min: mxMinutes(averages[row.id].min), injury: injuryById[row.id] || null,
      }))
      .filter((row) => row.min >= MX_MIN_MINUTES)
      .sort((a, b) => b.min - a.min)
      .slice(0, MX_MAX_ROSTER);
    if (!mx.roster.length) throw new Error("No rotation players found");

    // Default: most minutes at this player's position; if he's out, the next one at that position.
    const samePos = mx.roster.filter((row) => row.group === mxPosGroup(mx.me.position));
    const top = samePos[0] || mx.roster[0];
    if (mxInjuryKind(top.injury) === "out") {
      const backup = samePos.find((row) => mxInjuryKind(row.injury) !== "out");
      mx.outStarter = backup ? top : null;
      mx.defaultId = backup ? backup.id : top.id;
    } else {
      mx.defaultId = top.id;
    }
    mx.pickedId = vs && mx.roster.some((row) => row.id === vs) ? vs : mx.defaultId;
    vsSelect.innerHTML = mx.roster.map((row) =>
      `<option value="${row.id}">${mxEscape(row.name)}${row.position ? ` · ${mxEscape(row.position)}` : ""}${mxInjuryKind(row.injury) === "out" ? " · OUT" : ""}</option>`).join("");
    vsSelect.value = String(mx.pickedId);
    vsSelect.disabled = false;
  } catch (error) {
    console.warn("Opponent rotation unavailable:", error);
    if (token !== mx.token) return;
    vsSelect.innerHTML = `<option>Unavailable</option>`;
  }
  mxSyncAddress();
  mxRenderAll();
  mxLoadLogs(token);
  mxLoadDefender(token);
}

function mxSetPicked(playerId) {
  mx.pickedId = playerId;
  mxSyncAddress();
  mxLoadLogs(mx.token);
  mxLoadDefender(mx.token);
  mxRenderAll();
}

// Game logs for the player and the picked opponent (both seasons when this one is short).
function mxLoadLogs(token) {
  const ids = [mx.me.id, mx.pickedId].filter((id) => id && !mx.logs[id]);
  if (!ids.length) { mxRenderTape(); return; }
  ids.forEach((id) => { mx.logs[id] = "loading"; });
  loadPlayerGameLogs(ids, 20)
    .then((result) => {
      if (token !== mx.token) return;
      ids.forEach((id) => { mx.logs[id] = result.logsByPlayer[id]; });
      mx.showingCurrentSeason = result.showingCurrentSeason;
    })
    .catch((error) => { console.warn("Game logs unavailable:", error); if (token === mx.token) ids.forEach((id) => { mx.logs[id] = "failed"; }); })
    .then(() => { if (token === mx.token) mxRenderTape(); });
}

// The player's play types: probe this season with spot-ups, then all ten from whichever season has games.
function mxLoadStyle(token) {
  mx.play = "loading";
  const playerId = mx.me.id;
  mxCached(`lh-mx-play:${playerId}`, async () => {
    const season = currentSeasonYear();
    const url = (year, type) => `/api/bdl/nba/v1/season_averages/playtype?season=${year}&season_type=regular&type=${type}&player_ids[]=${playerId}`;
    const probe = (await bdlGet(url(season, "spotup"))).data[0];
    const year = probe && Number(probe.stats.gp) >= MX_MIN_GAMES ? season : season - 1;
    const rows = await Promise.all(MX_PLAY_TYPES.map((pt) => bdlGet(url(year, pt.type))
      .then((json) => (json.data[0] ? { type: pt.type, ...json.data[0].stats } : null))
      .catch(() => null)));
    return { season: year, rows: rows.filter(Boolean) };
  })
    .then((data) => { if (token === mx.token) mx.play = data; })
    .catch((error) => { console.warn("Play types unavailable:", error); if (token === mx.token) mx.play = "failed"; })
    .then(() => { if (token === mx.token) mxRenderStyle(); });
}

// All 30 teams' defense numbers: misc (paint / fast-break / 2nd-chance points allowed), opponent (FG% / 3P% allowed),
// advanced (pace, defensive rating) and opponent shooting by 5-foot range (rim). This season once teams have games, else last.
function mxLoadTeamDefense(token) {
  if (mx.teamDef === "loading") return; // the running download redraws both cards when it lands
  if (mx.teamDef && typeof mx.teamDef === "object") { mxRenderStyle(); mxRenderStatus(); return; }
  mx.teamDef = "loading";
  const load = async () => {
    const season = currentSeasonYear();
    const get = (year, path) => bdlGetAllPages(`/api/bdl/nba/v1/team_season_averages/${path}&season=${year}&season_type=regular&per_page=100`);
    let year = season;
    let advanced = await get(season, "general?type=advanced");
    const played = advanced.length ? Math.min(...advanced.map((row) => Number(row.stats.gp) || 0)) : 0;
    if (played < MX_MIN_GAMES) { year = season - 1; advanced = await get(year, "general?type=advanced"); }
    const [misc, opponent, range] = await Promise.all([
      get(year, "general?type=misc"), get(year, "general?type=opponent"), get(year, "shooting?type=5ft_range_opponent"),
    ]);
    const byTeam = {};
    const add = (rows, part) => rows.forEach((row) => {
      byTeam[row.team.id] = byTeam[row.team.id] || { advanced: {}, misc: {}, opponent: {}, range: {} };
      byTeam[row.team.id][part] = row.stats;
    });
    add(advanced, "advanced"); add(misc, "misc"); add(opponent, "opponent"); add(range, "range");
    return { season: year, byTeam };
  };
  mxCached(`lh-mx-teamdef:${currentSeasonYear()}`, load)
    .then((data) => { mx.teamDef = data; })
    .catch((error) => { console.warn("Team defense unavailable:", error); mx.teamDef = "failed"; })
    .then(() => { mxRenderStyle(); mxRenderStatus(); });
}

// The picked player's own defense numbers, plus the player's drives (for the sentence).
function mxLoadDefender(token) {
  const id = mx.pickedId;
  if (!id) { mxRenderDefender(); return; }
  if (mx.myDrives === null) {
    mx.myDrives = "loading";
    mxPlayerSeasonRow("tracking", "drives", mx.me.id)
      .then((row) => { mx.myDrives = row ? row.stats : "failed"; })
      .catch(() => { mx.myDrives = "failed"; })
      .then(() => { if (token === mx.token) mxRenderDefender(); });
  }
  if (mx.defender[id]) { mxRenderDefender(); return; }
  mx.defender[id] = "loading";
  mxCached(`lh-mx-def:${id}`, async () => {
    const overall = await mxPlayerSeasonRow("defense", "overall", id);
    if (!overall) return null;
    // Every other category uses the same season as the overall numbers.
    const row = (category, type) => bdlGet(`/api/bdl/nba/v1/season_averages/${category}?season=${overall.season}&season_type=regular${type ? `&type=${type}` : ""}&player_ids[]=${id}`)
      .then((json) => (json.data[0] ? json.data[0].stats : null)).catch(() => null);
    const [inside, threes, rim, hustle] = await Promise.all([
      row("defense", "less_than_6ft"), row("defense", "3_pointers"), row("tracking", "defense"), row("hustle", null),
    ]);
    return { season: overall.season, overall: overall.stats, inside, threes, rim, hustle };
  })
    .then((data) => { mx.defender[id] = data || "failed"; })
    .catch((error) => { console.warn("Defender numbers unavailable:", error); mx.defender[id] = "failed"; })
    .then(() => { if (token === mx.token) mxRenderDefender(); });
}

// Rest days before the next meeting: each team's last game in the 5 days before it.
function mxLoadRest(token) {
  mx.rest = null;
  const game = mxMeeting();
  if (!game) { mxRenderStatus(); return; }
  mx.rest = "loading";
  const day = game.date.slice(0, 10);
  const from = new Date(`${day}T12:00:00`);
  from.setDate(from.getDate() - 5);
  const before = new Date(`${day}T12:00:00`);
  before.setDate(before.getDate() - 1);
  const ids = [game.home_team.id, game.visitor_team.id];
  bdlGetAllPages(`${BDL_BASE}/games?${ids.map((id) => `team_ids[]=${id}`).join("&")}&start_date=${mxApiDate(from)}&end_date=${mxApiDate(before)}&per_page=100`)
    .then((games) => {
      if (token !== mx.token) return;
      const rest = {};
      ids.forEach((id) => {
        const last = games.filter((g) => g.home_team.id === id || g.visitor_team.id === id).map((g) => g.date.slice(0, 10)).sort().pop();
        rest[id] = last ? Math.round((new Date(`${day}T12:00:00`) - new Date(`${last}T12:00:00`)) / 86400000) - 1 : null; // null = 5+ days
      });
      mx.rest = rest;
    })
    .catch(() => { if (token === mx.token) mx.rest = "failed"; })
    .then(() => { if (token === mx.token) mxRenderStatus(); });
}

// ---------- Drawing ----------

function mxPicked() {
  return mx.roster.find((row) => row.id === mx.pickedId) || null;
}

function mxBadge(abbreviation) {
  const mine = mx.me && mx.me.team ? mx.me.team.abbreviation : undefined;
  return teamBadgeHtml(abbreviation, mine, mx.opp ? mx.opp.abbreviation : undefined);
}

function mxMessage(id, text) {
  const body = document.getElementById(id);
  body.className = "text-muted small py-4 text-center";
  body.textContent = text;
}

// The rank chip: #1 = the best defense (allows the least). Soft defenses (#21-30) use the over color, tough ones (#1-10) under.
function mxRankChip(rank, title) {
  const tone = rank >= 21 ? "is-over" : rank <= 10 ? "is-under" : "";
  return `<span class="lh-zm-rank ${tone}" title="${mxEscape(title)}">#${rank}</span>`;
}

function mxRank(byTeam, teamId, get, lowIsBest = true) {
  const values = Object.entries(byTeam).map(([id, t]) => ({ id: Number(id), value: mxNum(get(t)) })).filter((v) => v.value !== null);
  values.sort((a, b) => (lowIsBest ? a.value - b.value : b.value - a.value));
  const index = values.findIndex((v) => v.id === teamId);
  return index === -1 ? null : index + 1;
}

function mxRenderAll() {
  mxRenderHeader();
  mxRenderStyle();
  mxRenderTape();
  mxRenderDefender();
  mxRenderStatus();
}

function mxRenderHeader() {
  const box = document.getElementById("mxHeader");
  if (!mx.me) return;
  const picked = mxPicked();
  const game = mxMeeting();
  const mine = mx.me.team ? mx.me.team.abbreviation : "";
  const gameText = game
    ? `${game.home_team.id === mx.opp.id ? "@" : "vs"} ${mx.opp.abbreviation} · ${mxWeekday(game.date)}`
    : `No game vs ${mx.opp ? mx.opp.abbreviation : "this team"} in the next 30 days`;
  box.innerHTML = `<div class="lh-mx-head">
      <div class="lh-mx-headside">
        <a class="lh-mx-name" href="player.html?id=${mx.me.id}">${mxEscape(mx.me.name)}</a>
        <div class="lh-ma-meta">${mxBadge(mine)} ${mxEscape(mx.me.position)}</div>
      </div>
      <div class="lh-mx-vs"><span>vs</span><small>${mxEscape(gameText)}</small></div>
      <div class="lh-mx-headside is-right">
        ${picked ? `<a class="lh-mx-name" href="player.html?id=${picked.id}">${mxEscape(picked.name)}</a>` : `<span class="lh-mx-name">${mx.opp ? mxEscape(mx.opp.full_name) : ""}</span>`}
        <div class="lh-ma-meta">${picked && mx.outStarter && picked.id === mx.defaultId ? `<span class="lh-ma-badge is-backup">BACKUP</span> ` : ""}${picked ? mxEscape(picked.position) : ""} ${mx.opp ? mxBadge(mx.opp.abbreviation) : ""}</div>
      </div>
    </div>`;
}

// 1. Style clash
function mxRenderStyle() {
  const note = document.getElementById("mxStyleNote");
  if (!mx.me) return;
  if (mx.play === "loading" || mx.teamDef === "loading" || !mx.play || !mx.teamDef) { note.textContent = ""; mxMessage("mxStyleBody", "Loading play types..."); return; }
  if (mx.play === "failed" || mx.teamDef === "failed") { mxMessage("mxStyleBody", "Play-type data is unavailable right now."); return; }
  const team = mx.teamDef.byTeam[mx.opp.id];
  const rows = mx.play.rows
    .map((row) => ({ ...row, info: MX_PLAY_TYPES.find((pt) => pt.type === row.type), share: mxNum(row.poss_pct) || 0 }))
    .filter((row) => row.share >= MX_PLAY_MIN_SHARE)
    .sort((a, b) => b.share - a.share)
    .slice(0, MX_PLAY_ROWS);
  note.textContent = mx.play.season !== currentSeasonYear() || mx.teamDef.season !== currentSeasonYear() ? `${mxSeasonLabel(Math.min(mx.play.season, mx.teamDef.season))} season` : "";
  if (!team || !rows.length) { mxMessage("mxStyleBody", "No play-type numbers for this player yet."); return; }

  let weighted = 0;
  let weights = 0;
  const lines = rows.map((row) => {
    const def = MX_DEFENSE[row.info.def];
    const value = mxNum(def.get(team));
    const rank = mxRank(mx.teamDef.byTeam, mx.opp.id, def.get, true);
    if (rank) { weighted += row.share * (rank >= 21 ? 1 : rank <= 10 ? -1 : 0); weights += row.share; }
    row.rank = rank;
    row.def = def;
    const pctile = mxNum(row.percentile);
    return `<div class="lh-mx-play">
      <div class="lh-mx-play-name"><b>${row.info.label}</b><span>${Math.round(row.share * 100)}% of plays</span></div>
      <div class="lh-mx-play-bar" aria-hidden="true"><i style="width:${Math.min(100, row.share * 250)}%"></i></div>
      <div class="lh-mx-play-eff">${mxFixed(mxNum(row.ppp), 2)} <span>PPP${pctile !== null ? ` · ${Math.round(pctile * 100)}th pct` : ""}</span></div>
      <div class="lh-mx-play-def">${value === null ? "–" : def.pct ? mxPct(value) : mxFixed(value)} <span>${def.label}</span></div>
      ${rank ? mxRankChip(rank, `${mx.opp.abbreviation} ranks #${rank} of 30 in ${def.label} (#1 = allows the least)`) : "<span></span>"}
    </div>`;
  }).join("");

  const score = weights ? weighted / weights : 0;
  const verdict = score >= 0.2 ? { tone: "over", label: "Favorable" } : score <= -0.2 ? { tone: "under", label: "Tough" } : { tone: "neutral", label: "Neutral" };
  const top = rows[0];
  const sentence = top.rank
    ? `${mxEscape(mx.me.last)}'s top play type is ${top.info.label} (${Math.round(top.share * 100)}% of plays); ${mxEscape(mx.opp.abbreviation)} ranks #${top.rank} in ${top.def.label}.`
    : "";
  const body = document.getElementById("mxStyleBody");
  body.className = "lh-mx-style";
  body.innerHTML = `<div class="lh-zm-verdict mb-2"><span class="lh-zm-pill is-${verdict.tone}">${verdict.label}</span><span class="small">${sentence}</span></div>
    <div class="lh-mx-play is-head"><span>Play type</span><span></span><span>${mxEscape(mx.me.last)}</span><span>${mxEscape(mx.opp.abbreviation)} allows</span><span>Rank</span></div>
    ${lines}`;
}

// 2. Tale of the tape
function mxGamesFor(playerId) {
  const logs = mx.logs[playerId];
  if (!logs || typeof logs !== "object") return null;
  if (mx.range === "h2h") return mx.h2h && typeof mx.h2h === "object" ? h2hLogsFor(mx.h2h, playerId).filter(playedInGame) : null;
  const split = splitGames(logs, mx.split, null).logs;
  return pickWindowLogs(split, mx.range, mx.showingCurrentSeason);
}

function mxAverages(games) {
  if (!games || !games.length) return null;
  const avg = (key) => games.reduce((sum, log) => sum + (Number(log[key]) || 0), 0) / games.length;
  const fga = games.reduce((sum, log) => sum + (Number(log.fga) || 0), 0);
  const fgm = games.reduce((sum, log) => sum + (Number(log.fgm) || 0), 0);
  return {
    pts: avg("pts"), reb: avg("reb"), ast: avg("ast"), fg3m: avg("fg3m"),
    pra: avg("pts") + avg("reb") + avg("ast"),
    min: games.reduce((sum, log) => sum + mxMinutes(log.min), 0) / games.length,
    fg: fga ? fgm / fga : null,
    count: games.length,
  };
}

const MX_TAPE = [
  { key: "pts", label: "PTS", max: 35 }, { key: "reb", label: "REB", max: 15 }, { key: "ast", label: "AST", max: 12 },
  { key: "fg3m", label: "3PM", max: 5 }, { key: "pra", label: "PRA", max: 50 }, { key: "min", label: "MIN", max: 40 },
  { key: "fg", label: "FG%", max: 0.7, pct: true },
];

function mxRenderTape() {
  const note = document.getElementById("mxTapeNote");
  if (!mx.me) return;
  const picked = mxPicked();
  const rangeLabel = MX_RANGES.find((r) => String(r.value) === String(mx.range)).label;
  note.textContent = `${rangeLabel}${mx.range !== "h2h" && mx.split !== "all" ? ` · ${mx.split === "home" ? "Home" : "Away"}` : ""}`;
  if (!picked) { mxMessage("mxTapeBody", mx.roster.length ? "Loading..." : "Loading the rotation..."); return; }
  const states = [mx.logs[mx.me.id], mx.logs[picked.id]];
  if (states.includes("failed")) { mxMessage("mxTapeBody", "Game logs are unavailable right now."); return; }
  if (states.some((s) => !s || s === "loading") || (mx.range === "h2h" && mx.h2h === "loading")) { mxMessage("mxTapeBody", "Loading game logs..."); return; }
  const a = mxAverages(mxGamesFor(mx.me.id));
  const b = mxAverages(mxGamesFor(picked.id));
  if (!a && !b) { mxMessage("mxTapeBody", "No games in this range."); return; }

  const rows = MX_TAPE.map((row) => {
    const va = a ? a[row.key] : null;
    const vb = b ? b[row.key] : null;
    const show = (v) => (v === null || v === undefined ? "–" : (row.pct ? v * 100 : v).toFixed(1)); // FG% as "47.2": the label says %
    const width = (v) => (v === null || v === undefined ? 0 : Math.min(100, (v / row.max) * 100));
    const aWins = va !== null && vb !== null && va > vb;
    const bWins = va !== null && vb !== null && vb > va;
    return `<div class="lh-ma-row${row.key === mx.stat.key ? " is-selected" : ""}">
      <span class="lh-ma-val${aWins ? " is-win" : ""}">${show(va)}</span>
      <span class="lh-ma-bar is-left"><i class="${aWins ? "is-win" : ""}" style="width:${width(va)}%"></i></span>
      <span class="lh-ma-label">${row.label}</span>
      <span class="lh-ma-bar"><i class="${bWins ? "is-win" : ""}" style="width:${width(vb)}%"></i></span>
      <span class="lh-ma-val is-right${bWins ? " is-win" : ""}">${show(vb)}</span>
    </div>`;
  }).join("");
  const body = document.getElementById("mxTapeBody");
  body.className = "lh-ma";
  body.innerHTML = `<div class="lh-ma-names">
      <div class="lh-ma-name"><div class="lh-ma-who">${mxEscape(mx.me.last)}</div><div class="lh-ma-meta">${a ? a.count : 0} games</div></div>
      <div class="lh-ma-vs">vs</div>
      <div class="lh-ma-name is-right"><div class="lh-ma-who">${mxEscape(picked.last)}</div><div class="lh-ma-meta">${b ? b.count : 0} games</div></div>
    </div>
    <div class="lh-ma-tape">${rows}</div>
    ${mx.range === "h2h" ? `<div class="lh-ma-past">${mxEscape(mx.me.last)} vs ${mxEscape(mx.opp.abbreviation)} · ${mxEscape(picked.last)} vs ${mxEscape(mx.me.team ? mx.me.team.abbreviation : "")}, last ${H2H_SEASONS} seasons</div>` : ""}`;
}

// 3. Defender check
function mxDiffChip(value, normal) {
  if (value === null || normal === null) return `<span class="lh-mx-diff">–</span>`;
  const diff = (value - normal) * 100;
  const tone = diff >= 1.5 ? "is-over" : diff <= -1.5 ? "is-under" : "";
  return `<span class="lh-mx-diff ${tone}" title="Shooters make ${mxPct(value)} when guarded by this player, ${mxPct(normal)} normally">${diff > 0 ? "+" : diff < 0 ? "−" : ""}${Math.abs(diff).toFixed(1)}</span>`;
}

function mxTile(value, label) {
  return `<div class="lh-mx-tile"><b>${value}</b><span>${label}</span></div>`;
}

function mxDefenderSentence(picked, d) {
  const me = mxEscape(mx.me.last);
  const them = mxEscape(picked.last);
  const drives = mx.myDrives && typeof mx.myDrives === "object" ? mxNum(mx.myDrives.drives) : null;
  const avg = mx.myAvg || {};
  if (mx.stat.key === "fg3m" && d.threes) {
    return `${me} takes ${mxFixed(mxNum(avg.fg3a))} threes a game; shooters hit ${mxPct(mxNum(d.threes.fg3_pct))} from three against ${them} (${mxPct(mxNum(d.threes.ns_fg3_pct))} normally).`;
  }
  if (mx.stat.key === "reb" && d.hustle) {
    return `${them} averages ${mxFixed(mxNum(d.hustle.box_outs))} box outs and ${mxFixed(mxNum(d.rim ? d.rim.dreb : null))} defensive rebounds a game.`;
  }
  if (mx.stat.key === "ast" && d.hustle) {
    return `${them} gets ${mxFixed(mxNum(d.hustle.deflections))} deflections a game; ${me} averages ${mxFixed(mxNum(avg.ast))} assists.`;
  }
  if (drives !== null && drives >= 5 && d.rim) {
    return `${me} drives ${mxFixed(drives)} times a game; ${them} defends ${mxFixed(mxNum(d.rim.def_rim_fga))} shots at the rim a game, allowing ${mxPct(mxNum(d.rim.def_rim_fg_pct))}.`;
  }
  return `Shooters make ${mxPct(mxNum(d.overall.d_fg_pct))} against ${them}, ${mxPct(mxNum(d.overall.normal_fg_pct))} normally.`;
}

function mxRenderDefender() {
  const note = document.getElementById("mxDefNote");
  if (!mx.me) return;
  const picked = mxPicked();
  note.textContent = "";
  if (!picked) { mxMessage("mxDefBody", "Loading the rotation..."); return; }
  const d = mx.defender[picked.id];
  if (!d || d === "loading") { mxMessage("mxDefBody", "Loading defense numbers..."); return; }
  if (d === "failed") { mxMessage("mxDefBody", `No defense numbers for ${picked.name} yet.`); return; }
  note.textContent = `vs every shooter guarded${d.season !== currentSeasonYear() ? ` · ${mxSeasonLabel(d.season)}` : ""}`;

  const row = (label, volume, value, normal) => `<div class="lh-mx-allowed">
      <span class="lh-mx-allowed-label"><b>${label}</b><span>${volume}</span></span>
      <span class="lh-mx-allowed-val">${mxPct(value)} <span>vs ${mxPct(normal)}</span></span>
      ${mxDiffChip(value, normal)}
    </div>`;
  const o = d.overall;
  const allowed = [
    row("Overall", `${mxFixed(mxNum(o.d_fga))} FGA / game`, mxNum(o.d_fg_pct), mxNum(o.normal_fg_pct)),
    d.inside ? row("Inside 6 ft", `${mxFixed(mxNum(d.inside.fga_lt_06))} FGA / game`, mxNum(d.inside.lt_06_pct), mxNum(d.inside.ns_lt_06_pct)) : "",
    d.threes ? row("Threes", `${mxFixed(mxNum(d.threes.fg3a))} 3PA / game`, mxNum(d.threes.fg3_pct), mxNum(d.threes.ns_fg3_pct)) : "",
  ].join("");
  const rim = d.rim || {};
  const hustle = d.hustle || {};
  const body = document.getElementById("mxDefBody");
  body.className = "lh-mx-def";
  body.innerHTML = `
    <div class="lh-ma-flag">${mxStatusBadge(picked.injury)}<span><b>${mxEscape(picked.name)}</b> · ${mxEscape(picked.position)} · ${picked.min.toFixed(1)} min</span></div>
    <div>
      <div class="lh-ma-sec"><span>FG% allowed</span><span>vs normal</span></div>
      ${allowed}
    </div>
    <div>
      <div class="lh-ma-sec"><span>Rim protection</span><span>per game</span></div>
      <div class="lh-mx-tiles">
        ${mxTile(mxFixed(mxNum(rim.def_rim_fga)), "Rim FGA faced")}
        ${mxTile(mxPct(mxNum(rim.def_rim_fg_pct)), "Rim FG% allowed")}
        ${mxTile(mxFixed(mxNum(rim.blk)), "BLK")}
        ${mxTile(mxFixed(mxNum(rim.stl)), "STL")}
      </div>
    </div>
    <div>
      <div class="lh-ma-sec"><span>Hustle</span><span>per game</span></div>
      <div class="lh-mx-tiles">
        ${mxTile(mxFixed(mxNum(hustle.deflections)), "Deflections")}
        ${mxTile(mxFixed(mxNum(hustle.contested_shots)), "Contests")}
        ${mxTile(mxFixed(mxNum(hustle.box_outs)), "Box outs")}
        ${mxTile(mxFixed(mxNum(hustle.charges_drawn), 2), "Charges")}
      </div>
    </div>
    <div class="lh-ma-insight">${mxDefenderSentence(picked, d)}</div>`;
}

// 4. Status & pace
function mxInjuryList(teamId, skipIds) {
  const list = mx.injuries.filter((item) => item.player && item.player.team_id === teamId && !skipIds.includes(item.player.id) && mxInjuryKind(item));
  if (!list.length) return `<span class="text-muted">None listed</span>`;
  return list.slice(0, 5).map((item) => `<span class="lh-mx-inj">${mxEscape(mxShortName(item.player))} <span class="${mxInjuryKind(item) === "out" ? "is-out" : "is-gtd"}">${mxEscape(item.status)}</span></span>`).join("")
    + (list.length > 5 ? `<span class="text-muted">+${list.length - 5} more</span>` : "");
}

function mxRenderStatus() {
  const note = document.getElementById("mxStatusNote");
  if (!mx.me || !mx.opp) return;
  const picked = mxPicked();
  const myTeam = mx.me.team;
  const meInjury = mx.injuries.find((item) => item.player && item.player.id === mx.me.id) || null;
  const parts = [];

  // Players
  parts.push(`<div>
    <div class="lh-ma-sec"><span>Players</span><span></span></div>
    <div class="lh-mx-status-row">${mxStatusBadge(meInjury)}<span><b>${mxEscape(mx.me.name)}</b></span></div>
    ${picked ? `<div class="lh-mx-status-row">${mxStatusBadge(picked.injury)}<span><b>${mxEscape(picked.name)}</b>${mx.outStarter && picked.id === mx.defaultId ? ` · starts for ${mxEscape(mx.outStarter.name)} (out)` : ""}</span></div>` : ""}
  </div>`);

  // Injury reports
  const skip = [mx.me.id, mx.pickedId].filter(Boolean);
  parts.push(`<div>
    <div class="lh-ma-sec"><span>Injury report</span><span></span></div>
    ${myTeam ? `<div class="lh-mx-injrow">${mxBadge(myTeam.abbreviation)}<div>${mxInjuryList(myTeam.id, skip)}</div></div>` : ""}
    <div class="lh-mx-injrow">${mxBadge(mx.opp.abbreviation)}<div>${mxInjuryList(mx.opp.id, skip)}</div></div>
  </div>`);

  // Pace and defense
  if (mx.teamDef && typeof mx.teamDef === "object") {
    const by = mx.teamDef.byTeam;
    const teams = [myTeam && myTeam.id, mx.opp.id].filter(Boolean);
    const paceOf = (id) => mxNum(by[id] && by[id].advanced.pace);
    const leaguePace = Object.values(by).map((t) => mxNum(t.advanced.pace)).filter((v) => v !== null);
    const league = leaguePace.reduce((s, v) => s + v, 0) / (leaguePace.length || 1);
    const both = teams.map(paceOf).filter((v) => v !== null);
    const expected = both.length ? both.reduce((s, v) => s + v, 0) / both.length : null;
    const tempo = expected === null ? "" : expected >= league + 1 ? "faster than average" : expected <= league - 1 ? "slower than average" : "about average";
    const statRow = (label, get, lowIsBest) => `<div class="lh-mx-pace">
        <span class="lh-mx-pace-label">${label}</span>
        ${teams.map((id) => {
          const team = mx.teams.find((t) => t.id === id) || {};
          const rank = mxRank(by, id, get, lowIsBest);
          return `<span class="lh-mx-pace-team">${mxBadge(team.abbreviation)} <b>${mxFixed(mxNum(by[id] ? get(by[id]) : null))}</b> ${rank ? `<span class="lh-mx-rank">#${rank}</span>` : ""}</span>`;
        }).join("")}
      </div>`;
    note.textContent = mx.teamDef.season !== currentSeasonYear() ? `${mxSeasonLabel(mx.teamDef.season)} season` : "";
    parts.push(`<div>
      <div class="lh-ma-sec"><span>Pace &amp; defense</span><span>rank of 30</span></div>
      ${statRow("Pace", (t) => t.advanced.pace, false)}
      ${statRow("Def rating", (t) => t.advanced.def_rating, true)}
      ${expected !== null ? `<div class="lh-ma-insight mt-2">Expected tempo: about ${expected.toFixed(1)} possessions, ${tempo} (league ${league.toFixed(1)}).</div>` : ""}
    </div>`);
  } else if (mx.teamDef === "loading") {
    parts.push(`<div class="text-muted small">Loading pace...</div>`);
  }

  // Rest
  const game = mxMeeting();
  let restHtml = `<span class="text-muted">No game vs ${mxEscape(mx.opp.abbreviation)} in the next 30 days.</span>`;
  if (game) {
    if (mx.rest === "loading" || !mx.rest) restHtml = `<span class="text-muted">Loading...</span>`;
    else if (mx.rest === "failed") restHtml = `<span class="text-muted">Unavailable</span>`;
    else {
      restHtml = [game.visitor_team, game.home_team].map((team) => {
        const days = mx.rest[team.id];
        const text = days === null ? "5+ days" : days === 0 ? "0 days" : `${days} day${days === 1 ? "" : "s"}`;
        return `<span class="lh-mx-rest">${mxBadge(team.abbreviation)} ${text}${days === 0 ? ` <span class="lh-ma-badge is-gtd">B2B</span>` : ""}</span>`;
      }).join("");
    }
  }
  parts.push(`<div>
    <div class="lh-ma-sec"><span>Rest</span><span>${game ? mxEscape(mxWeekday(game.date)) : ""}</span></div>
    <div class="lh-mx-restrow">${restHtml}</div>
  </div>`);

  const body = document.getElementById("mxStatusBody");
  body.className = "lh-mx-status";
  body.innerHTML = parts.join("");
}

// ---------- Events ----------

document.getElementById("mxOpp").addEventListener("change", (event) => {
  if (!mx.me) return;
  mxSetOpponent(Number(event.target.value), null);
});
document.getElementById("mxVs").addEventListener("change", (event) => {
  mxSetPicked(Number(event.target.value));
});

mxInit();
