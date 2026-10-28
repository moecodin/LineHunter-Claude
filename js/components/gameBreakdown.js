// LineHunter - js/components/gameBreakdown.js
// The "Game Breakdown" card on game.html (a test): a projected score built from each team's offensive and defensive
// efficiency and pace, compared with the book's total for an Over / Under lean.
//
// The model, per 100 possessions (a rating = points scored or allowed per 100 possessions):
//   possessions  = away pace × home pace ÷ league pace            (two fast teams make a faster game)
//   away points  = possessions × (away Off Rtg × home Def Rtg ÷ league rating) ÷ 100 − home edge
//   home points  = possessions × (home Off Rtg × away Def Rtg ÷ league rating) ÷ 100 + home edge
//   model total  = away points + home points; gap = model total − book total; |gap| >= GB_CONFIG.leanGap = a lean.
// Early in a season each team's numbers are this season's gap to the league blended with last season's
// (this season's weight = games ÷ (games + GB_CONFIG.priorGames)), the same idea the Hunt Score engine uses.
//
// The total build-up table starts from a league-average game and swaps in one real number at a time (pace, then each
// offense and the defense it faces); each row = how many points that swap moved the total. The home edge moves points
// from one team to the other, so it changes the score but not the total.
//
// Data: GET /nba/v1/team_season_averages/general?season=YEAR&season_type=regular&type=advanced&per_page=100
//   (the same request js/components/teamCompare.js makes, so bdlGet's memory cache shares it) -> data[i].team.id,
//   data[i].stats.{ pace, off_rating, def_rating, gp }, and GET /nba/v2/odds?game_ids[]=ID -> total_value / spread_home_value
//   per sportsbook (strings). Window debug object for testing: window.lhGameBreakdown.
//
// Needs js/core/stats.js (bdlGet, bdlGetAllPages), js/data/odds.js (lhOdds, optional) and js/core/hunts.js (bookLabel).

