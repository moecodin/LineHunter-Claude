// LineHunter - js/components/matchupAnalysis.js
// The "Matchup Analysis" card on player.html (half width, right of Same Position; under it on tablets and phones):
// this player next to one player on the next opponent, by default the opponent's top-minutes player at the same position.
// A "Compare with" dropdown lists the opponent's rotation (10+ minutes a game), so any of them can be picked.
//
//   Status flag     the picked player's injury status. When the default same-position player is Out / Doubtful, the card
//                   starts on the next one at that position instead and says who is out and who likely starts.
//   Tale of the tape  season averages side by side (PTS, REB, AST, BLK, MIN, USG%), the bigger number bright,
//                   the selected prop tab's row highlighted.
//   Battle          follows the prop tab: REB / PRA = rebound chances, PTS = shots (FGA), AST = passes, 3PM = 3PA,
//                   with one rule-picked sentence (more than 15% apart = "more" / "less", else "even").
//   Past meetings   this player's averages in the H2H games where both played (js/core/h2h.js, last 5 seasons).
//
// Positions go by the FIRST listed position, like the Same Position card (samePosGroup in js/components/samePosition.js).
// Data:
//   GET /v1/players/active?team_ids[]=OPP                       -> the opponent's roster and positions
//   /nba/v1/season_averages/general (loadSeasonAverages)        -> season numbers for this player + the roster, one request
//   GET /v1/player_injuries?team_ids[]=OPP                      -> the opponent's injury report
//   GET /nba/v2/stats/advanced?player_ids[]=ID&seasons[]=…      -> usage, passes, rebound chances (per game, averaged here),
//                                                                  only for this player and the picked player
// Advanced averages are cached in sessionStorage (lh-matchup-adv:ID:SEASON, 10 minutes).

const MATCHUP_MIN_MINUTES = 10;   // the dropdown lists players who average at least this many minutes
const MATCHUP_MAX_PLAYERS = 10;
const MATCHUP_GAP = 0.15;         // more than 15% apart = one side clearly has more
const MATCHUP_CACHE_MS = 10 * 60 * 1000;
const MATCHUP_POS_WORDS = { G: "guard", F: "forward", C: "center" };

const MATCHUP_TAPE = [
  { key: "pts", label: "PTS", max: 32 },
  { key: "reb", label: "REB", max: 14 },
  { key: "ast", label: "AST", max: 10 },
  { key: "blk", label: "BLK", max: 3 },
  { key: "min", label: "MIN", max: 40 },
  { key: "usage", label: "USG%", max: 35 },
];

// The highlighted tape rows per prop tab.
const MATCHUP_TAPE_ROWS = {
  points: ["pts"], rebounds: ["reb"], assists: ["ast"], threes: [], points_rebounds_assists: ["pts", "reb", "ast"],
};

// The battle section per prop tab. {o} = the other player's last name, {p} = this player's.
const MATCHUP_BATTLES = {
  rebounds: {
    title: "Glass battle", unit: "rebound chances / game", key: "rebChances",
    legend: (s) => (s.rebChances ? `grabs ${Math.round((s.reb / s.rebChances) * 100)}%` : ""),
    more: "{o} gets more rebound chances, so {p}'s boards may be harder to come by.",
    less: "{p} sees more rebound chances than {o}, which could open up more boards.",
    even: "Both see about the same number of rebound chances.",
  },
  points: {
    title: "Shot volume", unit: "shots / game", key: "fga",
    legend: (s) => (s.usage !== null ? `${s.usage.toFixed(1)}% usage` : ""),
    more: "{o} takes more shots and carries more of the scoring load.",
    less: "{p} takes more shots than {o} and carries more of the scoring load.",
    even: "Both take about the same number of shots each game.",
  },
  assists: {
    title: "Playmaking", unit: "passes / game", key: "passes",
    legend: (s) => `${s.ast.toFixed(1)} ast`,
    more: "{o} handles the ball more, with more passes each game.",
    less: "{p} moves the ball more than {o}.",
    even: "Both make about the same number of passes each game.",
  },
  threes: {
    title: "Three-point volume", unit: "3PA / game", key: "fg3a",
    legend: (s) => (s.fg3a >= 1 ? `${(s.fg3Pct * 100).toFixed(1)}% 3P` : "rarely shoots 3s"),
    more: "{o} takes more threes than {p}.",
    less: "{p} takes more threes than {o}.",
    even: "Both take about the same number of threes each game.",
  },
};
MATCHUP_BATTLES.points_rebounds_assists = MATCHUP_BATTLES.rebounds;

