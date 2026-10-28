// LineHunter - js/components/gameBreakdown.js
// The "Game Breakdown" card on game.html (and the model line in the Today page's Quick look): a projected score built from each
// team's offensive and defensive efficiency and pace, then home court, back-to-backs and injuries, compared with the book's
// spread and total. It always names a spread pick and a total pick, each with a strength (Slight / Moderate / Strong = the gap).
//
// The model, per 100 possessions (a rating = points scored or allowed per 100 possessions):
//   possessions  = away pace × home pace ÷ league pace            (two fast teams make a faster game)
//   team points  = possessions × (its Off Rtg × the other's Def Rtg ÷ league rating) ÷ 100
//   home court   = GB_CONFIG.homeEdge added to the home team and taken from the away team (1.8 points of margin)
//   back-to-back = a team that played yesterday loses GB_CONFIG.b2bPct of its points
//   injuries     = each player listed Out / Doubtful (full) or Questionable / Day-To-Day (half) takes away his points a game times
//                  (1 − GB_CONFIG.injury.keep): his backups make up the rest. A player who has sat out this season's games is
//                  already missing from this season's ratings, so he only counts for the last-season part of the blend.
// Early in a season each team's numbers are this season's gap to the league blended with last season's
// (this season's weight = games ÷ (games + GB_CONFIG.priorGames)), the same idea the Hunt Score engine uses.
//
// The score build-up table starts from a league-average game and adds one piece at a time, for each team and the total.
//
// Data: GET /nba/v1/team_season_averages/general?season=YEAR&season_type=regular&type=advanced&per_page=100
//   (the same request js/components/teamCompare.js makes, so bdlGet's memory cache shares it) -> data[i].team.id,
//   data[i].stats.{ pace, off_rating, def_rating, gp }; GET /nba/v2/odds?game_ids[]=ID -> total_value / spread_home_value per
//   sportsbook (strings); /v1/games for yesterday (back-to-backs); /v1/player_injuries?team_ids[]= (the same request the
//   injury card makes) and /nba/v1/season_averages/general?type=base&player_ids[]= for the listed players (this + last season).
//   Window debug object for testing: window.lhGameBreakdown.
//
// Needs js/core/stats.js (bdlGet, bdlGetAllPages, BDL_BASE), js/data/odds.js (lhOdds, optional) and js/core/hunts.js (bookLabel).

const GB_CONFIG = {
  priorGames: 10,   // last season counts as this many games of this season
  homeEdge: 0.9,    // points added to the home team and taken from the away team (1.8 points of margin)
  b2bPct: 0.014,    // second night of a back-to-back: 1.4% fewer points
  injury: {
    keep: 0.88,       // the backups make up 88% of a missing player's points a game; the team loses the other 12%
    gtdWeight: 0.5,   // Questionable / Day-To-Day count at half
    minMinutes: 10,   // players under 10 minutes a game don't move the score
    ownGames: 5,      // this season's scoring once a player has 5 games, else last season's
  },
  strength: { slight: 1.5, strong: 3 }, // gap to the book: under 1.5 Slight, 1.5-3 Moderate, over 3 Strong
  barPoints: 6,     // a build-up step of ± this many points fills half the bar
  stripPoints: 12,  // the model vs book strip shows the book total ± this many points
};
const GB_TEAM_URL = "/api/bdl/nba/v1/team_season_averages/general";
const GB_ODDS_URL = "/api/bdl/nba/v2/odds";

let breakdownLoaded = false;

// ---------- Data ----------

// { teams: { teamId: { pace, off, def, gp } }, league: { pace, rtg, gp } } for one season, or null with no games.
async function loadBreakdownSeason(season) {
  const rows = await bdlGetAllPages(`${GB_TEAM_URL}?season=${season}&season_type=regular&type=advanced&per_page=100`);
  const teams = {};
  rows.forEach((row) => {
    const s = row.stats || {};
    if (![s.pace, s.off_rating, s.def_rating].every(Number.isFinite)) return;
    teams[row.team.id] = { abbr: row.team.abbreviation, pace: s.pace, off: s.off_rating, def: s.def_rating, gp: Number.isFinite(s.gp) ? s.gp : null };
  });
  const list = Object.values(teams);
  if (!list.length) return null;
  const mean = (key) => list.reduce((sum, team) => sum + team[key], 0) / list.length;
  const gps = list.map((team) => team.gp).filter(Number.isFinite);
  return {
    season,
    teams,
    league: { pace: mean("pace"), rtg: (mean("off") + mean("def")) / 2, gp: gps.length ? gps.reduce((a, b) => a + b, 0) / gps.length : null },
  };
}

