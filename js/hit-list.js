// LineHunter - js/hit-list.js
// The "Hit List" card on the schedule page: a grid of six small cards, each a slip of 3-5 legs for the
// same slate as Top Hit Rates ("Props that hit in 100% of recent games").
// It uses no downloads of its own: js/top-hit-rates.js builds one "leg" per line (buildHitListLeg) and
// calls showHitList(slate) with them, so the Hit List shares its logs and its 10-minute cache.
//
// Needs js/stats.js (formatOdds), js/share.js and js/top-hit-rates.js loaded first.

const SLIP_MIN_LEGS = 3;
const SLIP_MAX_LEGS = 5;
const PARLAY_STAKE = 10; // the "$10 bet" the combined odds use

// Each category says which legs qualify (pick returns null or the details) and how to rank them.
// pick() returns: side ("over"/"under"), proof (the text shown), rate (hit rate 0-1), sample (games), streak.
// pickers = a category can have several rules (Home Cookin' / Road Warriors); their legs share one slip.
const HITLIST_CATEGORIES = [
  {
    key: "perfect",
    icon: "bi-check2-circle",
    label: "Perfect Five",
    blurb: "Went over the line in each of the last 5 games",
    pickers: [(leg) => leg.over5 === 5 && leg.n10 > 0
      ? { side: "over", proof: "5/5", rate: leg.over10 / leg.n10, sample: leg.n10, streak: leg.overStreak } : null],
  },
  {
    key: "weather",
    icon: "bi-cloud-drizzle",
    label: "Under the Weather",
    blurb: "Went under the line in each of the last 5 games",
    pickers: [(leg) => leg.under5 === 5 && leg.n10 > 0
      ? { side: "under", proof: "5/5", rate: leg.under10 / leg.n10, sample: leg.n10, streak: leg.underStreak } : null],
  },
  {
    key: "venue",
    icon: "bi-house-door",
    label: "Home Cookin' / Road Warriors",
    blurb: "Over the line in every recent game at tonight's venue (H = home, A = away)",
    // Home tonight with 5+ home games all over the line, or away tonight with 5+ road games all over.
    // "H" / "A" after the proof says which one.
    pickers: [
      (leg) => leg.isHome === true && leg.venueN >= 5 && leg.venueOvers === leg.venueN
        ? { side: "over", proof: `${leg.venueN}/${leg.venueN} H`, title: "Home games", rate: 1, sample: leg.venueN, streak: leg.overStreak } : null,
      (leg) => leg.isHome === false && leg.venueN >= 5 && leg.venueOvers === leg.venueN
        ? { side: "over", proof: `${leg.venueN}/${leg.venueN} A`, title: "Away games", rate: 1, sample: leg.venueN, streak: leg.overStreak } : null,
    ],
  },
  {
    key: "rival",
    icon: "bi-crosshair",
    label: "Bad Blood",
    blurb: "Over the line in every recent game against tonight's opponent (2+ games)",
    pickers: [(leg) => leg.vsN >= 2 && leg.vsOvers === leg.vsN
      ? { side: "over", proof: `${leg.vsN}/${leg.vsN}`, title: "Games against tonight's opponent", rate: 1, sample: leg.vsN, streak: leg.overStreak } : null],
  },
  {
    key: "teams",
    icon: "bi-lightbulb",
    label: "Light It Up",
    blurb: "Teams that scored at least this many points in each of their last 3-5 games",
    teams: true,     // legs are teams (slate.teamLegs), not players
    minLegs: 2,      // two teams are enough for a slip
    noOdds: true,    // there are no team-total lines, so no combined odds
  },
  {
    key: "heat",
    icon: "bi-fire",
    label: "Heat Check",
    blurb: "Longest current streaks over tonight's line (6+)",
    streakFirst: true, // sorted by streak length first
    pickers: [(leg) => leg.overStreak >= 6 && leg.n10 > 0
      ? { side: "over", proof: `${leg.overStreak} str`, title: `${leg.overStreak} straight overs`, rate: leg.over10 / leg.n10, sample: leg.n10, streak: leg.overStreak } : null],
  },
  {
    key: "bbq",
    bbq: true, // drawn by js/bbq.js: a full-width card, no slip and no combined odds
    label: "BBQ Chicken 🍗",
  },
  {
    key: "brick",
    brick: true, // drawn by js/brickCity.js: no slip and no combined odds
    label: "Brick City",
  },
];

let hitListSlate = null; // the slate from top-hit-rates.js: { date, rows, legs }

// ---------- Picking the legs ----------

// Best first: hit rate, then sample size, then streak length (Heat Check: streak first).
function compareHitListPicks(streakFirst) {
  return (a, b) => {
    const byRate = b.rate - a.rate;
    const bySample = b.sample - a.sample;
    const byStreak = b.streak - a.streak;
    return streakFirst ? byStreak || byRate || bySample : byRate || bySample || byStreak;
  };
}

