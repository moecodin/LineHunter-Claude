// LineHunter - js/components/zoneMatchup.js
// The "Zone Matchup" card on player.html: where the player shoots, against how an opponent defends each zone.
//
// Real API shape (checked against a live response):
//   GET /nba/v1/team_season_averages/shooting?season=2025&season_type=regular&type=by_zone_opponent&per_page=100
//   -> one row per team (30), data[i].team = { id, abbreviation, full_name, ... },
//      data[i].stats = { "restricted_area_opp_fga": 28.2, "restricted_area_opp_fgm": 18.6, "restricted_area_opp_fg_pct": 0.66,
//                        "in_the_paint_(non-ra)_opp_*", "mid-range_opp_*", "corner_3_opp_*" (left + right together),
//                        "above_the_break_3_opp_*", ... }
//   "opp" = the shots OTHER teams take against that team, so opp_fg_pct is the FG% the team ALLOWS.
//   A season with no data comes back as { data: [] } (2026 does until games are played).
//
// Reuses from js/components/shotChart.js: the player's by_zone numbers and the cached league averages (passed in as shotData),
// plus readShotCache / writeShotCache / SHOT_CACHE_MS / SHOT_NEUTRAL_POINTS / percentText.

// The matchup has five rows: the two corners are combined into one. "parts" = which Shot Chart zones feed the player's share.
const MATCHUP_ZONES = [
  { key: "ra", label: "Restricted Area", phrase: "at the rim", oppField: "restricted_area", parts: ["ra"] },
  { key: "paint", label: "Paint", phrase: "in the paint", oppField: "in_the_paint_(non-ra)", parts: ["paint"] },
  { key: "mid", label: "Mid-Range", phrase: "from mid-range", oppField: "mid-range", parts: ["mid"] },
  { key: "corner", label: "Corner 3", phrase: "from the corners", oppField: "corner_3", parts: ["lc3", "rc3"] },
  { key: "atb", label: "Above the Break 3", phrase: "from above the break", oppField: "above_the_break_3", parts: ["atb"] },
];

const MATCHUP_DIM_SHARE = 0.10;     // rows where the player takes under 10% of their shots fade out
const MATCHUP_VERDICT_POINTS = 0.5; // total weighted difference (in FG% points) needed to say Favorable / Tough
const MATCHUP_BBQ_POINTS = 1.5;     // at or above this the matchup is strongly favorable: "BBQ Chicken" (hoops slang for an easy matchup)
const MATCHUP_TEAMS = 30;

// ---------- Data ----------

// Every team's defense per zone: [{ id, abbr, fullName, zones: { ra: { fga, fgm, pct }, ... } }], cached.
async function loadOpponentZones(season) {
  const key = `lh-opp-zones:${season}`;
  const cached = readShotCache(key);
  if (cached) return cached;

  const rows = await bdlGetAllPages(`${SHOT_TEAM_URL}?season=${season}&season_type=regular&type=by_zone_opponent&per_page=100`);
  const teams = rows.map((row) => {
    const zones = {};
    MATCHUP_ZONES.forEach((zone) => {
      const fga = Number(row.stats[`${zone.oppField}_opp_fga`]) || 0;
      const fgm = Number(row.stats[`${zone.oppField}_opp_fgm`]) || 0;
      const pct = row.stats[`${zone.oppField}_opp_fg_pct`];
      zones[zone.key] = { fga, fgm, pct: fga > 0 && pct !== null && pct !== undefined ? Number(pct) : null };
    });
    return { id: row.team.id, abbr: row.team.abbreviation, fullName: row.team.full_name, zones };
  });
  writeShotCache(key, teams);
  return teams;
}

// ---------- Numbers ----------

// "1st", "2nd", "3rd", "4th", "11th", "21st"...
function ordinal(n) {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}

// The player's share of shots, and the league's FG%, for each of the five matchup rows.
function playerAndLeagueByZone(shotData) {
  const attempts = (zoneKeys) => zoneKeys.reduce((total, key) => total + shotData.zones[key].fga, 0);
  const total = Object.values(shotData.zones).reduce((sum, zone) => sum + zone.fga, 0);
  const result = {};
  MATCHUP_ZONES.forEach((zone) => {
    const leagueMade = zone.parts.reduce((sum, key) => sum + shotData.league[key].fgm, 0);
    const leagueAttempted = zone.parts.reduce((sum, key) => sum + shotData.league[key].fga, 0);
    result[zone.key] = {
      share: total > 0 ? attempts(zone.parts) / total : 0,
      leaguePct: leagueAttempted > 0 ? leagueMade / leagueAttempted : null,
    };
  });
  return result;
}

// One team's rows: its FG% allowed, the league average, its rank (1 = allows the lowest = toughest, 30 = allows the highest).
function buildMatchupRows(shotData, teams, opponent) {
  const mine = playerAndLeagueByZone(shotData);
  return MATCHUP_ZONES.map((zone) => {
    const allowed = opponent.zones[zone.key].pct;
    const sorted = teams.filter((team) => team.zones[zone.key].pct !== null).sort((a, b) => a.zones[zone.key].pct - b.zones[zone.key].pct);
    const position = sorted.findIndex((team) => team.id === opponent.id);
    const leaguePct = mine[zone.key].leaguePct;
    const differencePoints = allowed !== null && leaguePct !== null ? (allowed - leaguePct) * 100 : 0;
    // Allowing more than the league is "over": good for the shooter. Within 2 points = gray.
    let tone = "neutral";
    if (differencePoints > SHOT_NEUTRAL_POINTS) tone = "over";
    if (differencePoints < -SHOT_NEUTRAL_POINTS) tone = "under";
    return {
      ...zone,
      share: mine[zone.key].share,
      allowed,
      leaguePct,
      differencePoints,
      tone,
      rank: position === -1 ? null : position + 1,
      ranked: sorted.length || MATCHUP_TEAMS,
      impact: mine[zone.key].share * differencePoints, // share of shots x how much more (or less) the opponent allows
    };
  });
}