// This season's weight for a team (or the league): games ÷ (games + prior). No games column = trust this season fully.
function breakdownWeight(gp) {
  return Number.isFinite(gp) ? gp / (gp + GB_CONFIG.priorGames) : 1;
}

// Each team's blended pace / Off Rtg / Def Rtg, kept as gaps to its season's league average and put back on one league.
function blendRatings(current, last) {
  const ids = new Set([...Object.keys(current ? current.teams : {}), ...Object.keys(last ? last.teams : {})]);
  const leagueW = current ? (last ? breakdownWeight(current.league.gp) : 1) : 0;
  const league = {
    pace: (current ? current.league.pace * leagueW : 0) + (last ? last.league.pace * (1 - leagueW) : 0),
    rtg: (current ? current.league.rtg * leagueW : 0) + (last ? last.league.rtg * (1 - leagueW) : 0),
  };

  const teams = {};
  ids.forEach((id) => {
    const now = current && current.teams[id];
    const before = last && last.teams[id];
    const w = now ? (before ? breakdownWeight(now.gp) : 1) : 0;
    const gap = (key, lgKey) => (now ? (now[key] - current.league[lgKey]) * w : 0) + (before ? (before[key] - last.league[lgKey]) * (1 - w) : 0);
    teams[id] = {
      abbr: (now || before).abbr,
      gp: now ? now.gp : 0,
      weight: w,
      pace: league.pace + gap("pace", "pace"),
      off: league.rtg + gap("off", "rtg"),
      def: league.rtg + gap("def", "rtg"),
    };
  });

  // Ranks of 30: Off Rtg #1 = highest, Def Rtg #1 = lowest (allows the least), Pace #1 = fastest
  const list = Object.values(teams);
  const rank = (key, highFirst) => (value) => 1 + list.filter((team) => (highFirst ? team[key] > value : team[key] < value)).length;
  return { teams, league, rankOff: rank("off", true), rankDef: rank("def", false), rankPace: rank("pace", true) };
}

// The book's total and spread: the visitor's chosen sportsbook, else DraftKings, else the first book posting a total.
async function loadBreakdownOdds(gameId) {
  const json = await bdlGet(`${GB_ODDS_URL}?game_ids[]=${gameId}`);
  const rows = (json.data || []).filter((row) => row.total_value !== null && row.total_value !== undefined && row.total_value !== "");
  const chosen = typeof lhOdds !== "undefined" ? lhOdds.getBook() : null;
  const row = rows.find((r) => r.vendor === chosen) || rows.find((r) => r.vendor === "draftkings") || rows[0];
  if (!row) return null;
  const spread = Number(row.spread_home_value);
  return { total: Number(row.total_value), spreadHome: Number.isFinite(spread) && row.spread_home_value !== null ? spread : null, vendor: row.vendor };
}

const GB_AVG_URL = "/api/bdl/nba/v1/season_averages/general";

// Minutes from "34:12" or 34.2
const gbMinutes = (value) => (typeof value === "string" && value.includes(":") ? Number(value.split(":")[0]) + Number(value.split(":")[1]) / 60 : Number(value) || 0);

// { teamId: true } for the teams that played the day before the game
async function loadBreakdownRest(game) {
  const day = new Date(`${game.date.slice(0, 10)}T12:00:00`);
  day.setDate(day.getDate() - 1);
  const yesterday = day.toLocaleDateString("en-CA");
  const games = await bdlGetAllPages(`${BDL_BASE}/games?start_date=${yesterday}&end_date=${yesterday}&per_page=100`);
  const played = {};
  games.forEach((item) => { played[item.home_team.id] = true; played[item.visitor_team.id] = true; });
  return played;
}