const matchupState = {
  me: null,          // { id, name, last, position, team }
  opponent: null,    // { id, abbreviation }
  ownTeamId: null,
  status: "loading", // "loading", "ready", "failed", "none" (no upcoming game)
  roster: [],        // the opponent's rotation: [{ id, name, last, position, group, stats, injury }], most minutes first
  myStats: null,
  defaultId: null,
  outStarter: null,  // the same-position player who is out, when the default moved past him
  pickedId: null,
  advanced: {},      // playerId -> { usage, passes, rebChances } or "loading" / "failed"
  h2h: null,         // the H2H download, or null while loading / unavailable
  propType: "points",
};

function matchupEscape(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function matchupNumber(value) {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? null : Number(value);
}

// Base season numbers in one shape. min can come as "34.1" or "34:06".
function matchupBaseStats(row) {
  const [minutes, seconds] = String(row.min ?? "0").split(":");
  return {
    season: row.season,
    fromLastSeason: row.fromLastSeason,
    pts: Number(row.pts) || 0,
    reb: Number(row.reb) || 0,
    ast: Number(row.ast) || 0,
    blk: Number(row.blk) || 0,
    min: (Number(minutes) || 0) + (Number(seconds) || 0) / 60,
    fga: Number(row.fga) || 0,
    fg3a: Number(row.fg3a) || 0,
    fg3Pct: Number(row.fg3_pct) || 0,
  };
}

// Out / Doubtful = not playing. Questionable / Day-To-Day = game-time decision.
function matchupInjuryKind(injury) {
  const status = String(injury ? injury.status : "").toLowerCase();
  if (!status) return null;
  if (status.includes("out") || status.includes("doubt")) return "out";
  return "gtd";
}

// Season averages of usage, passes and rebound chances from the per-game advanced stats.
async function loadMatchupAdvanced(playerId, season) {
  const key = `lh-matchup-adv:${playerId}:${season}`;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    if (saved && Date.now() - saved.savedAt < MATCHUP_CACHE_MS) return saved.data;
  } catch (error) {
    // unreadable cache: download again
  }
  const rows = await bdlGetAllPages(`/api/bdl/nba/v2/stats/advanced?player_ids[]=${playerId}&seasons[]=${season}&period=0&per_page=100`);
  const average = (values) => {
    const list = values.filter((value) => value !== null);
    return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null;
  };
  const usage = rows.map((row) => matchupNumber(row.usage_percentage));
  const scale = Math.max(0, ...usage.map((value) => value ?? 0)) <= 1.5 ? 100 : 1; // 0.284 or 28.4
  const usageAvg = average(usage);
  const data = {
    usage: usageAvg === null ? null : usageAvg * scale,
    passes: average(rows.map((row) => matchupNumber(row.passes))),
    rebChances: average(rows.map((row) => matchupNumber(row.rebound_chances_total) ??
      (matchupNumber(row.rebound_chances_offensive) !== null && matchupNumber(row.rebound_chances_defensive) !== null
        ? matchupNumber(row.rebound_chances_offensive) + matchupNumber(row.rebound_chances_defensive) : null))),
  };
  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch (error) {
    // storage full or blocked: it just downloads again next time
  }
  return data;
}

function ensureMatchupAdvanced(playerId, season) {
  if (matchupState.advanced[playerId]) return;
  matchupState.advanced[playerId] = "loading";
  loadMatchupAdvanced(playerId, season)
    .then((data) => { matchupState.advanced[playerId] = data; })
    .catch((error) => { console.warn("Matchup advanced stats unavailable:", error); matchupState.advanced[playerId] = "failed"; })
    .then(renderMatchupCard);
}

// ---------- Loading ----------