// Favorable / Neutral / Tough, plus one plain sentence about the biggest factor. No predictions.
function matchupVerdict(rows, opponent) {
  const total = rows.reduce((sum, row) => sum + row.impact, 0);
  let label = "Neutral";
  let tone = "neutral";
  let hint = "";
  if (total >= MATCHUP_VERDICT_POINTS) { label = "Favorable"; tone = "over"; }
  if (total >= MATCHUP_BBQ_POINTS) { label = "BBQ Chicken 🍗"; hint = "Hoops slang: an easy matchup."; }
  if (total <= -MATCHUP_VERDICT_POINTS) { label = "Tough"; tone = "under"; }

  const biggest = rows.filter((row) => row.rank !== null).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))[0];
  let sentence = `No zone stands out against ${opponent.abbr}.`;
  if (biggest && biggest.tone !== "neutral") {
    // Rank 1 = allows the fewest. "4th most" = rank 27 of 30.
    const place = biggest.tone === "over" ? biggest.ranked + 1 - biggest.rank : biggest.rank;
    const word = biggest.tone === "over" ? "most" : "fewest";
    const phrase = place === 1 ? `the ${word}` : `the ${ordinal(place)} ${word}`;
    sentence = `Takes ${Math.round(biggest.share * 100)}% of shots ${biggest.phrase}; ${opponent.abbr} allows ${phrase} there.`;
  }
  return { label, tone, sentence, hint };
}

// ---------- Drawing ----------

function matchupRowHtml(row, maxShare) {
  const sharePercent = Math.round(row.share * 100);
  const barWidth = maxShare > 0 ? (row.share / maxShare) * 100 : 0;
  const allowedText = row.allowed === null ? "–" : `${percentText(row.allowed)} · lg ${percentText(row.leaguePct)}`;

  let rankChip = `<span class="lh-zm-rank">–</span>`;
  if (row.rank !== null) {
    const tone = row.rank >= 21 ? "over" : row.rank <= 10 ? "under" : "neutral";
    const meaning = tone === "over" ? "weak defense here" : tone === "under" ? "tough defense here" : "middle of the pack here";
    rankChip = `<span class="lh-zm-rank is-${tone}" title="${ordinal(row.rank)} of ${row.ranked} — ${meaning}">#${row.rank}</span>`;
  }

  return `
    <div class="lh-zm-row${row.share < MATCHUP_DIM_SHARE ? " is-dim" : ""}">
      <div class="lh-zm-zone">${row.label}</div>
      <div class="lh-zm-share" title="${sharePercent}% of this player's shots"><span class="lh-zm-bar"><span style="width: ${barWidth}%"></span></span><span>${sharePercent}%</span></div>
      <div class="lh-zm-allowed is-${row.tone}" title="Opponent FG% allowed vs league average">${allowedText}</div>
      ${rankChip}
    </div>`;
}

function renderMatchup(shotData, teams, opponent) {
  const body = document.getElementById("zoneMatchupBody");
  body.className = "";
  const rows = buildMatchupRows(shotData, teams, opponent);
  const verdict = matchupVerdict(rows, opponent);
  const maxShare = Math.max(...rows.map((row) => row.share));

  body.innerHTML = `
    <div class="lh-zm-verdict">
      <span class="lh-zm-pill is-${verdict.tone}"${verdict.hint ? ` title="${verdict.hint}"` : ""}>${verdict.label}</span>
      <span class="small text-muted">${verdict.sentence}</span>
    </div>
    <div class="lh-zm-head"><span>Zone</span><span>Shot share</span><span>${opponent.abbr} allows</span><span>Rank</span></div>
    ${rows.map((row) => matchupRowHtml(row, maxShare)).join("")}
    <div class="lh-shot-legend">Season totals · Color = vs league average</div>`;
}

// ---------- The card ----------

// shotData = what loadShotChart returned: { season, zones, league } (or null if there was no shot data).
// opponentId = the next game's opponent, or null. ownTeamId = the player's team (left out of the list).
async function loadZoneMatchup(shotData, opponentId, ownTeamId) {
  const body = document.getElementById("zoneMatchupBody");
  const select = document.getElementById("zoneMatchupTeam");
  const note = document.getElementById("zoneMatchupNote");
  const showText = (text) => { body.className = "text-muted small py-4 text-center"; body.textContent = text; };

  if (!shotData) {
    showText("No shot data for this player yet.");
    return;
  }

  try {
    const teams = await loadOpponentZones(shotData.season); // same season as the player's numbers
    const options = teams.filter((team) => team.id !== ownTeamId).sort((a, b) => a.fullName.localeCompare(b.fullName));
    if (options.length === 0) {
      showText("Opponent data is unavailable right now.");
      return;
    }

    // Default: the next game's opponent. No upcoming game: the first team alphabetically.
    const upcoming = options.find((team) => team.id === opponentId);
    const chosen = upcoming || options[0];
    note.textContent = upcoming ? "Next game" : "No upcoming game";

    select.innerHTML = options.map((team) => `<option value="${team.id}">${team.fullName}</option>`).join("");
    select.value = String(chosen.id);
    select.disabled = false;
    select.onchange = () => {
      const picked = options.find((team) => team.id === Number(select.value));
      note.textContent = upcoming && picked.id === upcoming.id ? "Next game" : "";
      renderMatchup(shotData, teams, picked);
    };

    renderMatchup(shotData, teams, chosen);
  } catch (error) {
    console.error("Zone matchup failed:", error);
    showText("Matchup data is unavailable right now.");
  }
}
