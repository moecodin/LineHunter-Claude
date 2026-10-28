// LineHunter - js/pages/hunt.js
// hunt.html: a shared hunt. The link (?h=gameId.playerId.pts.o.19.5_...) only carries ids, so this page loads the games, the players and
// the CURRENT odds, then draws the legs as the same bet tickets as the My Hunts drawer (css: .lh-hleg*).
//   - A leg that is malformed, whose game or player can't be found, or whose player is not on either team of that game is skipped.
//   - Odds = the best current odds across every book (lhOdds.getOdds with vendor null: the visitor's sportsbook filter doesn't apply).
//     Not posted any more: "No longer posted". Game started: a STARTED tag. ALT when the line isn't the book's main line.
//   - The total (Single / Parlay) only uses legs that still have odds.
//   - Tapping a leg opens the game page with that player's row open on The Board.
//   - "Add to My Hunts" adds the legs to the visitor's own slip (one leg per player + stat; the slip is never wiped).
//   - Research mode: a message and a button to switch to line mode.
// Needs js/core/hunts.js, js/data/odds.js, js/core/stats.js, js/components/hunt-button.js (huntStatName) and js/components/my-hunts.js (lhToast).

(() => {
  const el = (id) => document.getElementById(id);
  const escapeText = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const formatAmerican = (odds) => (odds === null || odds === undefined ? "–" : odds > 0 ? `+${odds}` : `${odds}`);

  const wanted = lhHunts.parseShare(new URLSearchParams(window.location.search).get("h"));
  let tickets = null; // the resolved legs, once loaded: [{ leg, drawer, ... }]
  let loading = null;

  function show(which) {
    ["huntLoading", "huntView", "huntBroken"].forEach((id) => { el(id).hidden = id !== which; });
  }

  // ----- data -----
  async function resolveLegs() {
    const gameIds = [...new Set(wanted.map((item) => item.gameId))];
    const playerIds = [...new Set(wanted.map((item) => item.playerId))];
    const [games, players, props] = await Promise.all([
      Promise.all(gameIds.map((id) => bdlGet(`${BDL_BASE}/games/${id}`).then((json) => json.data).catch(() => null))),
      fetchPlayers(playerIds).catch(() => ({})),
      Promise.all(gameIds.map((id) => bdlGet(`${PROPS_URL}?game_id=${id}`).then((json) => json.data).catch(() => null))), // null = couldn't load
    ]);
    const gameById = {};
    const propsByGame = {};
    gameIds.forEach((id, index) => { gameById[id] = games[index]; propsByGame[id] = props[index]; });
    lhOdds.ingest(props.filter(Boolean).flat());

    const result = [];
    wanted.forEach((item) => {
      const game = gameById[item.gameId];
      const player = players[item.playerId];
      if (!game || !player || !player.team) return;
      const teamIds = [game.home_team.id, game.visitor_team.id];
      if (!teamIds.includes(player.team.id)) return; // a prop pinned on someone who isn't in this game
      const away = game.visitor_team.abbreviation;
      const home = game.home_team.abbreviation;
      const team = player.team.abbreviation;
      const tipoff = game.datetime || (/^\d{4}-\d{2}-\d{2}T/.test(game.status || "") ? game.status : game.date) || null;
      const started = game.period > 0 || game.status === "Final" || (tipoff && Date.parse(tipoff) <= Date.now());

      const gameProps = propsByGame[item.gameId];
      const best = gameProps ? lhOdds.getOdds(item.playerId, item.stat, item.line, item.side === "under" ? "under" : "over", null)[0] || null : null;
      const main = gameProps ? pickOneLinePerPlayer(gameProps).find((prop) => prop.player_id === item.playerId && prop.prop_type === item.stat) : null;
      const isAlt = Boolean(main) && Number(main.line_value) !== item.line;
      const code = propCode(item.stat);
      result.push({
        playerId: item.playerId, player: `${player.first_name} ${player.last_name}`, team, opp: team === home ? away : home,
        gameId: item.gameId, tipoff, stat: item.stat, side: item.side, line: item.line,
        matchup: `${away} @ ${home}`, started, isAlt, best, oddsKnown: Boolean(gameProps), code,
      });
    });
    return result;
  }

  // ----- drawing -----
  function ticketHtml(ticket) {
    const side = ticket.side === "under" ? "Under" : "Over";
    const time = ticket.tipoff && !ticket.started
      ? new Date(ticket.tipoff).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
    const open = `game.html?id=${ticket.gameId}&player=${ticket.playerId}&prop=${ticket.code}&side=${ticket.side}`;
    const stub = ticket.best
      ? `<span class="lh-hleg-odds">${formatAmerican(ticket.best.odds)}</span><span class="lh-hleg-book">${escapeText(lhHunts.bookLabel(ticket.best.vendor))}</span>`
      : `<span class="lh-hleg-gone">${ticket.oddsKnown ? "No longer posted" : "Odds unavailable"}</span>`;
    return `
      <li class="lh-hleg lh-hleg--${ticket.side} lh-hleg--link" data-lh-href="${huntAttr(open)}" tabindex="0" role="button" aria-label="Open ${escapeText(ticket.player)}'s ${escapeText(huntStatName(ticket.stat))}">
        <div class="lh-hleg-main">
          <div class="lh-hleg-top">
            <span class="lh-hleg-name">${escapeText(ticket.player)}</span>
            ${ticket.started ? `<span class="lh-hleg-tag">Started</span>` : ""}
          </div>
          <div class="lh-hleg-prop"><span class="lh-hleg-side">${side}</span> ${ticket.line} ${escapeText(huntStatName(ticket.stat))}${ticket.isAlt ? ` <span class="lh-hleg-tag">Alt</span>` : ""}</div>
          <div class="lh-hleg-match">${escapeText([ticket.matchup, time].filter(Boolean).join(" · "))}</div>
        </div>
        <div class="lh-hleg-stub">${stub}</div>
      </li>`;
  }

  function render() {
    if (isResearchMode()) return; // the research section is shown by CSS; nothing is downloaded until line mode
    if (!tickets) {
      show("huntLoading");
      if (!loading) {
        loading = (wanted.length ? resolveLegs() : Promise.resolve([])).then((result) => { tickets = result; }).catch(() => { tickets = []; }).then(render);
      }
      return;
    }
    if (tickets.length === 0) { show("huntBroken"); return; }

    el("huntList").innerHTML = tickets.map(ticketHtml).join("");
    const times = tickets.map((ticket) => Date.parse(ticket.tipoff || "")).filter(Number.isFinite);
    el("huntDate").textContent = times.length ? new Date(Math.min(...times)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";

    const priced = tickets.filter((ticket) => ticket.best);
    el("huntType").textContent = tickets.length > 1 ? "Parlay" : "Single";
    el("huntOdds").textContent = formatAmerican(lhHunts.combinedOdds(priced.map((ticket) => ticket.best.odds)));
    const gone = tickets.length - priced.length;
    el("huntNote").hidden = gone === 0;
    el("huntNote").textContent = gone ? `${gone} ${gone === 1 ? "leg has" : "legs have"} no current odds, so the total only counts the rest.` : "";
    show("huntView");
  }

  // ----- actions -----
  const openLeg = (event) => {
    if (event.type === "keydown" && event.key !== "Enter") return;
    const leg = event.target.closest(".lh-hleg--link");
    if (leg) window.location.href = leg.dataset.lhHref;
  };
  el("huntList").addEventListener("keydown", openLeg);
  el("huntList").addEventListener("click", openLeg);

  el("huntAdd").addEventListener("click", () => {
    if (!tickets || !tickets.length) return;
    tickets.forEach((ticket) => lhHunts.add({
      playerId: ticket.playerId, player: ticket.player, team: ticket.team, opp: ticket.opp, gameId: ticket.gameId, tipoff: ticket.tipoff,
      stat: ticket.stat, side: ticket.side, line: ticket.line,
      odds: ticket.best ? ticket.best.odds : null, book: ticket.best ? ticket.best.vendor : "", isAlt: ticket.isAlt,
    }, { silent: true }));
    window.lhToast(`Added ${tickets.length} to My Hunts`);
  });

  document.addEventListener("lh-mode-change", render);
  render();
})();