// Called once by js/pages/player.js. opponent = { id, abbreviation, away, home } of the next game (away / home = the two
// abbreviations, for the badge colors), or null.
async function loadMatchupAnalysis({ me, opponent, ownTeamId }) {
  matchupState.me = me;
  matchupState.opponent = opponent;
  matchupState.ownTeamId = ownTeamId;
  if (!opponent) { matchupState.status = "none"; renderMatchupCard(); return; }
  renderMatchupCard();

  try {
    const [rosterRows, injuries] = await Promise.all([
      bdlGetAllPages(`${BDL_BASE}/players/active?team_ids[]=${opponent.id}&per_page=100`),
      bdlGetAllPages(`${BDL_BASE}/player_injuries?team_ids[]=${opponent.id}&per_page=100`).catch(() => []),
    ]);
    const averages = await loadSeasonAverages([me.id, ...rosterRows.map((row) => row.id)]);
    if (!averages[me.id]) throw new Error("No season averages for this player");
    matchupState.myStats = matchupBaseStats(averages[me.id]);

    const injuryById = {};
    injuries.forEach((item) => { injuryById[item.player.id] = item; });
    matchupState.roster = rosterRows
      .filter((row) => averages[row.id])
      .map((row) => ({
        id: row.id,
        name: `${row.first_name} ${row.last_name}`,
        last: row.last_name,
        position: row.position || "",
        group: samePosGroup(row.position),
        stats: matchupBaseStats(averages[row.id]),
        injury: injuryById[row.id] || null,
      }))
      .filter((row) => row.stats.min >= MATCHUP_MIN_MINUTES)
      .sort((a, b) => b.stats.min - a.stats.min)
      .slice(0, MATCHUP_MAX_PLAYERS);
    if (matchupState.roster.length === 0) throw new Error("No rotation players found");

    // Default: the most minutes at this player's position. If he's out, the next one at that position likely starts.
    const group = samePosGroup(me.position);
    const samePos = matchupState.roster.filter((row) => row.group === group);
    const top = samePos[0] || null;
    if (top && matchupInjuryKind(top.injury) === "out") {
      const backup = samePos.find((row) => matchupInjuryKind(row.injury) !== "out");
      matchupState.outStarter = backup ? top : null;
      matchupState.defaultId = backup ? backup.id : top.id;
    } else {
      matchupState.defaultId = (top || matchupState.roster[0]).id;
    }
    matchupState.pickedId = matchupState.defaultId;
    matchupState.status = "ready";

    ensureMatchupAdvanced(me.id, matchupState.myStats.season);
    const picked = matchupPicked();
    ensureMatchupAdvanced(picked.id, picked.stats.season);
    if (ownTeamId) {
      loadH2H(ownTeamId, opponent.id).then((h2h) => { matchupState.h2h = h2h; renderMatchupCard(); })
        .catch((error) => console.warn("Matchup past meetings unavailable:", error));
    }
  } catch (error) {
    console.warn("Matchup Analysis unavailable:", error);
    matchupState.status = "failed";
  }
  renderMatchupCard();
}

function matchupPicked() {
  return matchupState.roster.find((row) => row.id === matchupState.pickedId) || null;
}

// renderProps in js/pages/player.js calls this when the prop tab changes.
function renderMatchupAnalysis(propType) {
  matchupState.propType = propType;
  renderMatchupCard();
}

// ---------- Drawing ----------

function matchupText(message) {
  const body = document.getElementById("matchupBody");
  body.className = `text-muted small py-4 text-center${body.classList.contains("lh-cc-part") ? " lh-cc-part" : ""}`; // keep the collapse toggle's class (cardCollapse.js)
  body.textContent = message;
}

function matchupFlagHtml(picked) {
  const kind = matchupInjuryKind(picked.injury);
  if (kind === "out") {
    return `<div class="lh-ma-flag is-out"><span class="lh-ma-badge is-out">${matchupEscape(picked.injury.status.toUpperCase())}</span>
      <span><b>${matchupEscape(picked.name)}</b> is listed ${matchupEscape(picked.injury.status.toLowerCase())}.</span></div>`;
  }
  if (kind === "gtd") {
    return `<div class="lh-ma-flag is-gtd"><span class="lh-ma-badge is-gtd">GTD</span>
      <span><b>${matchupEscape(picked.name)}</b> is ${matchupEscape(picked.injury.status.toLowerCase())}.</span></div>`;
  }
  const out = matchupState.outStarter;
  if (out && picked.id === matchupState.defaultId) {
    const word = MATCHUP_POS_WORDS[out.group] || "that spot";
    return `<div class="lh-ma-flag is-out"><span class="lh-ma-badge is-out">OUT</span>
      <span><b>${matchupEscape(out.name)}</b> is out. <b>${matchupEscape(picked.name)}</b> likely starts at ${word}.</span></div>`;
  }
  return `<div class="lh-ma-flag"><span class="lh-ma-badge is-ok">ACTIVE</span><span>Not on the injury report.</span></div>`;
}

