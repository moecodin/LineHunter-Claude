// Shared by the Streak Board and player pages. Works out streaks from PROPS in data.js.
const MARKET_NAMES = { PTS: "Points", REB: "Rebounds", AST: "Assists", "3PM": "3-pointers", PRA: "Pts+Reb+Ast" };

const isHit = (p, value) => (p.dir === "Over" ? value > p.line : value < p.line);

function enrich(p) {
  let streak = 0;
  for (let i = p.games.length - 1; i >= 0 && isHit(p, p.games[i]); i--) streak++;
  const hits = p.games.filter((g) => isHit(p, g)).length;
  const avg = p.games.reduce((a, b) => a + b, 0) / p.games.length;
  const week = p.games.slice(-PAST_WEEK_GAMES).filter((g) => isHit(p, g)).length;
  const cushion = p.dir === "Over" ? avg - p.line : p.line - avg;
  return { ...p, id: p.player.replace(/\W/g, ""), streak, hits, avg, week, cushion };
}

const fmtOdds = (o) => (o > 0 ? `+${o}` : `−${Math.abs(o)}`);
const signed = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;
const MARKET_KEYS = { PTS: "PTS", REB: "REB", AST: "AST", "3PM": "TPM", PRA: "PRA" };
const playerUrl = (p) => `player.html?p=${p.id}&stat=${MARKET_KEYS[p.market]}&side=${p.dir}`;

function chart(p, large = false) {
  const top = Math.max(...p.games, p.line) * 1.12;
  const firstStreak = p.games.length - p.streak;
  const bars = p.games.map((g, i) => {
    const cls = i >= firstStreak ? "bar-streak" : isHit(p, g) ? "bar-hit" : "bar-miss";
    const label = large ? `<span class="bar-val">${g}</span>` : "";
    return `<span class="bar ${cls}" style="--h:${Math.max((g / top) * 100, 2)}%">${label}</span>`;
  }).join("");
  const desc = `Last ${p.games.length} games: ${p.games.join(", ")}. Line ${p.line}. Hit ${p.hits} of ${p.games.length}.`;
  return `<span class="chart${large ? " chart-lg" : ""}" role="img" aria-label="${desc}">${bars}<span class="chart-line" style="--l:${(p.line / top) * 100}%"></span></span>`;
}

function gameLog(p) {
  const rows = p.games.map((g, i) => ({ g, i })).reverse().map(({ g, i }) => `
    <tr class="${isHit(p, g) ? "" : "is-miss"}">
      <td>${GAME_DATES[i]}</td><td>${p.opps[i]}</td><td class="num">${g}</td>
      <td class="num">${isHit(p, g) ? "Hit" : "Miss"}</td>
    </tr>`).join("");
  return `<table class="log">
      <caption class="sr-only">${p.player} game log</caption>
      <thead><tr><th scope="col">Date</th><th scope="col">Opp</th><th scope="col" class="num">${p.market}</th><th scope="col" class="num">vs ${p.line}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}
