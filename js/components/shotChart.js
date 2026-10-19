// LineHunter - js/components/shotChart.js
// The "Shot Chart" card on player.html: a half court split into six zones, each colored by the player's
// FG% against the league average for that zone, plus a "shot diet" bar (share of attempts by zone).
//
// Real API shapes (checked against live responses):
//   Player:  GET /nba/v1/season_averages/shooting?season=2025&season_type=regular&type=by_zone&player_ids[]=73
//            -> data[0].stats = { "restricted_area_fga": 2.8, "restricted_area_fgm": 1.8, "restricted_area_fg_pct": 0.638, ... }
//   League:  GET /nba/v1/team_season_averages/shooting?season=2025&season_type=regular&type=by_zone_base&per_page=100
//            -> data[i].stats = the same field names, one row per team (30 teams)
//   Zone field prefixes: restricted_area, in_the_paint_(non-ra), mid-range, left_corner_3, right_corner_3, above_the_break_3.
//   fga / fgm are PER GAME averages and fg_pct is a fraction (0.638). A season with no data comes back as { data: [] }.
//
// Needs js/core/stats.js (bdlGet, bdlGetAllPages, currentSeasonYear).
// loadLeagueZones() is global on purpose: the Zone Matchup card reuses it.

const SHOT_SEASON_URL = "/api/bdl/nba/v1/season_averages/shooting";
const SHOT_TEAM_URL = "/api/bdl/nba/v1/team_season_averages/shooting";
const SHOT_CACHE_MS = 60 * 60 * 1000; // season numbers barely change: keep them an hour
const SHOT_NEUTRAL_POINTS = 2;        // within 2 percentage points of the league = gray

// key / label / the prefix the API uses for that zone's fields.
const SHOT_ZONES = [
  { key: "ra", label: "Restricted Area", short: "RA", field: "restricted_area" },
  { key: "paint", label: "Paint (non-RA)", short: "Paint", field: "in_the_paint_(non-ra)" },
  { key: "mid", label: "Mid-Range", short: "Mid", field: "mid-range" },
  { key: "lc3", label: "Left Corner 3", short: "L Corner", field: "left_corner_3" },
  { key: "rc3", label: "Right Corner 3", short: "R Corner", field: "right_corner_3" },
  { key: "atb", label: "Above the Break 3", short: "Above Break", field: "above_the_break_3" },
];

// ---------- Cache ----------

function readShotCache(key) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    return saved && Date.now() - saved.savedAt < SHOT_CACHE_MS ? saved.data : null;
  } catch (error) {
    return null;
  }
}

function writeShotCache(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch (error) {
    // storage full or blocked: it just won't be cached
  }
}

// ---------- Data ----------

// { ra: { fga, fgm, pct }, paint: {...}, ... } from one "stats" object. pct is a fraction, or null with no attempts.
function zonesFromStats(stats) {
  const zones = {};
  SHOT_ZONES.forEach((zone) => {
    const fga = Number(stats[`${zone.field}_fga`]) || 0;
    const fgm = Number(stats[`${zone.field}_fgm`]) || 0;
    const pct = stats[`${zone.field}_fg_pct`];
    zones[zone.key] = { fga, fgm, pct: fga > 0 && pct !== null && pct !== undefined ? Number(pct) : null };
  });
  return zones;
}

// One player's zones for one season, or null if the API has nothing for that season.
async function fetchPlayerZones(playerId, season) {
  const key = `lh-shot-zones:${playerId}:${season}`;
  const cached = readShotCache(key);
  if (cached) return cached.empty ? null : cached.zones;

  const json = await bdlGet(`${SHOT_SEASON_URL}?season=${season}&season_type=regular&type=by_zone&player_ids[]=${playerId}`);
  const row = json.data && json.data[0];
  const zones = row ? zonesFromStats(row.stats) : null;
  writeShotCache(key, zones ? { zones } : { empty: true });
  return zones;
}

// The league's FG% for each zone: every team's makes added up / every team's attempts added up
// (so a team that shoots a zone more counts for more). Same shape as zonesFromStats. Cached for the Zone Matchup card.
async function loadLeagueZones(season) {
  const key = `lh-league-zones:${season}`;
  const cached = readShotCache(key);
  if (cached) return cached;

  const teams = await bdlGetAllPages(`${SHOT_TEAM_URL}?season=${season}&season_type=regular&type=by_zone_base&per_page=100`);
  const league = {};
  SHOT_ZONES.forEach((zone) => {
    let made = 0;
    let attempted = 0;
    teams.forEach((team) => {
      made += Number(team.stats[`${zone.field}_fgm`]) || 0;
      attempted += Number(team.stats[`${zone.field}_fga`]) || 0;
    });
    league[zone.key] = { fga: attempted, fgm: made, pct: attempted > 0 ? made / attempted : null };
  });
  writeShotCache(key, league);
  return league;
}