function matchupTapeHtml(mine, theirs) {
  const selected = MATCHUP_TAPE_ROWS[matchupState.propType] || [];
  return MATCHUP_TAPE.map((row) => {
    const a = mine[row.key];
    const b = theirs[row.key];
    const show = (value) => (value === null || value === undefined ? "–" : value.toFixed(1));
    const width = (value) => (value === null || value === undefined ? 0 : Math.min(100, (value / row.max) * 100));
    const aWins = a !== null && b !== null && a > b;
    const bWins = a !== null && b !== null && b > a;
    return `<div class="lh-ma-row${selected.includes(row.key) ? " is-selected" : ""}">
      <span class="lh-ma-val${aWins ? " is-win" : ""}">${show(a)}</span>
      <span class="lh-ma-bar is-left"><i class="${aWins ? "is-win" : ""}" style="width:${width(a)}%"></i></span>
      <span class="lh-ma-label">${row.label}</span>
      <span class="lh-ma-bar"><i class="${bWins ? "is-win" : ""}" style="width:${width(b)}%"></i></span>
      <span class="lh-ma-val is-right${bWins ? " is-win" : ""}">${show(b)}</span>
    </div>`;
  }).join("");
}

function matchupBattleHtml(mine, theirs, myLast, theirLast) {
  const battle = MATCHUP_BATTLES[matchupState.propType] || MATCHUP_BATTLES.points;
  const a = mine[battle.key];
  const b = theirs[battle.key];
  const head = `<div class="lh-ma-sec"><span>${battle.title}</span><span>${battle.unit}</span></div>`;
  if (a === null || a === undefined || b === null || b === undefined) {
    const loading = [mine.adv, theirs.adv].includes("loading");
    return `${head}<div class="text-muted small">${loading ? "Loading..." : "Not available for this pair."}</div>`;
  }
  const sentence = b > a * (1 + MATCHUP_GAP) ? battle.more : a > b * (1 + MATCHUP_GAP) ? battle.less : battle.even;
  return `${head}
    <div class="lh-ma-split" role="img" aria-label="${battle.title}: ${matchupEscape(myLast)} ${a.toFixed(1)}, ${matchupEscape(theirLast)} ${b.toFixed(1)}">
      <div class="is-mine" style="flex:${Math.max(a, 0.5)}">${a.toFixed(1)}</div>
      <div class="is-theirs" style="flex:${Math.max(b, 0.5)}">${b.toFixed(1)}</div>
    </div>
    <div class="lh-ma-legend"><span><b>${matchupEscape(myLast)}</b> ${battle.legend(mine)}</span><span>${battle.legend(theirs)} <b>${matchupEscape(theirLast)}</b></span></div>
    <div class="lh-ma-insight">${sentence.replace(/\{o\}/g, matchupEscape(theirLast)).replace(/\{p\}/g, matchupEscape(myLast))}</div>`;
}

// This player's averages in the H2H games where the picked player also played.
function matchupPastHtml(picked, myLast) {
  if (!matchupState.h2h) return "";
  const theirGames = new Set(h2hLogsFor(matchupState.h2h, picked.id).filter(playedInGame).map((log) => log.game.id));
  const games = h2hLogsFor(matchupState.h2h, matchupState.me.id).filter((log) => playedInGame(log) && theirGames.has(log.game.id));
  if (games.length === 0) return `<div class="lh-ma-past">No past meetings with ${matchupEscape(picked.last)} in the last ${H2H_SEASONS} seasons.</div>`;
  const avg = (key) => (games.reduce((sum, log) => sum + (Number(log[key]) || 0), 0) / games.length).toFixed(1);
  const first = Math.min(...games.map((log) => log.game.season));
  const since = `${first}-${String((first + 1) % 100).padStart(2, "0")}`;
  return `<div class="lh-ma-past"><b>Past meetings:</b> ${games.length} game${games.length === 1 ? "" : "s"} vs ${matchupEscape(picked.last)} since ${since} ·
    ${matchupEscape(myLast)} averaged ${avg("pts")} PTS · ${avg("reb")} REB · ${avg("blk")} BLK</div>`;
}

