// LineHunter - js/core/hunts.js
// "My Hunts": the bet slip's storage. No drawing here (js/components/my-hunts.js draws the drawer, js/components/hunt-button.js
// the "+" buttons). Every change fires the "lh-hunts-change" event on document, so any part of the page can follow along.
//
// A leg: { id, playerId, player, team, opp, gameId, tipoff, stat, side, line, odds, book, isAlt, addedAt }
//   id     = "playerId-stat-side-line", e.g. "237-points-over-24.5"
//   stat   = the prop type as the API names it ("points", "threes", "points_rebounds_assists", ...)
//   odds   = American odds as a number (-110, +120), or null when we don't have them (alt lines, no book odds)
// Rule: one leg per player + stat. Adding the other side or another line replaces the old leg (detail.replaced says which).
//
// Saved in localStorage under "lh-hunts". Every read and write is wrapped in try/catch: when storage is blocked the slip
// still works in memory for the visit.

const lhHunts = (() => {
  const KEY = "lh-hunts";
  let legs = [];

  const read = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(saved) ? saved.filter((leg) => leg && leg.id) : [];
    } catch (error) {
      return [];
    }
  };
  const write = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(legs));
    } catch (error) {
      // storage full or blocked: the slip lives in memory for this visit
    }
  };
  legs = read();

  const legId = (leg) => `${leg.playerId}-${leg.stat}-${leg.side}-${Number(leg.line)}`;
  const emit = (action, detail = {}) => document.dispatchEvent(new CustomEvent("lh-hunts-change", { detail: { action, ...detail } }));
  const cleanOdds = (odds) => (odds === null || odds === undefined || odds === "" || Number.isNaN(Number(odds)) ? null : Number(odds));

  // Another tab changed the slip: pick it up here too.
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY) return;
    legs = read();
    emit("sync");
  });

  // Short, text-only labels for the sportsbooks (the API's vendor name -> "DK"). Unknown vendors get their first letters.
  const BOOK_LABELS = {
    draftkings: "DK", fanduel: "FD", betmgm: "MGM", caesars: "CZR", betrivers: "BR", bet365: "365", fanatics: "FAN",
    espnbet: "ESPN", espn_bet: "ESPN", hardrock: "HR", hardrockbet: "HR", ballybet: "BALLY", betparx: "PARX", pointsbet: "PB",
    unibet: "UNI", williamhill: "WH", fliff: "FLIFF", prizepicks: "PP", underdog: "UD", sleeper: "SLP", novig: "NOVIG",
  };
  const bookLabel = (book) => {
    if (!book) return "";
    const key = String(book).toLowerCase().replace(/[^a-z0-9_]/g, "");
    return BOOK_LABELS[key] || String(book).replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase();
  };

  return {
    bookLabel,
    getAll: () => legs.map((leg) => ({ ...leg })),
    count: () => legs.length,
    idFor: legId,
    // has(id) or has({ playerId, stat, side, line })
    has: (idOrLeg) => legs.some((leg) => leg.id === (typeof idOrLeg === "string" ? idOrLeg : legId(idOrLeg))),

    add(input) {
      const leg = {
        playerId: Number(input.playerId),
        player: input.player || "",
        team: input.team || "",
        opp: input.opp || "",
        gameId: input.gameId ?? null,
        tipoff: input.tipoff || null,
        stat: input.stat,
        side: input.side === "under" ? "under" : "over",
        line: Number(input.line),
        odds: cleanOdds(input.odds),
        book: input.book || "",
        isAlt: Boolean(input.isAlt),
        addedAt: new Date().toISOString(),
      };
      leg.id = legId(leg);
      if (legs.some((item) => item.id === leg.id)) return null; // already in the slip

      // One leg per player + stat: the other side or another line replaces it.
      const replaced = legs.find((item) => item.playerId === leg.playerId && item.stat === leg.stat) || null;
      legs = legs.filter((item) => item !== replaced);
      legs.push(leg);
      write();
      emit("add", { leg, replaced });
      return leg;
    },

    remove(id) {
      const removed = legs.find((leg) => leg.id === id);
      if (!removed) return;
      legs = legs.filter((leg) => leg.id !== id);
      write();
      emit("remove", { leg: removed });
    },

    clear() {
      legs = [];
      write();
      emit("clear");
    },
  };
})();
