// LineHunter - js/components/scoutReport.js
// The "Scouting report": a short, plain-words summary of what the site already knows about tonight's game for one player.
// Used by the opened Board row (with a "Best prop" block on top) and by the "Show full report" card on player.html.
//
//   scoutBestProp(candidates)            -> { best, others } from [{ code, line, side, stats }] (the player's props)
//   renderScoutReport(el, ctx)           -> fills el (shows a loading line, then the report)
//     ctx = { gameId, team, opp, gamesNewestFirst: [{ date, minutes, opponent, homeAway, teamScore, opponentScore, stats: { PTS, REB, ... } }],
//             props: [{ code, side, hits, total, line }] (optional, drawn as chips), best (optional), activeCode, odds (optional "-174 DK") }
// Everything the report says is a real number from the API (team season averages, the day's odds, injuries, the games). Nothing is
// scored or predicted here. Data is loaded once per game (memory cache) through bdlGet, which has its own cache too.

const SCOUT_ODDS_URL = "/api/bdl/nba/v2/odds";
const SCOUT_TEAM_URL = "/api/bdl/nba/v1/team_season_averages/general";
const SCOUT_STAT_FIELD = { pts: "opp_pts", reb: "opp_reb", ast: "opp_ast", "3pm": "opp_fg3m", stl: "opp_stl", blk: "opp_blk" };
const SCOUT_STAT_WORD = { pts: "points", reb: "rebounds", ast: "assists", "3pm": "threes", stl: "steals", blk: "blocks" };
const SCOUT_LOW_LINE = ["3pm", "stl", "blk"];
const scoutCache = {}; // gameId -> promise of the game's data

const scoutEsc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function scoutOrd(n) {
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  return `${n}${suffix}`;
}

// "-174 DK" / "+120 FD"
function scoutOddsText(offer) {
  if (!offer || !Number.isFinite(offer.odds)) return "";
  return `${offer.odds > 0 ? "+" : "−"}${Math.abs(offer.odds)} ${offer.book || ""}`.trim();
}

const scoutHitClass = (rate) => (rate >= 75 ? "lh-hr-hi" : rate >= 50 ? "lh-hr-md" : "lh-hr-lo");

// ---------- Best prop ----------

// Highest hit rate among the player's props (each on its better side). Ties: more games, longer streak, the over.
// An Under on a very low line (1.5 or less on 3PM / STL / BLK) counts 15 points lower, like the Board's own ranking.
function scoutBestProp(candidates) {
  const rank = (c) => c.stats.hitRate - (c.side === "under" && c.line <= 1.5 && SCOUT_LOW_LINE.includes(c.code) ? 15 : 0);
  const sorted = candidates.filter((c) => c.stats.totalGames >= 5).sort((a, b) => (rank(b) - rank(a))
    || (b.stats.totalGames - a.stats.totalGames) || (b.stats.streak - a.stats.streak)
    || ((a.side === "over" ? 0 : 1) - (b.side === "over" ? 0 : 1)));
  return { best: sorted[0] || null, all: sorted };
}

// ---------- Data ----------

function scoutRanks(teams, field, higherFirst = true) {
  const entries = Object.entries(teams).filter(([, t]) => Number.isFinite(t[field]));
  entries.sort((a, b) => (higherFirst ? b[1][field] - a[1][field] : a[1][field] - b[1][field]));
  const ranks = {};
  entries.forEach(([id], index) => { ranks[id] = index + 1; });
  return { ranks, of: entries.length };
}

async function scoutLoadTeams(season) {
  const types = ["opponent", "advanced"];
  const lists = await Promise.all(types.map((type) => bdlGetAllPages(`${SCOUT_TEAM_URL}?season=${season}&season_type=regular&type=${type}&per_page=100`)));
  const teams = {};
  lists.forEach((rows) => rows.forEach((row) => {
    teams[row.team.id] = Object.assign(teams[row.team.id] || { abbr: row.team.abbreviation }, row.stats);
  }));
  return Object.keys(teams).length ? teams : null;
}