function renderMatchupCard() {
  const body = document.getElementById("matchupBody");
  if (!body) return;
  const select = document.getElementById("matchupPick");
  const opp = matchupState.opponent;
  document.getElementById("matchupSub").textContent = opp ? `vs ${opp.abbreviation}` : "";
  if (matchupState.status === "none") { select.hidden = true; matchupText("No upcoming game."); return; }
  if (matchupState.status === "loading") { matchupText(opp ? `Loading ${opp.abbreviation}'s rotation...` : "Loading matchup..."); return; }
  if (matchupState.status === "failed") { select.disabled = true; matchupText("Matchup data is unavailable right now."); return; }

  // The dropdown: name · position, "· OUT" for players who won't play.
  if (select.options.length !== matchupState.roster.length) {
    select.innerHTML = matchupState.roster.map((row) =>
      `<option value="${row.id}">${matchupEscape(row.name)}${row.position ? ` · ${matchupEscape(row.position)}` : ""}${matchupInjuryKind(row.injury) === "out" ? " · OUT" : ""}</option>`).join("");
  }
  select.disabled = false;
  select.value = String(matchupState.pickedId);

  const me = matchupState.me;
  const picked = matchupPicked();
  const advFor = (id) => (typeof matchupState.advanced[id] === "object" ? matchupState.advanced[id] : {});
  const mine = { ...matchupState.myStats, ...advFor(me.id), adv: matchupState.advanced[me.id] };
  const theirs = { ...picked.stats, ...advFor(picked.id), adv: matchupState.advanced[picked.id] };
  ["usage", "passes", "rebChances"].forEach((key) => {
    if (mine[key] === undefined) mine[key] = null;
    if (theirs[key] === undefined) theirs[key] = null;
  });
  const myBadge = me.team ? teamBadgeHtml(me.team.abbreviation, opp.away, opp.home) : "";
  const theirBadge = teamBadgeHtml(opp.abbreviation, opp.away, opp.home);
  const backupTag = matchupState.outStarter && picked.id === matchupState.defaultId ? `<span class="lh-ma-badge is-backup">BACKUP</span> ` : "";
  const seasonNote = mine.fromLastSeason || theirs.fromLastSeason ? "season avg · last season where needed" : "season avg";

  body.className = `lh-ma${body.classList.contains("lh-cc-part") ? " lh-cc-part" : ""}`; // keep the collapse toggle's class (cardCollapse.js)
  body.innerHTML = `
    ${matchupFlagHtml(picked)}
    <div class="lh-ma-names">
      <div class="lh-ma-name"><div class="lh-ma-who">${matchupEscape(me.name)}</div>
        <div class="lh-ma-meta">${myBadge} ${matchupEscape(me.position)} · ${mine.min.toFixed(1)} min</div></div>
      <div class="lh-ma-vs">vs</div>
      <div class="lh-ma-name is-right"><div class="lh-ma-who">${matchupEscape(picked.name)}</div>
        <div class="lh-ma-meta">${backupTag}${matchupEscape(picked.position)} · ${theirs.min.toFixed(1)} min ${theirBadge}</div></div>
    </div>
    <div>
      <div class="lh-ma-sec"><span>Tale of the tape</span><span>${seasonNote}</span></div>
      <div class="lh-ma-tape">${matchupTapeHtml(mine, theirs)}</div>
    </div>
    <div class="lh-ma-battle">${matchupBattleHtml(mine, theirs, me.last, picked.last)}</div>
    ${matchupPastHtml(picked, me.last)}
    <a class="lh-ma-open" href="matchup.html?player=${me.id}&opp=${opp.id}&vs=${picked.id}">Open in Matchup Analyzer <span aria-hidden="true">›</span></a>`;
}

document.addEventListener("change", (event) => {
  if (event.target.id !== "matchupPick") return;
  matchupState.pickedId = Number(event.target.value);
  const picked = matchupPicked();
  if (picked) ensureMatchupAdvanced(picked.id, picked.stats.season);
  renderMatchupCard();
});