// Every pick becomes the same simple shape, so the drawing code doesn't care where it came from:
//   { href, name, text, hover, proof, proofTitle, side, odds, rate, sample, streak }
function playerPick(leg, hit) {
  return {
    href: `game.html?id=${leg.gameId}&player=${leg.playerId}&prop=${leg.code}`,
    name: `${shortName(leg.name)} ${teamBadgeForMatchup(leg.team, leg.matchup)}`,
    text: `${hit.side === "over" ? "Over" : "Under"} ${leg.line} ${leg.code.toUpperCase()}`,
    hover: `${leg.name} ${leg.matchup}`,
    proof: hit.proof,
    proofTitle: hit.title,
    side: hit.side,
    odds: hit.side === "over" ? leg.overOdds : leg.underOdds,
    rate: hit.rate,
    sample: hit.sample,
    streak: hit.streak,
  };
}

// A team's "scored at least 95 points in each of the last 3" pick. Higher mark first, then more games.
function teamPick(leg) {
  return {
    href: `game.html?id=${leg.gameId}`,
    name: leg.label,
    text: `${leg.mark}+ PTS`,
    hover: `${leg.label} ${leg.matchup}`,
    proof: `${leg.games}/${leg.games}`,
    proofTitle: `Scored ${leg.mark}+ in each of their last ${leg.games} games`,
    side: "over",
    odds: null,
    rate: 1,
    sample: leg.games,
    streak: leg.mark, // the mark is what ranks team picks (after the sample size)
  };
}

// The slip for one category: up to 5 best legs, or null if too few qualify (3 players, 2 teams).
// The same player may appear with several props; legs can come from any game on the slate.
function buildSlip(category, slate) {
  const picks = [];
  if (category.teams) {
    (slate.teamLegs || []).forEach((leg) => picks.push(teamPick(leg)));
    picks.sort((a, b) => b.streak - a.streak || b.sample - a.sample); // highest mark first
  } else {
    slate.legs.forEach((leg) => {
      category.pickers.forEach((pick) => {
        const hit = pick(leg);
        if (hit) picks.push(playerPick(leg, hit));
      });
    });
    picks.sort(compareHitListPicks(category.streakFirst));
  }
  return picks.length >= (category.minLegs || SLIP_MIN_LEGS) ? picks.slice(0, SLIP_MAX_LEGS) : null;
}

// ---------- Combined odds ----------