// The listed players of both teams who move the score: [{ id, name, teamId, status, weight, min, pts, gpThis }]
async function loadBreakdownInjuries(game) {
  const ids = [game.visitor_team.id, game.home_team.id];
  const list = await bdlGetAllPages(`${BDL_BASE}/player_injuries?${ids.map((id) => `team_ids[]=${id}`).join("&")}&per_page=100`);
  const weightOf = (status) => (/out|doubt/i.test(status || "") ? 1 : /question|day/i.test(status || "") ? GB_CONFIG.injury.gtdWeight : 0);
  const hurt = list.filter((item) => item.player && ids.includes(item.player.team_id) && weightOf(item.status) > 0);
  if (!hurt.length) return [];
  const playerIds = hurt.map((item) => `player_ids[]=${item.player.id}`).join("&");
  const averages = (season) => bdlGetAllPages(`${GB_AVG_URL}?season=${season}&season_type=regular&type=base&per_page=100&${playerIds}`).catch(() => []);
  const [now, before] = await Promise.all([averages(game.season), averages(game.season - 1)]);
  const byId = (rows) => Object.fromEntries(rows.filter((row) => row.player && row.stats).map((row) => [row.player.id, row.stats]));
  const thisSeason = byId(now);
  const lastSeason = byId(before);
  return hurt.map((item) => {
    const mine = thisSeason[item.player.id];
    const old = lastSeason[item.player.id];
    const gpThis = mine ? Number(mine.gp) || 0 : 0;
    const use = mine && gpThis >= GB_CONFIG.injury.ownGames ? mine : old || mine;
    if (!use) return null;
    return {
      id: item.player.id, name: `${item.player.first_name} ${item.player.last_name}`, last: item.player.last_name,
      teamId: item.player.team_id, status: item.status, weight: weightOf(item.status),
      min: gbMinutes(use.min), pts: Number(use.pts) || 0, gpThis,
    };
  }).filter((player) => player && player.min >= GB_CONFIG.injury.minMinutes);
}

// ---------- The model ----------