function scoutDaysBetween(from, to) {
  const utc = (t) => Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10)));
  return Math.round((utc(to) - utc(from)) / 86400000);
}

// One game's report data: { game, teams, odds, rest, injuries } - each part can fail on its own (null).
function scoutLoadGame(gameId) {
  if (scoutCache[gameId]) return scoutCache[gameId];
  scoutCache[gameId] = (async () => {
    const game = (await bdlGet(`${BDL_BASE}/games/${gameId}`)).data;
    const date = game.date.slice(0, 10);
    const season = game.season;
    const ids = [game.home_team.id, game.visitor_team.id];
    const start = new Date(Date.parse(`${date}T12:00:00Z`) - 10 * 86400000).toISOString().slice(0, 10);
    const [teams, odds, injuries, ...recent] = await Promise.all([
      scoutLoadTeams(season).catch(() => null),
      bdlGet(`${SCOUT_ODDS_URL}?game_ids[]=${gameId}`).catch(() => null),
      bdlGetAllPages(`${BDL_BASE}/player_injuries?team_ids[]=${ids[0]}&team_ids[]=${ids[1]}&per_page=100`).catch(() => null),
      ...ids.map((id) => bdlGet(`${BDL_BASE}/games?team_ids[]=${id}&start_date=${start}&end_date=${date}&per_page=25`).catch(() => null)),
    ]);
    const rows = odds ? (odds.data || []).filter((r) => r.spread_home_value !== null && r.total_value !== null) : [];
    const row = rows.find((r) => r.vendor === "draftkings") || rows[0] || null;
    // The day each team last played before this game.
    const lastPlayed = {};
    ids.forEach((id, index) => {
      const played = recent[index] ? (recent[index].data || []).filter((g) => g.status === "Final" && g.date.slice(0, 10) < date) : null;
      lastPlayed[id] = played ? (played.map((g) => g.date.slice(0, 10)).sort().pop() || null) : undefined;
    });
    return {
      game, date, teams,
      odds: row ? { spreadHome: Number(row.spread_home_value), total: Number(row.total_value) } : null,
      lastPlayed, injuries,
    };
  })();
  scoutCache[gameId].catch(() => { delete scoutCache[gameId]; });
  return scoutCache[gameId];
}

// ---------- The lines ----------