// American -> decimal: +150 pays 2.5x the stake back, -110 pays 1.909x.
function americanToDecimal(odds) {
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

// decimal -> American text: 2.5 -> "+150", 1.909 -> "-110"
function decimalToAmerican(decimal) {
  if (decimal >= 2) return `+${Math.round((decimal - 1) * 100)}`;
  return `${Math.round(-100 / (decimal - 1))}`;
}

// Multiplies the decimal odds of every leg that has odds. Legs without odds are left out.
function parlayHtml(slip) {
  const priced = slip.filter((pick) => pick.odds !== null);
  const missing = slip.length - priced.length;
  if (priced.length === 0) return `<span class="text-muted">No odds available for these legs.</span>`;

  const decimal = priced.reduce((total, pick) => total * americanToDecimal(pick.odds), 1);
  const payout = PARLAY_STAKE * decimal;
  return `
    <strong>${decimalToAmerican(decimal)}</strong> · $${PARLAY_STAKE} pays $${payout.toFixed(2)}
    <span class="text-muted">(profit $${(payout - PARLAY_STAKE).toFixed(2)})</span>
    ${missing ? `<div class="text-muted">${missing} ${missing === 1 ? "leg has" : "legs have"} no odds and ${missing === 1 ? "is" : "are"} left out.</div>` : ""}`;
}

// ---------- Drawing ----------

// "LeBron James" -> "L. James", "Gary Trent Jr." -> "G. Trent Jr."
function shortName(name) {
  const words = name.split(" ").filter(Boolean);
  return words.length > 1 ? `${words[0][0]}. ${words.slice(1).join(" ")}` : name;
}

// One compact line: "L. James  Over 16.5 PTS ........ 5/5". Click = that game (with the player's drawer open).
function legHtml(pick) {
  return `
    <a class="lh-hitlist-leg" href="${pick.href}" title="${pick.hover}">
      <span class="lh-hitlist-name">${pick.name}</span>
      <span class="lh-hitlist-pick">${pick.text}</span>
      <span class="lh-hitlist-proof ${pick.side === "under" ? "is-under" : ""}"${pick.proofTitle ? ` title="${pick.proofTitle}"` : ""}>${pick.proof}</span>
    </a>`;
}

// The top of a category card: title, description and the legs. The share image reuses it.
function cardTopHtml(category, slip, shareButton) {
  return `
    <div class="lh-hitlist-head">
      <i class="bi ${category.icon}" aria-hidden="true"></i><span>${category.label}</span>
      ${shareButton ? `<button type="button" class="lh-hitlist-share" data-hitlist-share="${category.key}"
          aria-label="Share ${category.label} as an image" title="Share as image"><i class="bi bi-share" aria-hidden="true"></i></button>` : ""}
    </div>
    <div class="lh-hitlist-blurb">${category.blurb}</div>
    <div class="lh-hitlist-list">${slip
      ? slip.map(legHtml).join("")
      : `<div class="lh-hitlist-empty text-muted">Not enough picks today</div>`}</div>`;
}

// One small category card, with its own "Combined odds" link and share button.
function categoryHtml(category, slip) {
  if (category.bbq) return bbqCardHtml(); // js/bbq.js
  if (category.brick) return brickCityCardHtml(hitListSlate); // js/brickCity.js
  const foot = slip && !category.noOdds
    ? `<div class="lh-hitlist-foot">
         <button type="button" class="lh-hitlist-link" data-hitlist-odds="${category.key}" aria-expanded="false">Combined odds</button>
         <div class="lh-hitlist-odds" data-hitlist-result="${category.key}" aria-live="polite" hidden></div>
       </div>`
    : "";

  return `
    <div class="lh-shelf-item">
      <div class="lh-hitlist-card">
        ${cardTopHtml(category, slip, Boolean(slip))}
        ${foot}
      </div>
    </div>`;
}

function renderHitList() {
  const body = document.getElementById("hitlistBody");
  body.classList.remove("text-muted");
  body.removeAttribute("aria-busy");

  const slips = HITLIST_CATEGORIES.map((category) => ({ category, slip: category.bbq || category.brick ? null : buildSlip(category, hitListSlate) }));
  body.innerHTML = `<div class="lh-shelf-track" id="hitlistShelf">${slips.map(({ category, slip }) => categoryHtml(category, slip)).join("")}</div>`;
  refreshShelf("#hitlistShelf"); // js/shelf.js: back to the first card, arrows up to date
  fillBbqSlots(hitListSlate); // the BBQ Chicken card downloads its own (cached) defense numbers

  // The share icon turns the card into a picture (see "Share as an image" below).
  slips.forEach(({ category, slip }) => {
    const button = body.querySelector(`[data-hitlist-share="${category.key}"]`);
    if (button && slip) button.addEventListener("click", () => shareCategory(category, slip, button));
  });

  // "Combined odds" opens and closes the parlay line inside its own card.
  slips.forEach(({ category, slip }) => {
    const button = body.querySelector(`[data-hitlist-odds="${category.key}"]`);
    if (!button || !slip) return; // no slip, or a card without odds (team totals)
    const result = body.querySelector(`[data-hitlist-result="${category.key}"]`);
    button.addEventListener("click", () => {
      const open = result.hidden;
      result.innerHTML = open ? parlayHtml(slip) : "";
      result.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
    });
  });
}

// ---------- Share as an image ----------
// A clean copy of the card (site styles, logo, date, responsible-gambling note) goes through
// shareNodeAsImage in js/share.js: the phone's share sheet, or a PNG download on desktop.

function shareCategory(category, slip, button) {
  const dateText = new Date(`${hitListSlate.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  shareNodeAsImage(`
    ${shareBrandHtml(`Hit List · ${dateText}`)}
    <div class="lh-hitlist-card">${cardTopHtml(category, slip, false)}</div>
    ${SHARE_NOTE_HTML}`, {
    filename: `linehunter-${category.key}.png`,
    title: `LineHunter ${category.label}`,
    text: "Check out today's Hit List on LineHunter.",
    button,
  });
}

// ---------- Called by js/top-hit-rates.js ----------

function showHitList(slate) {
  if (!document.getElementById("hitlist")) return;
  hitListSlate = slate;
  renderHitList();
}

function showHitListLoading() {
  const body = document.getElementById("hitlistBody");
  if (!body) return;
  body.setAttribute("aria-busy", "true");
  body.innerHTML = `<div class="lh-shelf-track">${Array(4).fill(`
    <div class="lh-shelf-item">
      <div class="lh-hitlist-card placeholder-glow" aria-hidden="true" style="min-height: 9rem">
        <div class="lh-hitlist-head"><span class="placeholder col-6 rounded"></span></div>
        <div class="lh-hitlist-list"><span class="placeholder col-12 rounded"></span></div>
      </div>
    </div>`).join("")}</div>`;
}

function showHitListMessage(html) {
  const body = document.getElementById("hitlistBody");
  if (!body) return;
  body.removeAttribute("aria-busy");
  body.innerHTML = `<div class="lh-top-message">${html}</div>`;
}
