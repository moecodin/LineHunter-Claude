// LineHunter - js/components/hunt-score.js
// Shared Hunt Score code for the Today page's "Top 5 Hunts" card (js/pages/today.js) and the Hunt Score page (js/pages/hunt-score.js).
// The scores come from the engine at /api/hunt?date=YYYY-MM-DD (netlify/functions/hunt.js): one entry per prop and side, with the
// score, the factors that built it and three "why" sentences. This file downloads it (sessionStorage 10 minutes, like the CDN),
// feeds the sportsbooks' odds to js/data/odds.js, and draws the rows.
//
// Needs js/core/stats.js (bdlGet, PROPS_URL, PROP_CODES), js/data/odds.js, js/data/teams.js (teamBadgeForMatchup),
// js/components/hunt-button.js (huntButtonHtml, huntAttr) and js/components/propChart.js (lineText).

const HUNT_CACHE_PREFIX = "lh-hunt:";
const HUNT_CACHE_MINUTES = 10;
const HUNT_TOP_MIN = 65; // the engine's top hunts need 65+ (CONFIG.topHunts.minScore)
const HUNT_STAT_LABEL = { pts: "PTS", reb: "REB", ast: "AST", "3pm": "3PM", pra: "PRA" };

const huntRequests = {}; // date -> the download in flight, so the tiles and the card share one

// Today in New York, like the engine's default date.
function huntTodayET() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// The engine skips started games, but its answer can be up to 10 minutes old in each cache (function, CDN, sessionStorage),
// so props whose tip-off has passed since are dropped here too (Today's Top 5 Hunts, hunt-score.html, the player page).
function huntWithoutStarted(data) {
  if (!data) return data;
  const live = (prop) => !prop.tipoff || Number.isNaN(Date.parse(prop.tipoff)) || Date.parse(prop.tipoff) > Date.now();
  return {
    ...data,
    props: Array.isArray(data.props) ? data.props.filter(live) : data.props,
    topHunts: Array.isArray(data.topHunts) ? data.topHunts.filter(live) : data.topHunts,
  };
}

// { date, props, topHunts } for a date ("2026-10-26"). Future dates and started games come back as an empty list.
function loadHunts(date) {
  return loadHuntsRaw(date).then(huntWithoutStarted);
}

function loadHuntsRaw(date) {
  const key = `${HUNT_CACHE_PREFIX}${date}`;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || "null");
    if (saved && Date.now() - saved.savedAt < HUNT_CACHE_MINUTES * 60 * 1000) return Promise.resolve(saved.data);
  } catch (error) {
    // storage blocked: download it
  }
  if (!huntRequests[date]) {
    huntRequests[date] = fetch(`/api/hunt?date=${encodeURIComponent(date)}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Hunt Score: status ${response.status}`);
        return response.json();
      })
      .then((data) => {
        try {
          sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
        } catch (error) {
          // storage full or blocked
        }
        return data;
      })
      .finally(() => { delete huntRequests[date]; });
  }
  return huntRequests[date];
}

// The best payouts for the rows: js/data/odds.js may already hold them (the Today page's slate); otherwise one request per game.
async function ensureHuntOdds(list) {
  if (lhOdds.vendors().length > 0) return false;
  const gameIds = [...new Set(list.map((prop) => prop.gameId))];
  const lists = await Promise.all(gameIds.map((id) => bdlGet(`${PROPS_URL}?game_id=${id}`).then((json) => json.data).catch(() => [])));
  lhOdds.ingest(lists.flat());
  return lhOdds.vendors().length > 0;
}

// The usable top list: the engine's topHunts, else nothing.
function huntTopList(data) {
  return data && Array.isArray(data.topHunts) ? data.topHunts : [];
}

// "Over 26.5 PTS"
function huntPickText(prop) {
  return `${prop.side === "under" ? "Under" : "Over"} ${lineText(prop.line)} ${HUNT_STAT_LABEL[prop.stat] || prop.stat.toUpperCase()}`;
}

// "vs WAS" / "@ WAS"
function huntMatchup(prop) {
  return `${prop.home ? "vs" : "@"} ${prop.opp}`;
}

