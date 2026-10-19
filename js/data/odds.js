// LineHunter - js/data/odds.js
// Best-odds lookup across every sportsbook. The pages already download the player props for their games (all vendors);
// each one hands that raw list to lhOdds.ingest(), and lhOdds.getOdds() answers "who pays the most for THIS line and side?".
//
//   lhOdds.ingest(props)                         props = the API's /nba/v2/odds/player_props rows (any number of games)
//   lhOdds.getOdds(playerId, stat, line, side)   -> [{ book: "DK", vendor: "draftkings", odds: -115 }, ...] best payout first
//       stat = the API prop type ("points", "threes", "points_rebounds_assists"), side = "over" | "under".
//       over_under markets give both sides. Milestone markets ("6+ assists") give an Over only: a whole-number milestone N is
//       Over N - 0.5, a .5 milestone (BetRivers / BallyBet post their main line this way) is an Over at that exact line.
//       No book posts that exact line + side -> [] (Under is empty on alt lines: books only post milestones for the Over).
//   lhOdds.getOdds(playerId, stat, line, side, vendor)   vendor = one book only ("fanduel"); null = every book; left out = the book
//       chosen in Top Hit Rates' Sportsbook filter (lhOdds.getBook()), or every book when "Best odds" is chosen.
//   lhOdds.bookLine(playerId, stat, vendor)      -> { line, over, under, kind } that ONE book's own main line, or null: its over_under line,
//       otherwise its decimal milestone (BetRivers / BallyBet post their main line that way), otherwise null (whole-number ladders
//       are alt lines, not a main line).
//   lhOdds.startLine(playerId, stat, consensusLine)   the line a drawer / player page starts on: the chosen book's line, or the consensus line
//   lhOdds.getBook() / setBook(vendor|null)      the chosen sportsbook, saved in localStorage "lh-odds-book" (event "lh-book-change")
//   lhOdds.vendors() / vendorName(vendor)        the vendor names seen so far (the Sportsbook list is built from them) / "FanDuel"
// Needs js/core/hunts.js (lhHunts.bookLabel) loaded first.

const lhOdds = (() => {
  const byPlayerProp = {};   // "playerId|propType" -> [{ vendor, line, over, under, kind }]  kind: "ou" | "msMain" (decimal milestone) | "msLadder" (whole-number)
  const seenVendors = new Set();
  const BOOK_KEY = "lh-odds-book";
  const NAMES = { draftkings: "DraftKings", fanduel: "FanDuel", betrivers: "BetRivers", caesars: "Caesars", betparx: "BetParx", ballybet: "Bally Bet", fanatics: "Fanatics", betmgm: "BetMGM", espnbet: "ESPN BET", hardrock: "Hard Rock" };
  let chosenBook = null;
  try { chosenBook = localStorage.getItem(BOOK_KEY) || null; } catch (error) { chosenBook = null; }

  // American odds -> decimal payout multiplier: +150 -> 2.5, -110 -> 1.909. Higher = pays more.
  const decimal = (odds) => (odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds));
  const num = (value) => (value === null || value === undefined || value === "" || Number.isNaN(Number(value)) ? null : Number(value));

  function ingest(props) {
    (props || []).forEach((prop) => {
      if (!prop || !prop.market) return;
      const type = prop.market.type;
      if (type !== "over_under" && type !== "milestone") return;
      let line = num(prop.line_value);
      if (line === null) return;
      let kind = "ou";
      if (type === "milestone") {
        kind = Number.isInteger(line) ? "msLadder" : "msMain";
        if (kind === "msLadder") line -= 0.5;                            // "6+" = Over 5.5
      }
      seenVendors.add(prop.vendor);
      const key = `${prop.player_id}|${prop.prop_type}`;
      const list = (byPlayerProp[key] = byPlayerProp[key] || []);
      const entry = type === "milestone"
        ? { vendor: prop.vendor, line, over: num(prop.market.odds), under: null, kind }
        : { vendor: prop.vendor, line, over: num(prop.market.over_odds), under: num(prop.market.under_odds), kind };
      if (entry.over === null && entry.under === null) return;
      // The same row can arrive twice (several pages ask for the same game): keep one copy.
      if (!list.some((item) => item.vendor === entry.vendor && item.line === entry.line && item.over === entry.over && item.under === entry.under)) list.push(entry);
    });
  }

  function getOdds(playerId, stat, line, side, vendor = chosenBook) {
    const list = byPlayerProp[`${playerId}|${stat}`] || [];
    const wanted = Number(line);
    const bestPerVendor = {};
    list.forEach((entry) => {
      if (entry.line !== wanted) return;
      if (vendor && entry.vendor !== vendor) return;
      const odds = side === "under" ? entry.under : entry.over;
      if (odds === null) return;
      if (!bestPerVendor[entry.vendor] || decimal(odds) > decimal(bestPerVendor[entry.vendor])) bestPerVendor[entry.vendor] = odds;
    });
    return Object.entries(bestPerVendor)
      .map(([vendor, odds]) => ({ book: lhHunts.bookLabel(vendor), vendor, odds }))
      .sort((a, b) => decimal(b.odds) - decimal(a.odds) || a.book.localeCompare(b.book));
  }

  // One book's own main line for a player's prop (see the header). Null = hide the row.
  function bookLine(playerId, stat, vendor) {
    const list = (byPlayerProp[`${playerId}|${stat}`] || []).filter((entry) => entry.vendor === vendor);
    const entry = list.find((item) => item.kind === "ou") || list.find((item) => item.kind === "msMain");
    return entry ? { line: entry.line, over: entry.over, under: entry.under, kind: entry.kind } : null;
  }

  function startLine(playerId, stat, consensusLine) {
    if (!chosenBook) return consensusLine;
    const own = bookLine(playerId, stat, chosenBook);
    return own ? own.line : null;
  }

  function setBook(vendor) {
    chosenBook = vendor || null;
    try {
      if (chosenBook) localStorage.setItem(BOOK_KEY, chosenBook);
      else localStorage.removeItem(BOOK_KEY);
    } catch (error) { /* private window: the choice just lasts until the page closes */ }
    document.dispatchEvent(new CustomEvent("lh-book-change", { detail: { vendor: chosenBook } }));
  }

  const vendorName = (vendor) => NAMES[vendor] || String(vendor).replace(/^./, (letter) => letter.toUpperCase());

  return { ingest, getOdds, bookLine, startLine, getBook: () => chosenBook, setBook, vendorName, vendors: () => [...seenVendors].sort() };
})();