function breakdownModel(game, ratings, extras = {}) {
  const away = ratings.teams[game.visitor_team.id];
  const home = ratings.teams[game.home_team.id];
  if (!away || !home) return null;
  const lg = ratings.league;
  const a = game.visitor_team.abbreviation;
  const h = game.home_team.abbreviation;

  // Points for one game with the given numbers (anything not given = league average)
  const scores = (v) => {
    const poss = (v.awayPace ?? lg.pace) * (v.homePace ?? lg.pace) / lg.pace;
    const awayPts = poss * ((v.awayOff ?? lg.rtg) * (v.homeDef ?? lg.rtg) / lg.rtg) / 100;
    const homePts = poss * ((v.homeOff ?? lg.rtg) * (v.awayDef ?? lg.rtg) / lg.rtg) / 100;
    return { poss, awayPts, homePts };
  };

  // The build-up: one piece at a time, each team's running score
  const steps = [];
  const add = (label, note, awayPts, homePts, isNew) => {
    const before = steps[steps.length - 1];
    steps.push({ label, note, away: awayPts, home: homePts, awayDelta: before ? awayPts - before.away : null, homeDelta: before ? homePts - before.home : null, isNew: Boolean(isNew) });
  };
  const base = scores({});
  add("League-average game", "average pace, offense and defense", base.awayPts, base.homePts);
  let v = { awayPace: away.pace, homePace: home.pace };
  let now = scores(v);
  add("Pace", `${a} ${away.pace.toFixed(1)} (#${ratings.rankPace(away.pace)}) · ${h} ${home.pace.toFixed(1)} (#${ratings.rankPace(home.pace)}) → ${now.poss.toFixed(1)} possessions`, now.awayPts, now.homePts);
  v = { ...v, awayOff: away.off, homeDef: home.def };
  now = scores(v);
  add(`${a} offense vs ${h} defense`, `${away.off.toFixed(1)} Off Rtg (#${ratings.rankOff(away.off)}) vs ${home.def.toFixed(1)} Def Rtg (#${ratings.rankDef(home.def)})`, now.awayPts, now.homePts);
  v = { ...v, homeOff: home.off, awayDef: away.def };
  now = scores(v);
  add(`${h} offense vs ${a} defense`, `${home.off.toFixed(1)} Off Rtg (#${ratings.rankOff(home.off)}) vs ${away.def.toFixed(1)} Def Rtg (#${ratings.rankDef(away.def)})`, now.awayPts, now.homePts);
  const possessions = now.poss;
  let awayPts = now.awayPts - GB_CONFIG.homeEdge;
  let homePts = now.homePts + GB_CONFIG.homeEdge;
  add("Home court", `${h} at home, worth ${(GB_CONFIG.homeEdge * 2).toFixed(1)} points of margin`, awayPts, homePts);

  const rest = extras.rest || {};
  const tiredAway = Boolean(rest[game.visitor_team.id]);
  const tiredHome = Boolean(rest[game.home_team.id]);
  if (tiredAway || tiredHome) {
    if (tiredAway) awayPts -= awayPts * GB_CONFIG.b2bPct;
    if (tiredHome) homePts -= homePts * GB_CONFIG.b2bPct;
    add("Back-to-back", `${[tiredAway ? a : null, tiredHome ? h : null].filter(Boolean).join(" and ")} played last night`, awayPts, homePts);
  }

  // Injuries: what each listed player usually scores, less what his backups make up, at his status weight. A player who has
  // sat out this season's games is already missing from this season's ratings, so only the last-season part of the blend counts him.
  const missing = (extras.injuries || []).map((player) => {
    const team = player.teamId === game.visitor_team.id ? away : home;
    const teamGames = Number.isFinite(team.gp) && team.gp > 0 ? team.gp : 0;
    const playedShare = teamGames ? Math.min(1, player.gpThis / teamGames) : 1;
    const inRatings = team.weight * playedShare + (1 - team.weight);
    const loss = player.pts * (1 - GB_CONFIG.injury.keep) * player.weight * inRatings;
    return { ...player, abbr: team === away ? a : h, loss };
  }).filter((player) => player.loss >= 0.05).sort((x, y) => y.loss - x.loss);
  if (missing.length) {
    const lossOf = (abbr) => missing.filter((player) => player.abbr === abbr).reduce((sum, player) => sum + player.loss, 0);
    awayPts -= lossOf(a);
    homePts -= lossOf(h);
    const names = (abbr) => missing.filter((player) => player.abbr === abbr).map((player) => `${player.last}${player.weight < 1 ? " (GTD, half)" : ""}`);
    const parts = [a, h].filter((abbr) => names(abbr).length).map((abbr) => `${abbr} without ${names(abbr).join(", ")}`);
    add("Injuries", parts.join(" · "), awayPts, homePts);
  }

  add("Model", "", awayPts, homePts);
  return {
    away, home, possessions, awayPts, homePts, total: awayPts + homePts, steps, missing,
    tired: { away: tiredAway, home: tiredHome },
  };
}

// The strength of a pick from its gap to the book
function gbStrength(gap) {
  const size = Math.abs(gap);
  return size > GB_CONFIG.strength.strong ? "Strong" : size >= GB_CONFIG.strength.slight ? "Moderate" : "Slight";
}

const gbLine = (value) => (value === 0 ? "PK" : `${value > 0 ? "+" : "−"}${Math.abs(value)}`);

// { spread, total } picks against the book (null without a line). spread = { team, text, side: "away"|"home", gap, strength },
// total = { side: "over"|"under", text, gap, strength }. A gap under 0.05 is "even" (no side).
function gbPicks(game, model, odds) {
  const a = game.visitor_team.abbreviation;
  const h = game.home_team.abbreviation;
  let spread = null;
  if (odds && odds.spreadHome !== null) {
    const diff = (model.homePts - model.awayPts) + odds.spreadHome; // > 0: the home team covers its line in the model
    const home = diff > 0;
    spread = Math.abs(diff) < 0.05
      ? { even: true, gap: 0, text: "Even", strength: "Even" }
      : { side: home ? "home" : "away", team: home ? h : a, text: `${home ? h : a} ${gbLine(home ? odds.spreadHome : -odds.spreadHome)}`, gap: Math.abs(diff), strength: gbStrength(diff) };
  }
  let total = null;
  if (odds && Number.isFinite(odds.total)) {
    const diff = model.total - odds.total;
    total = Math.abs(diff) < 0.05
      ? { even: true, gap: 0, text: "Even", strength: "Even", side: "none" }
      : { side: diff > 0 ? "over" : "under", text: `${diff > 0 ? "Over" : "Under"} ${odds.total}`, gap: Math.abs(diff), strength: gbStrength(diff), diff };
  }
  return { spread, total };
}