// ---------- The court (SVG) ----------
// Drawn in "feet x 10", baseline at the bottom (y = 470), basket at (250, 417.5). The 3-point corners are drawn a
// little wider than real life, so the corner zones are big enough to read.
const COURT_ARC_Y = 252.7; // where the 3-point arc meets the corner lines
const ZONE_SHAPES = {
  ra: `<circle cx="250" cy="417.5" r="40"/>`,
  paint: `<path fill-rule="evenodd" d="M170,280 H330 V470 H170 Z M290,417.5 A40,40 0 1 0 210,417.5 A40,40 0 1 0 290,417.5 Z"/>`,
  mid: `<path d="M62,470 V${COURT_ARC_Y} A250,250 0 0 1 438,${COURT_ARC_Y} V470 H330 V280 H170 V470 Z"/>`,
  lc3: `<path d="M0,${COURT_ARC_Y} H62 V470 H0 Z"/>`,
  rc3: `<path d="M438,${COURT_ARC_Y} H500 V470 H438 Z"/>`,
  atb: `<path d="M0,0 H500 V${COURT_ARC_Y} H438 A250,250 0 0 0 62,${COURT_ARC_Y} H0 Z"/>`,
};
// Where each zone's text sits: [x, y of the big FG%], and a smaller font for the corners.
const ZONE_LABELS = {
  ra: { x: 250, y: 396, big: 17, small: 11 },
  paint: { x: 250, y: 326, big: 20, small: 12 },
  mid: { x: 250, y: 222, big: 22, small: 13 },
  lc3: { x: 31, y: 360, big: 15, small: 10 },
  rc3: { x: 469, y: 360, big: 15, small: 10 },
  atb: { x: 250, y: 90, big: 24, small: 14 },
};

// "over", "under" or "neutral": the player's FG% against the league's, with a 2 point gray band.
function zoneTone(playerPct, leaguePct) {
  if (playerPct === null || leaguePct === null) return "neutral";
  const difference = (playerPct - leaguePct) * 100;
  if (difference > SHOT_NEUTRAL_POINTS) return "over";
  if (difference < -SHOT_NEUTRAL_POINTS) return "under";
  return "neutral";
}

const percentText = (fraction) => (fraction === null ? "–" : `${Math.round(fraction * 100)}%`);

// Everything the court and the bar need, per zone: numbers, tone, share of shots.
function buildZoneView(player, league) {
  const totalAttempts = SHOT_ZONES.reduce((total, zone) => total + player[zone.key].fga, 0);
  return SHOT_ZONES.map((zone) => ({
    ...zone,
    ...player[zone.key],
    leaguePct: league[zone.key].pct,
    tone: zoneTone(player[zone.key].pct, league[zone.key].pct),
    share: totalAttempts > 0 ? player[zone.key].fga / totalAttempts : 0,
  }));
}

function courtSvg(view) {
  const lines = `
    <g class="lh-court-lines">
      <path d="M0,0 H500 V470 H0 Z"/>
      <path d="M190,280 A60,60 0 0 1 310,280"/>
      <path d="M190,280 A60,60 0 0 0 310,280" stroke-dasharray="4 5"/>
      <path d="M220,430 H280"/>
      <circle cx="250" cy="417.5" r="7.5"/>
    </g>`;
  const zones = view.map((zone) => `
    <g class="lh-shot-zone is-${zone.tone}" data-zone="${zone.key}" tabindex="0" role="img"
       aria-label="${zone.label}: ${percentText(zone.pct)}, league ${percentText(zone.leaguePct)}">${ZONE_SHAPES[zone.key]}</g>`).join("");
  const labels = view.map((zone) => {
    const spot = ZONE_LABELS[zone.key];
    return `
    <text class="lh-shot-pct" x="${spot.x}" y="${spot.y}" font-size="${spot.big}">${percentText(zone.pct)}</text>
    <text class="lh-shot-made" x="${spot.x}" y="${spot.y + spot.small + 3}" font-size="${spot.small}">${zone.fga > 0 ? `${zone.fgm.toFixed(1)}/${zone.fga.toFixed(1)}` : ""}</text>`;
  }).join("");
  return `<svg class="lh-shot-court" viewBox="-3 -3 506 476" role="group" aria-label="Half court shot chart">${lines}${zones}${labels}</svg>`;
}