function scoutItems(ctx, data) {
  const { game, teams } = data;
  const homeAbbr = game.home_team.abbreviation;
  const isHome = ctx.team === homeAbbr;
  const myId = isHome ? game.home_team.id : game.visitor_team.id;
  const oppId = isHome ? game.visitor_team.id : game.home_team.id;
  const opp = ctx.opp;
  const items = [];

  if (teams && teams[oppId]) {
    const def = scoutRanks(teams, "def_rating", false); // 1 = best defense
    const pts = scoutRanks(teams, "opp_pts", true);     // 1 = allows the most
    const rank = def.ranks[oppId];
    const rating = teams[oppId].def_rating;
    if (rank) {
      const worst = def.of + 1 - rank;
      const allowed = pts.ranks[oppId];
      const ptsText = allowed ? ` and gives up the ${scoutOrd(allowed)}-most points a game (${teams[oppId].opp_pts.toFixed(1)})` : "";
      if (worst <= 10) items.push({ tag: "boost", text: `<b>${opp}'s defense is the ${scoutOrd(worst)}-worst</b> (${rating.toFixed(1)} rating)${ptsText}.`, small: "Matchup · team stats this season" });
      else if (rank <= 10) items.push({ tag: "risk", text: `<b>${opp}'s defense is the ${scoutOrd(rank)}-best</b> (${rating.toFixed(1)} rating)${allowed ? ` and gives up the ${scoutOrd(def.of + 1 - allowed)}-fewest points a game (${teams[oppId].opp_pts.toFixed(1)})` : ""}.`, small: "Matchup · team stats this season" });
      else items.push({ tag: "ctx", text: `<b>${opp}'s defense is middle of the league</b> (${scoutOrd(rank)}-best, ${rating.toFixed(1)} rating).`, small: "Matchup · team stats this season" });
    }
  }

  if (data.odds) {
    const spread = isHome ? data.odds.spreadHome : -data.odds.spreadHome;
    const abs = Math.abs(spread);
    const net = teams && teams[myId] && teams[oppId] ? scoutRanks(teams, "net_rating", true) : null;
    const netText = net && net.ranks[myId] && net.ranks[oppId]
      ? ` with the ${net.ranks[myId] === 1 ? "#1" : `#${net.ranks[myId]}`} net rating (${teams[myId].net_rating >= 0 ? "+" : ""}${teams[myId].net_rating.toFixed(1)}) against ${opp}'s #${net.ranks[oppId]} (${teams[oppId].net_rating >= 0 ? "+" : ""}${teams[oppId].net_rating.toFixed(1)})` : "";
    if (spread <= -10) items.push({ tag: "risk", text: `<b>${ctx.team} is a ${abs}-point favorite</b>${netText}. Blowouts can cut starters' fourth quarters.`, small: `Game · total ${data.odds.total}` });
    else if (spread >= 10) items.push({ tag: "risk", text: `<b>${ctx.team} is a ${abs}-point underdog</b>${netText}. A game that gets away can mean garbage time or a short night.`, small: `Game · total ${data.odds.total}` });
    else items.push({ tag: "ctx", text: spread === 0 ? `<b>The book has it as a pick'em</b>${netText}.` : `<b>${ctx.team} is a ${abs}-point ${spread < 0 ? "favorite" : "underdog"}</b>${netText}. A close game keeps starters on the floor.`, small: `Game · total ${data.odds.total}` });
  }

  const mins = (ctx.gamesNewestFirst || []).filter((g) => g.minutes > 0).map((g) => g.minutes);
  if (mins.length >= 5) {
    const avg = (list) => list.reduce((a, b) => a + b, 0) / list.length;
    const l5 = avg(mins.slice(0, 5));
    const l10 = avg(mins.slice(0, 10));
    const diff = l5 - l10;
    const tag = diff >= 2 ? "boost" : diff <= -2 ? "risk" : "ctx";
    const head = diff >= 2 ? "Minutes are up:" : diff <= -2 ? "Minutes are down:" : "Minutes are steady:";
    items.push({ tag, text: `<b>${head}</b> ${l5.toFixed(1)} over his last 5 against ${l10.toFixed(1)} over his last ${Math.min(10, mins.length)}.`, small: `Role · ${mins.slice(0, 5).join(", ")} in the last 5` });
  }

  if (teams && teams[oppId] && teams[myId]) {
    const pace = scoutRanks(teams, "pace", true); // 1 = fastest
    const a = pace.ranks[oppId];
    const b = pace.ranks[myId];
    if (a && b) {
      const fast = a <= 10 && b <= 10;
      const slow = a > pace.of - 10 && b > pace.of - 10;
      const text = fast ? `<b>Both teams play fast:</b> ${opp} ${scoutOrd(a)}, ${ctx.team} ${scoutOrd(b)} fastest, so extra possessions.`
        : slow ? `<b>Both teams play slow:</b> ${opp} ${scoutOrd(a)}, ${ctx.team} ${scoutOrd(b)} fastest, so fewer possessions.`
          : `<b>Pace is not a factor:</b> ${opp} ${scoutOrd(a)}, ${ctx.team} ${scoutOrd(b)} fastest.`;
      items.push({ tag: fast ? "boost" : slow ? "risk" : "ctx", text, small: "Pace · possessions a game" });
    }
  }

  const last = data.lastPlayed[myId];
  if (last) {
    const days = scoutDaysBetween(last, data.date) - 1;
    const where = isHome ? "at home" : "on the road";
    if (days <= 0) items.push({ tag: "risk", text: `<b>Back-to-back:</b> ${ctx.team} played yesterday and plays ${where} tonight.`, small: "Rest" });
    else items.push({ tag: "ctx", text: `<b>${isHome ? "At home" : "On the road"} on ${days} day${days === 1 ? "" : "s"} of rest.</b> No back-to-back.`, small: "Rest" });
  }

  // Extras (behind "Show more"): who is missing.
  if (data.injuries) {
    const names = (teamId) => data.injuries.filter((i) => i.player && i.player.team_id === teamId && /out|doubtful/i.test(i.status || ""))
      .filter((i) => i.player.id !== ctx.playerId).slice(0, 4).map((i) => `${i.player.first_name.charAt(0)}. ${i.player.last_name}`);
    const mine = names(myId);
    const theirs = names(oppId);
    if (mine.length) items.push({ tag: "ctx", text: `<b>${ctx.team} is missing</b> ${mine.join(", ")} (out or doubtful).`, small: "Teammates · injury report", extra: true });
    if (theirs.length) items.push({ tag: "ctx", text: `<b>${opp} is missing</b> ${theirs.join(", ")} (out or doubtful).`, small: "Opponent · injury report", extra: true });
  }
  return { items, oppId, teams };
}