// ---------- Drawing ----------

const gbNum = (value, digits = 1) => value.toFixed(digits);
const gbSigned = (value) => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value).toFixed(1)}`;

function gbLean(model, odds) {
  if (!odds) return null;
  const gap = model.total - odds.total;
  const side = Math.abs(gap) < 0.05 ? "none" : gap > 0 ? "over" : "under";
  return { gap, side, text: side === "none" ? "Even" : side === "over" ? "Over" : "Under" };
}

function gbBookName(vendor) {
  if (typeof lhOdds !== "undefined") return lhOdds.vendorName(vendor);
  return vendor;
}

// The teaser: the two-team scoreboard (the team the model has ahead in full ink), the spread pick and the total pick (each with
// its strength and the model vs book numbers), the injuries line and the note. Research mode hides the book parts and shows the
// model's own margin and total instead. A finished game also says whether each pick hit.
function gbScoreHtml(game, model, odds, picks) {
  const a = game.visitor_team.abbreviation;
  const h = game.home_team.abbreviation;
  const margin = model.homePts - model.awayPts;
  const marginText = Math.abs(margin) < 0.05 ? "Even" : `${margin > 0 ? h : a} −${gbNum(Math.abs(margin))}`;
  const final = game.status === "Final" && Number.isFinite(game.home_team_score) && game.home_team_score + game.visitor_team_score > 0;
  const side = (abbr, pts, lead, home) => `
        <div class="lh-gb-side${home ? " is-home" : ""}${lead ? " is-lead" : ""}">
          <span class="lh-gb-abbr">${abbr}</span>
          <span class="lh-gb-pts">${gbNum(pts)}</span>
        </div>`;

  // Did each pick hit? (only once the game is final)
  let spreadResult = "";
  let totalResult = "";
  if (final && picks.spread && !picks.spread.even) {
    const realMargin = game.home_team_score - game.visitor_team_score + odds.spreadHome; // > 0 home covered
    const hit = realMargin === 0 ? "push" : (realMargin > 0) === (picks.spread.side === "home") ? "hit" : "missed";
    spreadResult = `<span class="lh-gb-result is-${hit}">${hit === "push" ? "Push" : hit === "hit" ? "Hit" : "Missed"}</span>`;
  }
  if (final && picks.total && !picks.total.even) {
    const real = game.home_team_score + game.visitor_team_score;
    const hit = real === odds.total ? "push" : (real > odds.total) === (picks.total.side === "over") ? "hit" : "missed";
    totalResult = `<span class="lh-gb-result is-${hit}">${hit === "push" ? "Push" : hit === "hit" ? "Hit" : "Missed"}</span>`;
  }

  // Under each pick: BOOK | MODEL | GAP side by side. The spread is written for the picked team in both columns, + / − like a
  // betting line (the model's "NYK by 7" is "NYK −7.0"), so the two numbers read the same way.
  const bookLabel = odds ? (typeof lhHunts !== "undefined" ? lhHunts.bookLabel(odds.vendor) : gbBookName(odds.vendor)) : "";
  const numbers = (cells) => `<dl class="lh-gb-nums">${cells.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
  const pickHtml = (label, pick, cells, result, tone) => `
        <div class="lh-gb-pick${tone ? ` is-${tone}` : ""}">
          <div class="lh-gb-pickhead"><span>${label}</span><span class="lh-gb-strength">${pick ? pick.strength : ""}</span></div>
          <div class="lh-gb-picktext">${pick ? pick.text : "No line yet"} ${result}</div>
          ${numbers(cells)}
        </div>`;
  let spreadCells = [["Model", marginText]];
  if (picks.spread) {
    // the team to write both lines for: the pick, or the home team when the model and the book agree exactly
    const forHome = picks.spread.even ? true : picks.spread.side === "home";
    const team = forHome ? h : a;
    const bookLine = forHome ? odds.spreadHome : -odds.spreadHome;
    const modelLine = forHome ? -margin : margin; // a team the model has winning by 7 = −7.0
    const fmt = (value) => (Math.abs(value) < 0.05 ? "PK" : `${value > 0 ? "+" : "−"}${gbNum(Math.abs(value))}`);
    spreadCells = [[`Book · ${bookLabel}`, `${team} ${gbLine(bookLine)}`], ["Model", `${team} ${fmt(modelLine)}`], ["Gap", picks.spread.even ? "0" : gbNum(picks.spread.gap)]];
  }
  const totalCells = picks.total
    ? [[`Book · ${bookLabel}`, `${odds.total}`], ["Model", gbNum(model.total)], ["Gap", picks.total.even ? "0" : gbNum(picks.total.gap)]]
    : [["Model", gbNum(model.total)]];
  const injuries = model.missing.length
    ? [a, h].map((abbr) => {
      const list = model.missing.filter((player) => player.abbr === abbr);
      if (!list.length) return "";
      const loss = list.reduce((sum, player) => sum + player.loss, 0);
      return `<span><b>${abbr} −${gbNum(loss)}</b> <span class="lh-gb-src">${list.map((player) => `${player.last} ${player.weight < 1 ? "GTD" : "out"}`).join(", ")}</span></span>`;
    }).join("")
    : `<span class="lh-gb-src">No one who plays 10+ minutes is listed</span>`;

  return `
    <div class="lh-gb-board" role="img" aria-label="Projected score ${a} ${gbNum(model.awayPts)}, ${h} ${gbNum(model.homePts)}">
      <span class="lh-gb-boardlabel">Projected score</span>
      ${side(a, model.awayPts, margin < 0, false)}
      ${side(h, model.homePts, margin > 0, true)}
    </div>
    <div class="lh-gb-picks lines-only">
      ${pickHtml("Spread pick", picks.spread, spreadCells, spreadResult, "")}
      ${pickHtml("Total pick", picks.total, totalCells, totalResult, picks.total && !picks.total.even ? picks.total.side : "")}
    </div>
    <dl class="lh-gb-list research-only">
      <div><dt>Margin</dt><dd><b>${marginText}</b></dd></div>
      <div><dt>Total</dt><dd><b>${gbNum(model.total)}</b></dd></div>
    </dl>
    <div class="lh-gb-injuries"><span class="lh-gb-label">Injuries</span>${injuries}</div>
    ${final ? `<p class="lh-gb-note">Final: ${a} ${game.visitor_team_score} – ${game.home_team_score} ${h}. The season ratings include this game, so treat the check as rough.</p>` : ""}
    <p class="lh-gb-note lines-only">Strength is the gap to the book: Slight under ${GB_CONFIG.strength.slight}, Moderate ${GB_CONFIG.strength.slight}–${GB_CONFIG.strength.strong}, Strong over ${GB_CONFIG.strength.strong}. The books watch the same ratings, rest and injuries, so a big gap means take a closer look, not guaranteed.</p>`;
}

