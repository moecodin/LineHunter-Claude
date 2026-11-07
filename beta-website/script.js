const MARKET_NAMES = { PTS: "Points", REB: "Rebounds", AST: "Assists", "3PM": "3-pointers", PRA: "Pts+Reb+Ast" };
const TOP_COUNT = 10;

const isHit = (p, value) => (p.dir === "Over" ? value > p.line : value < p.line);

function enrich(p) {
  let streak = 0;
  for (let i = p.games.length - 1; i >= 0 && isHit(p, p.games[i]); i--) streak++;
  const hits = p.games.filter((g) => isHit(p, g)).length;
  const avg = p.games.reduce((a, b) => a + b, 0) / p.games.length;
  const week = p.games.slice(-PAST_WEEK_GAMES).filter((g) => isHit(p, g)).length;
  const cushion = (p.dir === "Over" ? avg - p.line : p.line - avg);
  return { ...p, streak, hits, avg, week, cushion };
}

const byStreak = (a, b) => b.streak - a.streak || b.cushion - a.cushion;
const ALL = PROPS.map(enrich).sort(byStreak);

const state = { open: null };
const $ = (id) => document.getElementById(id);

const fmtOdds = (o) => (o > 0 ? `+${o}` : `−${Math.abs(o)}`);
const propText = (p) => `${p.dir} ${p.line} ${p.market}`;
const initials = (name) => name.split(" ").map((w) => w[0]).join("");

function chart(p) {
  const top = Math.max(...p.games, p.line) * 1.12;
  const firstStreak = p.games.length - p.streak;
  const bars = p.games.map((g, i) => {
    const hit = isHit(p, g);
    const cls = i >= firstStreak ? "bar-streak" : hit ? "bar-hit" : "bar-miss";
    const h = Math.max((g / top) * 100, 2);
    return `<span class="bar ${cls}" style="--h:${h}%;--i:${i}" title="${GAME_DATES[i]} vs ${p.opps[i]}: ${g}"></span>`;
  }).join("");
  const desc = `Last ${p.games.length} games: ${p.games.join(", ")}. Line ${p.line}. Hit ${p.hits} of ${p.games.length}.`;
  return `<span class="chart" role="img" aria-label="${desc}">
    ${bars}<span class="chart-line" style="--l:${(p.line / top) * 100}%"></span>
  </span>`;
}

function detail(p) {
  const rows = p.games.map((g, i) => ({ g, i })).reverse().map(({ g, i }) => `
    <tr class="${isHit(p, g) ? "" : "is-miss"}">
      <td>${GAME_DATES[i]}</td><td>${p.opps[i]}</td><td class="num">${g}</td>
      <td class="num">${isHit(p, g) ? "Hit" : "Miss"}</td>
    </tr>`).join("");
  return `
    <div class="detail-grid">
      <dl class="detail-stats">
        <div><dt>Next game</dt><dd>${p.next}</dd></div>
        <div><dt>Hit rate, last 8</dt><dd>${p.hits}/${p.games.length}</dd></div>
        <div><dt>Avg vs line</dt><dd>${p.cushion >= 0 ? "+" : "−"}${Math.abs(p.cushion).toFixed(1)}</dd></div>
        <div><dt>Market</dt><dd>${MARKET_NAMES[p.market]}</dd></div>
      </dl>
      <table class="log">
        <caption class="sr-only">${p.player} game log</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Opp</th><th scope="col" class="num">${p.market}</th><th scope="col" class="num">vs ${p.line}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderRows() {
  $("rows").innerHTML = ALL.slice(0, TOP_COUNT).map((p, idx) => {
    const id = p.player.replace(/\W/g, "");
    const open = state.open === id;
    return `
    <li class="row${open ? " is-open" : ""}">
      <div class="row-main">
        <button type="button" class="row-open" data-id="${id}" aria-expanded="${open}" aria-controls="d-${id}" aria-label="Show stats for ${p.player}"></button>
        <span class="c-rank">${idx + 1}</span>
        <span class="c-player">
          <span class="avatar" aria-hidden="true">${initials(p.player)}</span>
          <span><a class="name" href="player.html?p=${id}&stat=${({ "3PM": "TPM" })[p.market] || p.market}&side=${p.dir}">${p.player}</a><span class="meta">${p.team} &middot; ${p.pos}</span></span>
        </span>
        <span class="c-prop"><span class="dir dir-${p.dir.toLowerCase()}">${p.dir}</span> ${p.line} ${p.market}</span>
        <span class="c-streak"><strong>${p.streak}</strong><span class="unit">games</span></span>
        <span class="c-chart">${chart(p)}</span>
        <span class="c-stat c-week" data-label="Past wk">${p.week}/${PAST_WEEK_GAMES}</span>
        <span class="c-stat c-avg" data-label="L8 avg">${p.avg.toFixed(1)}</span>
        <span class="c-stat c-odds" data-label="Odds">${fmtOdds(p.odds)}</span>
        <span class="c-chev" aria-hidden="true"></span>
      </div>
      <div class="detail" id="d-${id}" ${open ? "" : "hidden"}>${open ? detail(p) : ""}</div>
    </li>`;
  }).join("");
}

if ($("rows")) $("rows").addEventListener("click", (e) => {
  const b = e.target.closest(".row-open");
  if (!b) return;
  state.open = state.open === b.dataset.id ? null : b.dataset.id;
  $("rows").classList.add("no-rise"); // the bars only rise on first load
  renderRows();
  document.querySelector(`.row-open[data-id="${b.dataset.id}"]`).focus();
});

function renderFeatured() {
  $("featured").innerHTML = FEATURED.map(({ player, tag }) => {
    const p = ALL.find((x) => x.player === player);
    const id = p.player.replace(/\W/g, "");
    const game = GAMES_TODAY.find((g) => g.home === p.team || g.away === p.team);
    const matchup = game.home === p.team ? `vs ${game.away}` : `at ${game.home}`;
    return `
    <li class="fp">
      <a class="fp-link" href="player.html?p=${id}&stat=${({ "3PM": "TPM" })[p.market] || p.market}&side=${p.dir}" data-wipe>
        <span class="fp-tag${tag === "Superstar" ? " is-star" : ""}">${tag}</span>
        <span class="fp-who">
          <span class="avatar" aria-hidden="true">${initials(p.player)}</span>
          <span><b>${p.player}</b><span class="meta">${p.team} &middot; ${p.pos}</span></span>
        </span>
        <span class="fp-avg"><strong>${p.avg.toFixed(1)}</strong><span>${p.market}, last 8 average</span></span>
        <span class="fp-prop"><span class="dir dir-${p.dir.toLowerCase()}">${p.dir}</span> ${p.line} ${p.market} &middot; ${p.streak} straight</span>
        <span class="fp-game">${matchup}, ${game.time}</span>
      </a>
    </li>`;
  }).join("");
}

if ($("featured")) renderFeatured();

if ($("rows")) {
  $("see-all").textContent = `See all ${ALL.length} streaks`;
  renderRows();
}
