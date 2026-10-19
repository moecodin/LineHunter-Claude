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
// Share links: /hunt.html?h=LEG_LEG_LEG, each leg = gameId.playerId.code.side.line, e.g. 21717856.237.pts.o.19.5
// (code = pts / reb / ast / 3pm / pra, side = o or u; the line keeps its own dot, so a leg is split on the first four dots only).
// lhHunts.shareLink(legs) builds it, lhHunts.parseShare(text) reads it back (malformed legs are skipped), lhHunts.combinedOdds(list)
// is the parlay math (American odds in, American odds out).
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

  // ----- share links -----
  const STAT_CODES = { points: "pts", rebounds: "reb", assists: "ast", threes: "3pm", points_rebounds_assists: "pra" };
  const CODE_STATS = Object.fromEntries(Object.entries(STAT_CODES).map(([stat, code]) => [code, stat]));
  const SHARE_LEG = /^(\d+)\.(\d+)\.(pts|reb|ast|3pm|pra)\.(o|u)\.(\d+(?:\.\d+)?)$/;
  const MAX_SHARED_LEGS = 20;

  // Legs that have a game id and a stat with a short code. Returns the link, or "" when nothing can be shared.
  function shareLink(list) {
    const parts = list
      .filter((leg) => leg.gameId && STAT_CODES[leg.stat] && Number.isFinite(Number(leg.line)))
      .map((leg) => `${leg.gameId}.${leg.playerId}.${STAT_CODES[leg.stat]}.${leg.side === "under" ? "u" : "o"}.${Number(leg.line)}`);
    return parts.length ? `${window.location.origin}/hunt.html?h=${parts.join("_")}` : "";
  }

  // "21717856.237.pts.o.19.5_..." -> [{ gameId, playerId, stat: "points", side: "over", line: 19.5 }]. Malformed legs are dropped.
  function parseShare(text) {
    return String(text || "").split("_").slice(0, MAX_SHARED_LEGS).map((part) => {
      const match = SHARE_LEG.exec(part);
      if (!match) return null;
      const line = Number(match[5]);
      if (!(line > 0)) return null;
      return { gameId: Number(match[1]), playerId: Number(match[2]), stat: CODE_STATS[match[3]], side: match[4] === "u" ? "under" : "over", line };
    }).filter(Boolean);
  }

  // Parlay: multiply the decimal payouts, give the answer back as American odds. Null when the list is empty.
  function combinedOdds(oddsList) {
    if (!oddsList.length) return null;
    const decimal = oddsList.reduce((total, odds) => total * (odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds)), 1);
    return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
  }

  return {
    bookLabel,
    shareLink,
    parseShare,
    combinedOdds,
    getAll: () => legs.map((leg) => ({ ...leg })),
    count: () => legs.length,
    idFor: legId,
    // has(id) or has({ playerId, stat, side, line })
    has: (idOrLeg) => legs.some((leg) => leg.id === (typeof idOrLeg === "string" ? idOrLeg : legId(idOrLeg))),

    // options.silent = no "Added" mini ticket (a bulk add from a shared hunt shows its own toast).
    add(input, options = {}) {
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
      emit("add", { leg, replaced, silent: Boolean(options.silent) });
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