// ---------- Drawing ----------

function scoutLastGameHtml(ctx) {
  const game = (ctx.gamesNewestFirst || [])[0];
  if (!game) return "";
  const date = new Date(`${game.date.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const result = Number.isFinite(game.teamScore) && Number.isFinite(game.opponentScore) ? `, ${game.teamScore > game.opponentScore ? "W" : "L"} ${game.teamScore}–${game.opponentScore}` : "";
  const cells = [["MIN", game.minutes], ...["PTS", "REB", "AST", "3PM", "BLK", "STL"].map((k) => [k, game.stats ? game.stats[k] : null])].filter(([, v]) => v !== null && v !== undefined);
  return `
    <div class="lh-sr-last">
      <div class="lh-sr-label">Last game · ${date} ${game.homeAway === "away" ? "@" : "vs"} ${scoutEsc(game.opponent || "")}${result}</div>
      <div class="lh-sr-strip">${cells.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>
    </div>`;
}

function scoutBestHtml(ctx, data) {
  const best = ctx.best;
  if (!best) return "";
  const stat = BOARD_STAT_SHORT_FALLBACK(best.code);
  let note = "";
  const field = SCOUT_STAT_FIELD[best.code];
  if (data && data.teams && field) {
    const oppId = scoutItems(ctx, data).oppId;
    const t = data.teams[oppId];
    if (t && Number.isFinite(t[field])) {
      const r = scoutRanks(data.teams, field, true);
      const most = r.ranks[oppId];
      const fewest = r.of + 1 - most;
      const word = SCOUT_STAT_WORD[best.code];
      if (most <= 10 || fewest <= 10) {
        const forOver = best.side === "over";
        const tag = (most <= 10) === forOver ? "boost" : "risk";
        const label = most <= 10 ? `${scoutOrd(most)}-most` : `${scoutOrd(fewest)}-fewest`;
        note = `<p class="lh-sr-note is-${tag}"><span class="lh-sr-topic">Matchup</span><span>${scoutEsc(ctx.opp)} allows the <b>${label} ${word}</b> in the league (${t[field].toFixed(1)} a game).</span></p>`;
      }
    }
  }
  const chips = (ctx.props || []).map((p) => `<span class="lh-sr-chip${p.code === ctx.activeCode ? " is-on" : ""}"><b>${BOARD_STAT_SHORT_FALLBACK(p.code)}</b> ${p.side === "under" ? "Under" : "Over"} <i class="${scoutHitClass(p.rate)}">${p.hits}/${p.total}</i></span>`).join("");
  return `
    <div class="lh-sr-label">Best prop · highest hit rate over the last ${best.total}</div>
    <div class="lh-sr-best is-${best.side}">
      <div>
        <div class="lh-sr-pick">${best.side === "under" ? "Under" : "Over"} ${lineText(best.line)} ${stat}</div>
        <div class="lh-sr-why">${best.streak >= 3 ? `${best.streak} straight ${best.side === "under" ? "unders" : "overs"} · ` : ""}averaging ${formatStatValue(best.average)}${ctx.odds ? ` · best odds ${scoutEsc(ctx.odds)}` : ""}</div>
      </div>
      <div class="lh-sr-rate ${scoutHitClass(best.rate)}">${best.hits}/${best.total}<small>L${best.total}</small></div>
    </div>
    ${note}
    ${chips ? `<div class="lh-sr-chips" aria-label="His other props, best side each">${chips}</div>` : ""}`;
}

function BOARD_STAT_SHORT_FALLBACK(code) {
  return (typeof BOARD_STAT_SHORT !== "undefined" && BOARD_STAT_SHORT[code]) || code.toUpperCase();
}


function scoutReportHtml(ctx, data) {
  const { items } = scoutItems(ctx, data);
  const main = items.filter((i) => !i.extra);
  const extra = items.filter((i) => i.extra);
  // Each line: its topic on the left and a bar on the edge (teal = boost, rose = risk, gray = neutral). "small" is "Topic · detail".
  const row = (i, hidden) => {
    const [topic, ...rest] = i.small.split(" · ");
    const detail = rest.join(" · ");
    return `<div class="lh-sr-item is-${i.tag}${hidden ? " lh-sr-extra" : ""}"${hidden ? " hidden" : ""}><span class="lh-sr-topic">${topic}</span><div><p>${i.text}</p>${detail ? `<small>${detail}</small>` : ""}</div></div>`;
  };
  return `
    ${scoutBestHtml(ctx, data)}
    <div class="lh-sr-rep">
      <h3 class="lh-bd-title">Scouting report</h3>
      ${main.length ? main.map((i) => row(i, false)).join("") : `<p class="lh-sr-empty">Not enough data for this game yet.</p>`}
      ${extra.map((i) => row(i, true)).join("")}
      ${extra.length ? `<button type="button" class="lh-sr-more" data-sr-more>Show ${extra.length} more</button>` : ""}
    </div>
    ${scoutLastGameHtml(ctx)}`;
}

function renderScoutReport(el, ctx) {
  if (!el) return;
  const token = `${ctx.gameId}|${ctx.playerId}|${ctx.activeCode || ""}`;
  el.dataset.srToken = token;
  if (!el.dataset.srDrawn) el.innerHTML = `<p class="lh-sr-empty">Loading the scouting report...</p>`;
  scoutLoadGame(ctx.gameId).then((data) => {
    if (el.dataset.srToken !== token) return;
    const open = el.querySelector(".lh-sr-extra:not([hidden])");
    el.innerHTML = scoutReportHtml(ctx, data);
    el.dataset.srDrawn = "1";
    if (open) el.querySelectorAll(".lh-sr-extra").forEach((n) => { n.hidden = false; });
    const more = el.querySelector("[data-sr-more]");
    if (more) {
      if (open) more.textContent = "Show fewer";
      more.addEventListener("click", () => {
        const items = el.querySelectorAll(".lh-sr-extra");
        const show = items[0].hidden;
        items.forEach((n) => { n.hidden = !show; });
        more.textContent = show ? "Show fewer" : `Show ${items.length} more`;
      });
    }
  }).catch(() => {
    if (el.dataset.srToken === token) el.innerHTML = `<p class="lh-sr-empty">The scouting report isn't available right now.</p>`;
  });
}