// Model vs book on one number line: the book's total in the middle, the model's dot, the gap between them colored
// toward Over (teal, right) or Under (coral, left); a finished game also shows the real total.
function gbStripHtml(game, model, odds, lean) {
  if (!odds) return `<p class="lh-gb-note lines-only">No book has posted a total for this game yet.</p>`;
  const final = game.status === "Final" && game.home_team_score + game.visitor_team_score > 0
    ? game.home_team_score + game.visitor_team_score : null;
  // The book total ± stripPoints, wider when the model (or the final total) lands outside that
  const reach = Math.max(GB_CONFIG.stripPoints, ...[model.total, final].filter(Number.isFinite).map((value) => Math.ceil((Math.abs(value - odds.total) + 2) / 6) * 6));
  const lo = odds.total - reach;
  const pos = (value) => Math.max(0, Math.min(100, ((value - lo) / (reach * 2)) * 100));
  const modelPos = pos(model.total);
  // Labels near the ends hang inward so they never stick out of the card
  const edge = (left) => (left > 85 ? " is-end" : left < 15 ? " is-start" : "");
  const step = reach / 2;
  const ticks = [-2, -1, 1, 2].map((n) => odds.total + n * step)
    .filter((value) => Math.abs(pos(value) - modelPos) > 9)
    .map((value) => `<span class="lh-gb-tick" style="left: ${pos(value)}%">${gbNum(value)}</span>`).join("");
  let result = "";
  if (final !== null) {
    const hit = final > odds.total ? "over" : final < odds.total ? "under" : "push";
    const right = lean.side === "none" || hit === "push" ? "" : lean.side === hit ? " · the total pick hit" : " · the total pick missed";
    result = `<p class="lh-gb-note">Final total ${final}: ${hit === "push" ? "push" : `the ${hit} hit`}${right}. The season ratings include this game, so treat it as a rough check.</p>`;
  }

  return `
    <div class="lh-gb-section lines-only">
      <div class="lh-gb-subhead"><span>Model vs book</span><span class="lh-gb-legend">◂ Under · Over ▸</span></div>
      <div class="lh-gb-strip" role="img" aria-label="Model total ${gbNum(model.total)} vs book ${odds.total}">
        <div class="lh-gb-axis"></div>
        <span class="lh-gb-gap is-${model.total >= odds.total ? "over" : "under"}" style="left: ${Math.min(50, modelPos)}%; width: ${Math.abs(modelPos - 50)}%"></span>
        <span class="lh-gb-mark is-book" style="left: 50%"><b>Book ${odds.total}</b></span>
        <span class="lh-gb-mark is-model is-${lean.side}${edge(modelPos)}" style="left: ${modelPos}%"><b>Model ${gbNum(model.total)}</b></span>
        ${final !== null ? `<span class="lh-gb-mark is-final${edge(pos(final))}" style="left: ${pos(final)}%"><b>Final ${final}</b></span>` : ""}
        <div class="lh-gb-ticks">${ticks}</div>
      </div>
      ${result}
    </div>`;
}

