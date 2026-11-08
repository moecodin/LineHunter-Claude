// LineHunter - js/components/gameModelList.js
// "Game model" on the beta Hunt Score page (hunt-score.html): Model picks for every game of the day, moved off the game page while
// the model is in testing. One row per game that hasn't started: the matchup, the projected score, the spread pick and the total
// pick (each with its strength and the model vs book numbers), and a link to the game page. Uses gameModelFor() from
// js/components/gameBreakdown.js (the same numbers the Game Breakdown showed); one game at a time, so the API isn't flooded.
//
//   renderGameModelList(date)   date = "YYYY-MM-DD" (the page's date)

async function renderGameModelList(date) {
  const host = document.getElementById("gameModelList");
  if (!host || typeof gameModelFor !== "function") return;
  try {
    const json = await bdlGet(`${BDL_BASE}/games?start_date=${date}&end_date=${date}&per_page=25`);
    const games = (json.data || [])
      .filter((game) => !(typeof gameHasStarted === "function" && gameHasStarted(game)))
      .sort((a, b) => new Date(a.datetime || a.date) - new Date(b.datetime || b.date) || a.id - b.id);
    if (!games.length) {
      host.innerHTML = `<p class="text-muted py-3 mb-0">No games left to model on this day.</p>`;
      return;
    }
    host.innerHTML = games.map((game) => `
      <a class="lh-gm-row" href="game.html?id=${game.id}" data-gm="${game.id}">
        <span class="lh-gm-match"><b>${game.visitor_team.abbreviation} @ ${game.home_team.abbreviation}</b><small>${gmTime(game)}</small></span>
        <span class="lh-gm-cell lh-gm-score"><small>Projected</small><b>…</b></span>
        <span class="lh-gm-cell"><small>Spread pick</small><b>…</b></span>
        <span class="lh-gm-cell"><small>Total pick</small><b>…</b></span>
        <i class="bi bi-chevron-right lh-gm-chev" aria-hidden="true"></i>
      </a>`).join("");
    for (const game of games) {
      const row = host.querySelector(`[data-gm="${game.id}"]`);
      try {
        const result = await gameModelFor(game);
        row.outerHTML = gmRowHtml(game, result);
      } catch (error) {
        row.querySelectorAll(".lh-gm-cell b").forEach((cell) => { cell.textContent = "–"; });
      }
    }
  } catch (error) {
    host.innerHTML = `<p class="text-muted py-3 mb-0">The game model is unavailable right now.</p>`;
  }
}

function gmTime(game) {
  const tip = new Date(game.datetime || game.date);
  return Number.isNaN(tip.getTime()) ? "" : tip.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function gmRowHtml(game, result) {
  const a = game.visitor_team.abbreviation;
  const h = game.home_team.abbreviation;
  if (!result || result.error) {
    return `
      <a class="lh-gm-row" href="game.html?id=${game.id}" data-gm="${game.id}">
        <span class="lh-gm-match"><b>${a} @ ${h}</b><small>${gmTime(game)}</small></span>
        <span class="lh-gm-cell lh-gm-wide"><small>${result && result.error ? result.error : "No model for this game yet."}</small></span>
        <i class="bi bi-chevron-right lh-gm-chev" aria-hidden="true"></i>
      </a>`;
  }
  const { model, picks, odds } = result;
  const pick = (p, extra) => (p
    ? `<b>${p.text}${p.strength && !p.even ? ` <span class="lh-gm-str is-${String(p.strength).toLowerCase()}">${p.strength}</span>` : ""}</b><small>${extra}</small>`
    : `<b>–</b><small>No line yet</small>`);
  const margin = model.homePts - model.awayPts;
  const modelSpread = Math.abs(margin) < 0.05 ? "Even" : `${margin > 0 ? h : a} −${gbNum(Math.abs(margin))}`;
  return `
      <a class="lh-gm-row" href="game.html?id=${game.id}" data-gm="${game.id}">
        <span class="lh-gm-match"><b>${a} @ ${h}</b><small>${gmTime(game)}</small></span>
        <span class="lh-gm-cell lh-gm-score"><small>Projected</small><b>${a} ${gbNum(model.awayPts)} – ${gbNum(model.homePts)} ${h}</b></span>
        <span class="lh-gm-cell lines-only">${pick(picks && picks.spread, `Model ${modelSpread}${picks && picks.spread && !picks.spread.even ? ` · gap ${gbNum(picks.spread.gap)}` : ""}`)}</span>
        <span class="lh-gm-cell lines-only">${pick(picks && picks.total, `Model ${gbNum(model.total)}${odds ? ` · book ${odds.total}` : ""}`)}</span>
        <i class="bi bi-chevron-right lh-gm-chev" aria-hidden="true"></i>
      </a>`;
}
