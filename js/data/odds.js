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
//   lhOdds.vendors()                             the vendor names seen so far (handy for checking the data)
// Needs js/core/hunts.js (lhHunts.bookLabel) loaded first.

const lhOdds = (() => {
  const byPlayerProp = {};   // "playerId|propType" -> [{ vendor, line, over, under }]
  const seenVendors = new Set();

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
      if (type === "milestone" && Number.isInteger(line)) line -= 0.5;   // "6+" = Over 5.5
      seenVendors.add(prop.vendor);
      const key = `${prop.player_id}|${prop.prop_type}`;
      const list = (byPlayerProp[key] = byPlayerProp[key] || []);
      const entry = type === "milestone"
        ? { vendor: prop.vendor, line, over: num(prop.market.odds), under: null }
        : { vendor: prop.vendor, line, over: num(prop.market.over_odds), under: num(prop.market.under_odds) };
      if (entry.over === null && entry.under === null) return;
      // The same row can arrive twice (several pages ask for the same game): keep one copy.
      if (!list.some((item) => item.vendor === entry.vendor && item.line === entry.line && item.over === entry.over && item.under === entry.under)) list.push(entry);
    });
  }

  function getOdds(playerId, stat, line, side) {
    const list = byPlayerProp[`${playerId}|${stat}`] || [];
    const wanted = Number(line);
    const bestPerVendor = {};
    list.forEach((entry) => {
      if (entry.line !== wanted) return;
      const odds = side === "under" ? entry.under : entry.over;
      if (odds === null) return;
      if (!bestPerVendor[entry.vendor] || decimal(odds) > decimal(bestPerVendor[entry.vendor])) bestPerVendor[entry.vendor] = odds;
    });
    return Object.entries(bestPerVendor)
      .map(([vendor, odds]) => ({ book: lhHunts.bookLabel(vendor), vendor, odds }))
      .sort((a, b) => decimal(b.odds) - decimal(a.odds) || a.book.localeCompare(b.book));
  }

  return { ingest, getOdds, vendors: () => [...seenVendors].sort() };
})();