const GB_CONFIG = {
  priorGames: 10,   // last season counts as this many games of this season
  homeEdge: 1.2,    // points added to the home team and taken from the away team
  leanGap: 3,       // model total this many points from the book = a lean
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

// ---------- The model ----------

function breakdownModel(game, ratings) {
  const away = ratings.teams[game.visitor_team.id];
  const home = ratings.teams[game.home_team.id];
  if (!away || !home) return null;
  const lg = ratings.league;

  // Points for one game with the given numbers (anything not given = league average)
  const scores = (v) => {
    const poss = (v.awayPace ?? lg.pace) * (v.homePace ?? lg.pace) / lg.pace;
    const awayPts = poss * ((v.awayOff ?? lg.rtg) * (v.homeDef ?? lg.rtg) / lg.rtg) / 100;
    const homePts = poss * ((v.homeOff ?? lg.rtg) * (v.awayDef ?? lg.rtg) / lg.rtg) / 100;
    return { poss, awayPts, homePts, total: awayPts + homePts };
  };

  // The build-up: one real number swapped in at a time
  const a = game.visitor_team.abbreviation;
  const h = game.home_team.abbreviation;
  const swaps = [
    { label: "Pace", detail: `${a} ${away.pace.toFixed(1)} (#${ratings.rankPace(away.pace)}) · ${h} ${home.pace.toFixed(1)} (#${ratings.rankPace(home.pace)}) · league ${lg.pace.toFixed(1)}`, set: { awayPace: away.pace, homePace: home.pace } },
    { label: `${a} offense`, detail: `${away.off.toFixed(1)} Off Rtg (#${ratings.rankOff(away.off)}) vs league ${lg.rtg.toFixed(1)}`, set: { awayOff: away.off } },
    { label: `${h} defense`, detail: `${home.def.toFixed(1)} Def Rtg (#${ratings.rankDef(home.def)}) facing ${a}`, set: { homeDef: home.def } },
    { label: `${h} offense`, detail: `${home.off.toFixed(1)} Off Rtg (#${ratings.rankOff(home.off)}) vs league ${lg.rtg.toFixed(1)}`, set: { homeOff: home.off } },
    { label: `${a} defense`, detail: `${away.def.toFixed(1)} Def Rtg (#${ratings.rankDef(away.def)}) facing ${h}`, set: { awayDef: away.def } },
  ];
  const base = scores({});
  let values = {};
  let previous = base.total;
  const steps = swaps.map((swap) => {
    values = { ...values, ...swap.set };
    const total = scores(values).total;
    const step = { label: swap.label, detail: swap.detail, points: total - previous, running: total };
    previous = total;
    return step;
  });

  const final = scores(values);
  return {
    away, home,
    possessions: final.poss,
    awayPts: final.awayPts - GB_CONFIG.homeEdge,
    homePts: final.homePts + GB_CONFIG.homeEdge,
    total: final.total,
    base: base.total,
    steps,
  };
}

// ---------- Drawing ----------

const gbNum = (value, digits = 1) => value.toFixed(digits);
const gbSigned = (value) => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value).toFixed(1)}`;

function gbLean(model, odds) {
  if (!odds) return null;
  const gap = model.total - odds.total;
  const side = Math.abs(gap) < GB_CONFIG.leanGap ? "none" : gap > 0 ? "over" : "under";
  return { gap, side, text: side === "none" ? "No lean" : side === "over" ? "Over lean" : "Under lean" };
}

function gbBookName(vendor) {
  if (typeof lhOdds !== "undefined") return lhOdds.vendorName(vendor);
  return vendor;
}

// The big projected score: AWY 112.4 – 116.1 HME, then the total, margin and the book's numbers
function gbScoreHtml(game, model, odds, lean) {
  const a = game.visitor_team.abbreviation;
  const h = game.home_team.abbreviation;
  const margin = model.homePts - model.awayPts;
  const marginText = Math.abs(margin) < 0.05 ? "Even" : `${margin > 0 ? h : a} by ${gbNum(Math.abs(margin))}`;
  const bookSpread = odds && odds.spreadHome !== null
    ? `book ${odds.spreadHome < 0 ? `${h} −${Math.abs(odds.spreadHome)}` : odds.spreadHome > 0 ? `${a} −${odds.spreadHome}` : "pick'em"}`
    : "";
  const final = game.status === "Final" && Number.isFinite(game.home_team_score) && game.home_team_score + game.visitor_team_score > 0;

  return `
    <div class="lh-gb-top">
      <div class="lh-gb-score" aria-label="Projected score ${a} ${gbNum(model.awayPts)}, ${h} ${gbNum(model.homePts)}">
        <div class="lh-gb-team"><span class="lh-gb-abbr">${a}</span><span class="lh-gb-pts">${gbNum(model.awayPts)}</span></div>
        <span class="lh-gb-dash" aria-hidden="true">–</span>
        <div class="lh-gb-team is-home"><span class="lh-gb-pts">${gbNum(model.homePts)}</span><span class="lh-gb-abbr">${h}</span></div>
      </div>
      <dl class="lh-gb-facts">
        <div><dt>Model total</dt><dd>${gbNum(model.total)}</dd></div>
        <div><dt>Margin</dt><dd>${marginText}<small class="lines-only">${bookSpread}</small></dd></div>
        <div><dt>Possessions</dt><dd>${gbNum(model.possessions)}</dd></div>
        ${odds ? `<div class="lines-only"><dt>Book O/U · ${gbBookName(odds.vendor)}</dt><dd>${odds.total}</dd></div>` : ""}
        ${lean ? `<div class="lines-only"><dt>Lean</dt><dd><span class="lh-gb-lean is-${lean.side}">${lean.text}</span><small>${gbSigned(lean.gap)} vs book</small></dd></div>` : ""}
        ${final ? `<div><dt>Final</dt><dd>${game.visitor_team_score + game.home_team_score}<small>${a} ${game.visitor_team_score} – ${game.home_team_score} ${h}</small></dd></div>` : ""}
      </dl>
    </div>`;
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
    const right = lean.side === "none" || hit === "push" ? "" : lean.side === hit ? " · the lean was right" : " · the lean missed";
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

// The build-up: league-average game, one row per swap (bar from the center: right = adds points, left = takes them away)
function gbStepsHtml(model, odds) {
  const rows = model.steps.map((step) => {
    const width = Math.min(Math.abs(step.points) / GB_CONFIG.barPoints, 1) * 50;
    const tone = step.points >= 0.05 ? "is-over" : step.points <= -0.05 ? "is-under" : "";
    return `
      <div class="lh-ph-step">
        <span class="lh-ph-name">${step.label}<small>${step.detail}</small></span>
        <span class="lh-gb-bar" aria-hidden="true"><span class="${tone}" style="width: ${width}%"></span></span>
        <span class="lh-ph-delta lh-gb-delta ${tone}">${gbSigned(step.points)}</span>
        <span class="lh-ph-run">${gbNum(step.running)}</span>
      </div>`;
  }).join("");
  const gap = odds ? model.total - odds.total : null;

  return `
    <div class="lh-gb-section">
      <div class="lh-gb-subhead"><span>Total build-up</span></div>
      <div class="lh-ph-steps lh-gb-steps">
        <div class="lh-ph-step lh-ph-step--head"><span>Step</span><span><span class="d-none d-sm-inline">◂ fewer · more points ▸</span><span class="d-sm-none">◂ − · + ▸</span></span><span>Δ</span><span>Total</span></div>
        <div class="lh-ph-step">
          <span class="lh-ph-name">League-average game<small>average pace, average offense vs average defense</small></span>
          <span class="lh-gb-bar" aria-hidden="true"></span>
          <span class="lh-ph-delta">—</span>
          <span class="lh-ph-run">${gbNum(model.base)}</span>
        </div>
        ${rows}
        <div class="lh-ph-step lh-ph-step--total">
          <span class="lh-ph-name">Model total<small>home edge ±${GB_CONFIG.homeEdge} moves the score, not the total</small></span><span></span><span></span>
          <span class="lh-ph-run">${gbNum(model.total)}</span>
        </div>
        ${odds ? `
        <div class="lh-ph-step lines-only">
          <span class="lh-ph-name">Book total<small>${gbBookName(odds.vendor)}</small></span><span></span>
          <span class="lh-ph-delta lh-gb-delta ${gap >= GB_CONFIG.leanGap ? "is-over" : gap <= -GB_CONFIG.leanGap ? "is-under" : ""}">${gbSigned(gap)}</span>
          <span class="lh-ph-run">${odds.total}</span>
        </div>` : ""}
      </div>
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

async function loadGameBreakdown(game) {
  const body = document.getElementById("gameBreakdownBody");
  renderBreakdownSkeleton();
  try {
    const [current, last, odds] = await Promise.all([
      loadBreakdownSeason(game.season).catch(() => null),
      loadBreakdownSeason(game.season - 1).catch(() => null),
      loadBreakdownOdds(game.id).catch(() => null),
    ]);
    if (!current && !last) {
      body.innerHTML = `<p class="lh-gb-note">Team ratings aren't available yet.</p>`;
      return;
    }
    const ratings = blendRatings(current, last);
    const model = breakdownModel(game, ratings);
    if (!model) {
      body.innerHTML = `<p class="lh-gb-note">Ratings aren't available for these teams.</p>`;
      return;
    }
    const lean = gbLean(model, odds);
    window.lhGameBreakdown = { game, current, last, ratings, model, odds, lean }; // for testing in the console

    body.innerHTML = `
      ${gbScoreHtml(game, model, odds, lean)}
      ${gbStripHtml(game, model, odds, lean)}
      ${gbStepsHtml(model, odds)}
      <p class="lh-gb-note">${gbSourceText(ratings, current, last, game)}</p>`;
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