// The stacked bar: each zone's share of attempts, in the zone's color.
function dietBarHtml(view) {
  const segments = view.filter((zone) => zone.share > 0).map((zone) => {
    const percent = Math.round(zone.share * 100);
    const text = zone.share >= 0.1 ? `<span>${zone.short}</span><strong>${percent}%</strong>` : zone.share >= 0.04 ? `<strong>${percent}%</strong>` : "";
    return `<div class="lh-diet-seg is-${zone.tone}" style="flex-grow: ${zone.share}" title="${zone.label}: ${percent}% of shots">${text}</div>`;
  }).join("");
  return `<div class="lh-diet" role="img" aria-label="Share of shot attempts by zone">${segments}</div>`;
}

// ---------- The card ----------

function seasonLabel(year) {
  return `${year}-${String(year + 1).slice(2)}`;
}

// Fills #shotChartBody and #shotChartSeason. Tries this season, then last season (the same fallback as the logs).
// Returns { season, zones, league } for the Zone Matchup card, or null if there was no data.
async function loadShotChart(playerId) {
  const body = document.getElementById("shotChartBody");
  const badge = document.getElementById("shotChartSeason");
  const showText = (text) => { body.innerHTML = `<div class="text-muted small py-4 text-center">${text}</div>`; };

  try {
    let season = currentSeasonYear();
    let zones = await fetchPlayerZones(playerId, season);
    if (!zones) {
      season -= 1;
      zones = await fetchPlayerZones(playerId, season);
    }
    if (!zones || SHOT_ZONES.every((zone) => zones[zone.key].fga === 0)) {
      showText("No shot data for this player yet.");
      return null;
    }

    const league = await loadLeagueZones(season); // same season as the player, so the comparison is fair
    const view = buildZoneView(zones, league);
    badge.textContent = season === currentSeasonYear() ? `${seasonLabel(season)} season` : "Last season";

    body.innerHTML = `
      <div class="lh-shot-wrap">
        ${courtSvg(view)}
        <div class="lh-chart-tooltip lh-shot-tip" hidden></div>
      </div>
      <div class="lh-label mt-3 mb-2">Shot diet</div>
      ${dietBarHtml(view)}
      <div class="lh-shot-legend">Color = vs league average · Season averages per game</div>`;
    setUpZoneTooltip(body, view);
    return { season, zones, league };
  } catch (error) {
    console.error("Shot chart failed:", error);
    showText("Shot data is unavailable right now.");
    return null;
  }
}

// Hover (or tap / keyboard focus) a zone: its name, FG% against the league, and its share of shots.
function setUpZoneTooltip(body, view) {
  const wrap = body.querySelector(".lh-shot-wrap");
  const tip = body.querySelector(".lh-shot-tip");

  const show = (zone, x, y) => {
    const info = view.find((item) => item.key === zone.dataset.zone);
    const difference = info.pct !== null && info.leaguePct !== null ? Math.round((info.pct - info.leaguePct) * 100) : null;
    tip.innerHTML = `
      <div class="lh-tip-title">${info.label}</div>
      <div>${percentText(info.pct)} · league ${percentText(info.leaguePct)}${difference === null ? "" : ` (${difference > 0 ? "+" : ""}${difference})`}</div>
      <div>${Math.round(info.share * 100)}% of shots · ${info.fga > 0 ? `${info.fgm.toFixed(1)}/${info.fga.toFixed(1)} per game` : "no attempts"}</div>`;
    tip.hidden = false;
    const box = wrap.getBoundingClientRect();
    const left = Math.min(Math.max(x - box.left - tip.offsetWidth / 2, 0), box.width - tip.offsetWidth);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(y - box.top - tip.offsetHeight - 12, 0)}px`;
  };

  wrap.querySelectorAll(".lh-shot-zone").forEach((zone) => {
    zone.addEventListener("pointermove", (event) => show(zone, event.clientX, event.clientY));
    zone.addEventListener("pointerdown", (event) => show(zone, event.clientX, event.clientY)); // tap on phones
    zone.addEventListener("pointerleave", (event) => { if (event.pointerType !== "touch") tip.hidden = true; });
    zone.addEventListener("focus", () => {
      const spot = zone.getBoundingClientRect();
      show(zone, spot.left + spot.width / 2, spot.top + spot.height / 2);
    });
    zone.addEventListener("blur", () => { tip.hidden = true; });
  });
  // Tapping anywhere outside the court closes a tap-opened tooltip.
  document.addEventListener("pointerdown", (event) => {
    if (!wrap.contains(event.target)) tip.hidden = true;
  });
}