// "7:30 PM"
function huntTipTime(prop) {
  if (!prop.tipoff) return "";
  const time = new Date(prop.tipoff);
  return Number.isNaN(time.getTime()) ? "" : time.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function huntBestOdds(prop) {
  return lhOdds.getOdds(prop.playerId, PROP_CODES[prop.stat] || prop.stat, prop.line, prop.side)[0] || null;
}

// The My Hunts leg (js/core/hunts.js) for a scored prop, with the best odds when a book posts that exact line.
function huntLeg(prop, best = huntBestOdds(prop)) {
  return {
    playerId: prop.playerId, player: prop.player, team: prop.team, opp: prop.opp, gameId: prop.gameId, tipoff: prop.tipoff || null,
    stat: PROP_CODES[prop.stat] || prop.stat, side: prop.side, line: prop.line,
    odds: best ? best.odds : null, book: best ? best.vendor : null, isAlt: false,
  };
}

// The game page with this player's row open on The Board (js/components/board.js), on this prop and side.
function huntRowHref(prop) {
  return `game.html?id=${prop.gameId}&player=${prop.playerId}&prop=${prop.stat}&side=${prop.side}`;
}

function huntOddsHtml(best) {
  return best ? `<span class="lh-odds-chip"><b>${best.odds > 0 ? `+${best.odds}` : best.odds}</b> ${best.book}</span>` : "";
}

// ---------- Factors ----------

const huntOrdinal = (n) => {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
};

// The small grey line under each factor's name ("L5 34 min vs 31"). Uses the numbers the engine sends with each factor.
function huntFactorDetail(factor, prop) {
  switch (factor.key) {
    case "minutes": return Number.isFinite(factor.now) ? `${factor.now} min vs ${factor.base} season` : "";
    case "form": return Number.isFinite(factor.last) ? `last 3 avg ${factor.last}` : "";
    case "opponent": {
      if (!factor.rank) return "";
      const half = factor.of ? factor.rank <= factor.of / 2 : true;
      return `${prop.opp} · ${huntOrdinal(half ? factor.rank : factor.of - factor.rank + 1)} ${half ? "most" : "fewest"} allowed`;
    }
    case "pace": return factor.rank ? `${prop.opp} · ${huntOrdinal(factor.rank)} fastest` : "";
    case "zone": {
      if (!Number.isFinite(factor.extra)) return "";
      const what = prop.stat === "3pm" ? "threes" : "pts";
      return `${factor.extra > 0 ? "+" : factor.extra < 0 ? "−" : "±"}${Math.abs(factor.extra).toFixed(1)} ${what} vs an average defense${factor.zone ? ` · ${factor.zone}` : ""}`;
    }
    case "b2b": return "second night";
    case "market": return Number.isFinite(factor.sim) ? `line ${lineText(factor.line)} vs sim ${factor.sim}` : "";
    case "spread":
      if (factor.gtd) return "game-time decision";
      if (factor.games < 8) return `${factor.games} ${factor.games === 1 ? "game" : "games"} this season`;
      return factor.disagree ? "recent games swing" : "normal range";
    default: return "";
  }
}

const huntPoints = (points) => (points === 0 ? "0" : `${points > 0 ? "+" : "−"}${Math.abs(points).toFixed(1)}`);

// Short chip: "+12.0 Last 10". Help = accent tint, hurt = dashed grey.
function huntChipHtml(factor) {
  const short = { minutes: "Minutes", form: "Form", opponent: "Matchup", zone: "Zones", pace: "Pace", b2b: "Back-to-back", market: "Book line", spread: "Uncertainty" }[factor.key] || factor.label;
  return `<span class="lh-hs-chip${factor.points < 0 ? " is-hurt" : ""}">${huntPoints(factor.points)} ${short}</span>`;
}

// One factor row: label + detail | a bar growing right (helps) or left (hurts) from the middle | points.
function huntFactorRowHtml(factor, prop) {
  const width = Math.min(Math.abs(factor.points) / 12, 1) * 50;
  const detail = huntFactorDetail(factor, prop);
  const tone = factor.points > 0 ? "is-help" : factor.points < 0 ? "is-hurt" : "is-zero";
  return `
    <div class="lh-hs-factor">
      <div class="lh-hs-factor-name"><span>${factor.label}</span>${detail ? `<small>${detail}</small>` : ""}</div>
      <div class="lh-hs-factor-bar" aria-hidden="true"><span class="${tone}" style="width: ${width}%"></span></div>
      <span class="lh-hs-factor-pts ${tone}">${huntPoints(factor.points)}</span>
    </div>`;
}

// ---------- Rows ----------

// Today page: rank | player + team | pick | first "why" sentence | score | + ADD. Phones: player + pick over the score.
function huntCompactRowHtml(prop, rank) {
  const best = huntBestOdds(prop);
  return `
    <div class="lh-hunt-row">
      <span class="lh-hunt-rank">${rank}</span>
      <a class="lh-hunt-player" href="${huntRowHref(prop)}">
        <span class="lh-hunt-name">${prop.player}</span> ${teamBadgeForMatchup(prop.team, huntMatchup(prop))}
        <span class="lh-hunt-pick lh-hunt-pick--${prop.side}">${huntPickText(prop)}</span>
      </a>
      <span class="lh-hunt-why">${prop.why && prop.why[0] ? prop.why[0] : ""}</span>
      <span class="lh-hunt-score" title="Hunt Score">${prop.score}</span>
      <span class="lh-hunt-add">${huntOddsHtml(best)}${huntButtonHtml(huntLeg(prop, best), { labelOut: "ADD", labelIn: "ADDED", iconFirst: true, className: "lh-top-add" })}</span>
    </div>`;
}

// Hunt Score page: the full row from the approved mockup. expanded = the "why" sentences and every factor.
function huntFullRowHtml(prop, rank, expanded) {
  const best = huntBestOdds(prop);
  const factors = [...(prop.factors || [])];
  const top3 = [...factors].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 3);
  const total = factors.reduce((sum, factor) => sum + factor.points, 0);
  const base = Number.isFinite(prop.base) ? prop.base : 50; // the season baseline's score (the sim before any factor)
  const b2b = factors.some((factor) => factor.key === "b2b");
  const tip = huntTipTime(prop);
  const key = `${prop.playerId}-${prop.stat}-${prop.side}`;
  const meterClass = prop.score >= 75 ? "is-high" : "";

  return `
    <article class="lh-hs-row${expanded ? " is-open" : ""}" data-hunt-key="${key}">
      <div class="lh-hs-main">
        <div class="lh-hs-rank">${rank}</div>
        <div class="lh-hs-body">
          <div class="lh-hs-who">
            <a class="lh-hs-name" href="${huntRowHref(prop)}">${prop.player}</a>
            ${teamBadgeForMatchup(prop.team, huntMatchup(prop))}
            <span class="lh-hs-match">${huntMatchup(prop)}${tip ? ` · ${tip}` : ""}</span>
            ${b2b ? `<span class="lh-hs-tag">B2B</span>` : ""}
            ${prop.gtd ? `<span class="lh-hs-tag lh-hs-tag--gtd">GTD</span>` : ""}
          </div>
          <div class="lh-hs-pickline">
            <span class="lh-hs-pick lh-hs-pick--${prop.side}">${huntPickText(prop)}</span>
            ${huntOddsHtml(best)}
          </div>
          <p class="lh-hs-why">${prop.why && prop.why[0] ? prop.why[0] : ""}</p>
          ${expanded ? "" : `
          <div class="lh-hs-chips">
            ${top3.map(huntChipHtml).join("")}
            <button type="button" class="lh-hs-more" data-hunt-toggle="${key}" aria-expanded="false">See all ${factors.length} factors</button>
          </div>`}
        </div>
        <div class="lh-hs-scorebox">
          <span class="lh-hs-score">${prop.score}</span>
          <span class="lh-hs-meter" aria-hidden="true"><span class="${meterClass}" style="width: ${prop.score}%"></span><i style="left: ${HUNT_TOP_MIN}%"></i></span>
          <span class="lh-hs-score-label">Hunt Score</span>
        </div>
      </div>
      ${expanded ? `
      <div class="lh-hs-detail">
        <div class="lh-hs-section">
          <span class="lh-hs-heading">Why</span>
          ${(prop.why || []).slice(1).map((sentence) => `<p>${sentence}</p>`).join("")}
        </div>
        <div class="lh-hs-section">
          <div class="lh-hs-heading-row"><span class="lh-hs-heading">How we got ${prop.score}</span><span>season baseline ${base.toFixed(1)}</span></div>
          ${factors.map((factor) => huntFactorRowHtml(factor, prop)).join("")}
          <div class="lh-hs-total"><span>${base.toFixed(1)} ${total < 0 ? "−" : "+"} ${Math.abs(total).toFixed(1)} = ${(base + total).toFixed(1)}${prop.score !== Math.round(base + total) ? ", kept between 0 and 100" : ", rounded"}${Number.isFinite(prop.chance) ? ` · ${prop.chance}% chance` : ""}</span><strong>${prop.score}</strong></div>
        </div>
        <div class="lh-hs-actions">
          ${huntButtonHtml(huntLeg(prop, best), { labelOut: "ADD TO MY HUNTS", labelIn: "IN MY HUNTS", iconFirst: true, className: "lh-hs-add" })}
          <a href="player.html?id=${prop.playerId}&prop=${prop.stat}&side=${prop.side}">Open player page</a>
          <button type="button" class="lh-hs-more ms-auto" data-hunt-toggle="${key}" aria-expanded="true">Hide factors</button>
        </div>
      </div>` : ""}
    </article>`;
}