// The score build-up: one row per piece with each team's running score (and how much that piece moved it) and the total.
function gbStepsHtml(game, model) {
  const a = game.visitor_team.abbreviation;
  const h = game.home_team.abbreviation;
  const delta = (value) => (value === null || Math.abs(value) < 0.05 ? "" : `<small class="${value > 0 ? "is-over" : "is-under"}">${gbSigned(value)}</small>`);
  const rows = model.steps.map((step, index) => `
        <div class="lh-gb-trow${index === model.steps.length - 1 ? " is-total" : ""}">
          <span class="lh-gb-tname">${step.label}${step.note ? `<small>${step.note}</small>` : ""}</span>
          <span class="lh-gb-tnum">${gbNum(step.away)}${delta(step.awayDelta)}</span>
          <span class="lh-gb-tnum">${gbNum(step.home)}${delta(step.homeDelta)}</span>
          <span class="lh-gb-tnum lh-gb-ttotal">${gbNum(step.away + step.home)}</span>
        </div>`).join("");
  return `
    <div class="lh-gb-section">
      <div class="lh-gb-subhead"><span>Score build-up</span></div>
      <div class="lh-gb-table">
        <div class="lh-gb-trow is-head"><span>Step</span><span>${a}</span><span>${h}</span><span>Total</span></div>
        ${rows}
      </div>
    </div>`;
}

// Who is missing: each listed player who moved the score, his status, minutes and scoring, and what he takes off his team.
function gbMissingHtml(model) {
  if (!model.missing.length) return "";
  const rows = model.missing.map((player) => `
        <div class="lh-gb-mrow">
          <span><b>${player.name}</b> <span class="lh-gb-src">${player.abbr}</span></span>
          <span class="lh-gb-status${player.weight < 1 ? "" : " is-out"}">${player.weight < 1 ? "GTD" : /doubt/i.test(player.status) ? "DOUBTFUL" : "OUT"}</span>
          <span class="lh-gb-src">${player.min.toFixed(1)} min · ${player.pts.toFixed(1)} pts a game${player.weight < 1 ? " · counted at half" : ""}</span>
          <b class="lh-gb-mloss">${player.abbr} −${gbNum(player.loss)}</b>
        </div>`).join("");
  return `
    <div class="lh-gb-section">
      <div class="lh-gb-subhead"><span>Who is missing</span></div>
      ${rows}
      <p class="lh-gb-note">Out and Doubtful count fully, game-time decisions count half. The backups make up most of a missing player's points, so the team loses about ${Math.round((1 - GB_CONFIG.injury.keep) * 100)}% of what he scores.</p>
    </div>`;
}

