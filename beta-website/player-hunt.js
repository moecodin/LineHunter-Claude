// "Add to Hunt List" on the player page: saves whichever pick is selected right now to the Hunt List.
(function () {
  const who = document.querySelector(".rs-who");
  const bet = document.getElementById("dock-bet");
  if (!who || !bet) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "rs-hunt";
  who.after(button);

  const P = window.LEAGUE.player(new URLSearchParams(location.search).get("p"));
  const current = () => {
    const game = document.getElementById("game-select");
    const stat = document.getElementById("stat").value;
    const gameIndex = Number(game.value);
    const line = Number(document.getElementById("line").textContent);
    const side = document.querySelector("#side [aria-checked='true']").dataset.side;
    const sample = P.log.slice(-20);
    const value = (g) => P.stats[stat].parts.reduce((sum, part) => sum + g[part], 0);
    const hits = sample.filter((g) => (side === "Over" ? value(g) > line : value(g) < line)).length;
    const quotes = {};
    window.LEAGUE.BOOKS.forEach((name, book) => {
      quotes[name.toLowerCase().replace(/ /g, "-")] = window.LEAGUE.offers(P, gameIndex, stat, book) ? window.LEAGUE.odds(P, gameIndex, stat, side, line, book) : null;
    });
    const g = P.games[gameIndex];
    return {
      playerId: P.id,
      stat,
      side,
      line,
      hits,
      total: sample.length,
      quotes,
      matchup: `${g.date}|${[P.team, g.opp].sort().join("-")}`,
      url: location.search, // reopens this exact stat, line and side
      player: who.querySelector("h1").textContent.trim(),
      pick: bet.textContent.trim(),
      game: game && game.selectedOptions[0] ? game.selectedOptions[0].textContent.trim() : "",
    };
  };
  const sameAs = (a, b) => a.player === b.player && a.pick === b.pick && a.game === b.game;

  function refresh() {
    if (!window.LH_AUTH.user()) {
      button.textContent = "Add to Hunt List";
      return;
    }
    const saved = window.LH_AUTH.hunts().some((h) => sameAs(h, current()));
    button.classList.toggle("is-saved", saved);
    button.textContent = saved ? "In Hunt List ✓" : "Add to Hunt List";
  }

  button.addEventListener("click", () => {
    if (!window.LH_AUTH.user()) {
      window.LH_MODAL.open("auth");
      return;
    }
    const pick = current();
    const list = window.LH_AUTH.hunts();
    const next = list.some((h) => sameAs(h, pick)) ? list.filter((h) => !sameAs(h, pick)) : [{ ...pick, saved: Date.now() }, ...list];
    if (!window.LH_AUTH.saveHunts(next)) {
      button.textContent = "Couldn't save";
      return;
    }
    document.dispatchEvent(new CustomEvent("lh-hunts-changed"));
    refresh();
  });

  // The pick changes as the stat, line or side changes, and the dock text always follows it.
  document.addEventListener("lh-hunts-changed", refresh);
  new MutationObserver(refresh).observe(bet, { childList: true, characterData: true, subtree: true });
  refresh();
})();
