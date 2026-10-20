// LineHunter - js/components/brickCity.js
// "Brick City" card: players on tonight's slate who are shooting poorly in recent form. Shown next to BBQ Chicken in both
// modes (the Hit List grid in lines mode, the Streaks grid in research mode). It uses no extra downloads: js/components/top-hit-rates.js
// adds fg = { l5Made, l5Att, seasonMade, seasonAtt } to every slate.fan entry from the game logs it already has.
//
// A player is listed when their field-goal percentage over the last 5 games is at least 5 points below their season
// percentage, on at least 30 attempts in those 5 games (so a bench player with 6 shots isn't a "cold streak").
// Sorted by the biggest drop. Past results only: shooting rates swing from game to game.
//
// Needs js/components/hit-list.js (shortName) and js/core/stats.js (nothing else).

const BRICK_MIN_L5_ATTEMPTS = 30;
const BRICK_MIN_SEASON_ATTEMPTS = 50;
const BRICK_MIN_DROP = 5; // percentage points below the season rate
const BRICK_MAX_ROWS = 5;

function brickPicks(slate) {
  return (slate.fan || [])
    .filter((player) => player.fg && player.fg.l5Att >= BRICK_MIN_L5_ATTEMPTS && player.fg.seasonAtt >= BRICK_MIN_SEASON_ATTEMPTS)
    .map((player) => {
      const l5 = (player.fg.l5Made / player.fg.l5Att) * 100;
      const season = (player.fg.seasonMade / player.fg.seasonAtt) * 100;
      return { player, l5, season, drop: season - l5 };
    })
    .filter((pick) => pick.drop >= BRICK_MIN_DROP)
    .sort((a, b) => b.drop - a.drop)
    .slice(0, BRICK_MAX_ROWS);
}

function brickLegHtml(pick) {
  const { player } = pick;
  return `
    <a class="lh-hitlist-leg is-stacked" href="game.html?id=${player.gameId}&player=${player.playerId}&prop=pts" title="${player.name} ${player.matchup}">
      <span class="lh-hitlist-name">${shortName(player.name)} ${teamBadgeForMatchup(player.team, player.matchup)}</span>
      <span class="lh-hitlist-proof is-cold">${pick.l5.toFixed(1)}% FG L5</span>
      <span class="lh-hitlist-sub">${player.fg.l5Made}/${player.fg.l5Att} · ${player.seasonLabel || "season"} ${pick.season.toFixed(1)}% · −${pick.drop.toFixed(1)} pts</span>
    </a>`;
}

// The card, in the same look as the other small cards.
function brickCityCardHtml(slate) {
  const picks = brickPicks(slate);
  const legs = picks.length ? picks.map(brickLegHtml).join("") : `<div class="lh-hitlist-empty text-muted">Nobody's shooting cold tonight</div>`;
  return `
    <div class="lh-shelf-item">
      <div class="lh-hitlist-card">
        <div class="lh-hitlist-head"><i class="bi bi-bricks" aria-hidden="true"></i><span>Brick City</span></div>
        <div class="lh-hitlist-blurb">Shooting poorly lately: field-goal % over the last 5 games well below their season rate</div>
        <div class="lh-hitlist-list">${legs}</div>
      </div>
    </div>`;
}