function gbSourceText(ratings, current, last, game) {
  const away = ratings.teams[game.visitor_team.id];
  const home = ratings.teams[game.home_team.id];
  const label = (season) => `${season}-${String(season + 1).slice(2)}`;
  if (!current) return `Ratings: ${label(last.season)} season (no games this season yet).`;
  if (!last) return `Ratings: ${label(current.season)} season.`;
  const pct = (team) => Math.round(team.weight * 100);
  const games = (team) => (Number.isFinite(team.gp) && team.gp ? `${team.gp} games` : "this season");
  return `Ratings: ${label(current.season)} blended with ${label(last.season)} · ${game.visitor_team.abbreviation} ${pct(away)}% this season (${games(away)}), ${game.home_team.abbreviation} ${pct(home)}% (${games(home)}).`;
}

function renderBreakdownSkeleton() {
  const body = document.getElementById("gameBreakdownBody");
  const line = (height) => `<span class="placeholder col-12" style="height: ${height}"></span>`;
  body.innerHTML = `<div class="placeholder-glow" aria-hidden="true">${line("4rem")}<div class="mt-3">${line("1.5rem")}</div><div class="mt-3">${line("10rem")}</div></div>`;
}

// Everything the card and the Today page's Quick look need for one game: { current, last, ratings, model, odds, lean },
// or { error: "..." } when the ratings are missing. The team ratings are shared requests (bdlGet keeps them in memory).
async function gameModelFor(game) {
  const [current, last, odds, rest, injuries] = await Promise.all([
    loadBreakdownSeason(game.season).catch(() => null),
    loadBreakdownSeason(game.season - 1).catch(() => null),
    loadBreakdownOdds(game.id).catch(() => null),
    loadBreakdownRest(game).catch(() => ({})),
    loadBreakdownInjuries(game).catch(() => []),
  ]);
  if (!current && !last) return { error: "Team ratings aren't available yet." };
  const ratings = blendRatings(current, last);
  const model = breakdownModel(game, ratings, { rest, injuries });
  if (!model) return { error: "Ratings aren't available for these teams." };
  return { current, last, ratings, model, odds, lean: gbLean(model, odds), picks: gbPicks(game, model, odds) };
}

// The card: the teaser (projected score, both picks, injuries) always shows; the number line, the build-up, who is missing and
// the ratings note sit behind "Show breakdown details" (a Bootstrap collapse).
async function loadGameBreakdown(game) {
  const body = document.getElementById("gameBreakdownBody");
  renderBreakdownSkeleton();
  try {
    const result = await gameModelFor(game);
    if (result.error) {
      body.innerHTML = `<p class="lh-gb-note">${result.error}</p>`;
      return;
    }
    const { current, last, ratings, model, odds, lean, picks } = result;
    window.lhGameBreakdown = { game, current, last, ratings, model, odds, lean, picks }; // for testing in the console

    body.innerHTML = `
      ${gbScoreHtml(game, model, odds, picks)}
      <button type="button" class="lh-sec-toggle lh-gb-more collapsed" data-bs-toggle="collapse" data-bs-target="#gameBreakdownMore" aria-expanded="false" aria-controls="gameBreakdownMore">
        <span class="lh-when-closed">Show breakdown details</span><span class="lh-when-open">Hide breakdown details</span> <i class="bi bi-chevron-down lh-mi-chevron" aria-hidden="true"></i>
      </button>
      <div class="collapse" id="gameBreakdownMore">
        <p class="lh-gb-note">Expected possessions: ${gbNum(model.possessions)} (both teams' pace).</p>
        ${gbStripHtml(game, model, odds, lean)}
        ${gbStepsHtml(game, model)}
        ${gbMissingHtml(model)}
        <p class="lh-gb-note">${gbSourceText(ratings, current, last, game)}</p>
      </div>`;
  } catch (error) {
    console.error("Game breakdown failed:", error);
    body.innerHTML = `<p class="lh-gb-note">The game breakdown is unavailable right now.</p>`;
  }
}

// Called by js/pages/game.js once the game is known; downloads when the card scrolls into view (200px early).
function setUpGameBreakdown(game) {
  const card = document.getElementById("gameBreakdown");
  if (!card) return;
  renderBreakdownSkeleton();
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting) || breakdownLoaded) return;
    breakdownLoaded = true;
    observer.disconnect();
    loadGameBreakdown(game);
  }, { rootMargin: "200px 0px" });
  observer.observe(card);
}
