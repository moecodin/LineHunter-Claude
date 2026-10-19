// LineHunter - js/teams.js
// Static facts about each team, keyed by the abbreviation the API uses: { arena, city, coach, colors: { primary, secondary }, watermark }. (city = the ARENA's city; watermark = the word drawn behind a matchup card, e.g. "PHILLY".)
// city = the city of the ARENA (the Clippers play in Inglewood, the Warriors in San Francisco).
//
// Checked in October 2026 against Wikipedia's "List of current NBA head coaches" (last edited June 23, 2026) and
// "List of NBA arenas", plus NBA.com / news reports for the changes below. A web search did not find any NBA head
// coaching changes after June 2026, but it could not cover September-October, so recheck before the season starts.
//
// COLORS (Oct 2026): hex values from teamcolorcodes.com's NBA table (first two colors listed per team), which match the
// teams' brand colors. The page does not label primary / secondary, so that order is the page's. EXCEPTION: Utah Jazz.
// The Jazz moved to a purple / midnight black / sky blue "Mountain" identity; Wikipedia confirms the color NAMES but no
// source gave official hex values, and teamcolorcodes still lists the old navy / green. UTA's #4F2D7F (purple) and
// #71B2E8 (sky blue) are my approximations: replace them if you have the official values.
//
// CHANGED RECENTLY (since the 2025-26 season):
//   Coaches:  CHI Tiago Splitter (Billy Donovan stepped down)      DAL Dusty May (Jason Kidd out)
//             MIL Taylor Jenkins (Doc Rivers out)                  NOP Jamahl Mosley (hired May 18)
//             ORL Sean Sweeney (Mosley fired)                      POR Micah Nori
//   Arenas:   PHI Wells Fargo Center is now Xfinity Mobile Arena (Aug 2025)
//             CLE Rocket Mortgage FieldHouse is now Rocket Arena
//             PHX Footprint Center is now Mortgage Matchup Center
// NOT CHANGED YET: OKC is building Continental Coliseum (opens about 2028) and plays at Paycom Center until then;
//   WAS keeps the Capital One Arena name through 2047. San Antonio plays one 2026-27 home game in Austin: not shown here.

const TEAM_INFO = {
  ATL: { arena: "State Farm Arena", city: "Atlanta", coach: "Quin Snyder", colors: { primary: "#E03A3E", secondary: "#C1D32F" }, watermark: "THE A" },
  BOS: { arena: "TD Garden", city: "Boston", coach: "Joe Mazzulla", colors: { primary: "#007A33", secondary: "#BA9653" }, watermark: "BOSTON" },
  BKN: { arena: "Barclays Center", city: "Brooklyn", coach: "Jordi Fernández", colors: { primary: "#000000", secondary: "#FFFFFF" }, watermark: "BKN" },
  CHA: { arena: "Spectrum Center", city: "Charlotte", coach: "Charles Lee", colors: { primary: "#1D1160", secondary: "#00788C" }, watermark: "BUZZ CITY" },
  CHI: { arena: "United Center", city: "Chicago", coach: "Tiago Splitter", colors: { primary: "#CE1141", secondary: "#000000" }, watermark: "CHI-TOWN" },
  CLE: { arena: "Rocket Arena", city: "Cleveland", coach: "Kenny Atkinson", colors: { primary: "#860038", secondary: "#041E42" }, watermark: "THE LAND" },
  DAL: { arena: "American Airlines Center", city: "Dallas", coach: "Dusty May", colors: { primary: "#00538C", secondary: "#002B5E" }, watermark: "MAVS" },
  DEN: { arena: "Ball Arena", city: "Denver", coach: "David Adelman", colors: { primary: "#0E2240", secondary: "#FEC524" }, watermark: "MILE HIGH" },
  DET: { arena: "Little Caesars Arena", city: "Detroit", coach: "J. B. Bickerstaff", colors: { primary: "#C8102E", secondary: "#1D42BA" }, watermark: "MOTOR CITY" },
  GSW: { arena: "Chase Center", city: "San Francisco", coach: "Steve Kerr", colors: { primary: "#1D428A", secondary: "#FFC72C" }, watermark: "THE BAY" },
  HOU: { arena: "Toyota Center", city: "Houston", coach: "Ime Udoka", colors: { primary: "#CE1141", secondary: "#000000" }, watermark: "H-TOWN" },
  IND: { arena: "Gainbridge Fieldhouse", city: "Indianapolis", coach: "Rick Carlisle", colors: { primary: "#002D62", secondary: "#FDBB30" }, watermark: "INDY" },
  LAC: { arena: "Intuit Dome", city: "Inglewood", coach: "Tyronn Lue", colors: { primary: "#C8102E", secondary: "#1D428A" }, watermark: "CLIPPERS" },
  LAL: { arena: "Crypto.com Arena", city: "Los Angeles", coach: "JJ Redick", colors: { primary: "#552583", secondary: "#FDB927" }, watermark: "HOLLYWOOD" },
  MEM: { arena: "FedExForum", city: "Memphis", coach: "Tuomas Iisalo", colors: { primary: "#5D76A9", secondary: "#12173F" }, watermark: "GRIND CITY" },
  MIA: { arena: "Kaseya Center", city: "Miami", coach: "Erik Spoelstra", colors: { primary: "#98002E", secondary: "#F9A01B" }, watermark: "VICE CITY" },
  MIL: { arena: "Fiserv Forum", city: "Milwaukee", coach: "Taylor Jenkins", colors: { primary: "#00471B", secondary: "#EEE1C6" }, watermark: "CREAM CITY" },
  MIN: { arena: "Target Center", city: "Minneapolis", coach: "Chris Finch", colors: { primary: "#0C2340", secondary: "#236192" }, watermark: "TWIN CITIES" },
  NOP: { arena: "Smoothie King Center", city: "New Orleans", coach: "Jamahl Mosley", colors: { primary: "#0C2340", secondary: "#C8102E" }, watermark: "NOLA" },
  NYK: { arena: "Madison Square Garden", city: "New York", coach: "Mike Brown", colors: { primary: "#006BB6", secondary: "#F58426" }, watermark: "BIG APPLE" },
  OKC: { arena: "Paycom Center", city: "Oklahoma City", coach: "Mark Daigneault", colors: { primary: "#007AC1", secondary: "#EF3B24" }, watermark: "OKC" },
  ORL: { arena: "Kia Center", city: "Orlando", coach: "Sean Sweeney", colors: { primary: "#0077C0", secondary: "#C4CED4" }, watermark: "ORLANDO" },
  PHI: { arena: "Xfinity Mobile Arena", city: "Philadelphia", coach: "Nick Nurse", colors: { primary: "#006BB6", secondary: "#ED174C" }, watermark: "PHILLY" },
  PHX: { arena: "Mortgage Matchup Center", city: "Phoenix", coach: "Jordan Ott", colors: { primary: "#1D1160", secondary: "#E56020" }, watermark: "THE VALLEY" },
  POR: { arena: "Moda Center", city: "Portland", coach: "Micah Nori", colors: { primary: "#E03A3E", secondary: "#000000" }, watermark: "PDX" },
  SAC: { arena: "Golden 1 Center", city: "Sacramento", coach: "Doug Christie", colors: { primary: "#5A2D81", secondary: "#63727A" }, watermark: "SACTOWN" },
  SAS: { arena: "Frost Bank Center", city: "San Antonio", coach: "Mitch Johnson", colors: { primary: "#C4CED4", secondary: "#000000" }, watermark: "SATX" },
  TOR: { arena: "Scotiabank Arena", city: "Toronto", coach: "Darko Rajaković", colors: { primary: "#CE1141", secondary: "#000000" }, watermark: "THE 6IX" },
  UTA: { arena: "Delta Center", city: "Salt Lake City", coach: "Will Hardy", colors: { primary: "#4F2D7F", secondary: "#71B2E8" }, watermark: "UTA" },
  WAS: { arena: "Capital One Arena", city: "Washington", coach: "Brian Keefe", colors: { primary: "#002B5C", secondary: "#E31837" }, watermark: "THE DISTRICT" },
};


// ---------- Team colors in use ----------
// The helpers below turn those hex values into colors that work on the page background (dark or light: they read
// --lh-bg), and apply the "color clash" rule (two similar primaries in one matchup: the AWAY team uses its secondary color).
// The colors are worked out when something is drawn, so refreshTeamColors() redraws them when the theme changes.

// Where the theme variables are read: the page, or (for a share image, which is always dark) the image's own dark box.
let colorRoot = document.documentElement;
// What team colors sit on: the page background of the current theme (a hex like #0b0b0b or #faf9fd).
function pageBackground() {
  return cssVar("--lh-bg", colorRoot);
}
// A light page needs DARKER colors for contrast, a dark page LIGHTER ones.
function pageIsLight() {
  return luminance(pageBackground()) > 0.4;
}
const COLOR_CLASH_DISTANCE = 80; // two colors closer than this (in RGB steps, out of ~441) count as "too similar"
const TINT_MIN_CONTRAST = 3;     // glows, tints and outlines must reach this contrast against the page background
const TEXT_MIN_CONTRAST = 4.5;   // team-colored TEXT (badges) must reach this (WCAG AA)

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((start) => parseInt(value.slice(start, start + 2), 16));
}

function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((part) => Math.round(part).toString(16).padStart(2, "0")).join("")}`;
}

// WCAG relative luminance and contrast ratio between two hex colors (1 = identical, 21 = black on white).
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((part) => {
    const channel = part / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hexA, hexB) {
  const [lighter, darker] = [luminance(hexA), luminance(hexB)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

// How different two colors are (straight-line distance in RGB).
function colorDistance(hexA, hexB) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// A color made readable on the page: unchanged if it already reaches the contrast; otherwise mixed toward white on a dark
// page (a lighter tint) or toward black on a light page (a darker shade) until it does.
function ensureContrast(hex, minimum = TINT_MIN_CONTRAST) {
  const background = pageBackground();
  const target = pageIsLight() ? 0 : 255;
  let mix = 0;
  let color = hex;
  while (contrastRatio(color, background) < minimum && mix < 0.95) {
    mix += 0.05;
    color = rgbToHex(hexToRgb(hex).map((part) => part + (target - part) * mix));
  }
  return color;
}

// White text or dark text on a colored background, whichever reads better (4.5:1). The theme decides which is tried first:
// white on a dark page, dark on a light page.
const TEXT_ON_DARK = "#ffffff";
const TEXT_ON_LIGHT = "#0b0b0b";
function readableTextOn(backgroundHex) {
  const order = pageIsLight() ? [TEXT_ON_LIGHT, TEXT_ON_DARK] : [TEXT_ON_DARK, TEXT_ON_LIGHT];
  const passing = order.find((color) => contrastRatio(color, backgroundHex) >= TEXT_MIN_CONTRAST);
  if (passing) return passing;
  return contrastRatio(TEXT_ON_DARK, backgroundHex) >= contrastRatio(TEXT_ON_LIGHT, backgroundHex) ? TEXT_ON_DARK : TEXT_ON_LIGHT;
}

// The team's main color on this page: its primary, unless that nearly disappears on the page (nearly black on a dark page:
// Nets, Nuggets, Hornets...; nearly white on a light page: Spurs silver), in which case its secondary if that shows up,
// otherwise the primary (ensureContrast will tint or shade it).
function teamBaseColor(abbreviation) {
  const colors = (TEAM_INFO[abbreviation] || {}).colors;
  if (!colors) return pageIsLight() ? "#111111" : "#ffffff";
  const background = pageBackground();
  if (contrastRatio(colors.primary, background) >= 1.8) return colors.primary;
  if (contrastRatio(colors.secondary, background) >= TINT_MIN_CONTRAST) return colors.secondary;
  return colors.primary;
}

// Both teams' colors for one matchup. Color clash: if the two main colors are too similar, the AWAY team switches to its
// secondary color. Every color returned has enough contrast to show on the page background.
function matchupColors(awayAbbreviation, homeAbbreviation) {
  let away = teamBaseColor(awayAbbreviation);
  const home = teamBaseColor(homeAbbreviation);
  if (colorDistance(away, home) < COLOR_CLASH_DISTANCE) {
    const secondary = (TEAM_INFO[awayAbbreviation] || {}).colors;
    if (secondary) away = secondary.secondary;
  }
  return { away: ensureContrast(away), home: ensureContrast(home) };
}

// "r, g, b" for CSS: rgba(var(--away), 0.15)
function rgbList(hex) {
  return hexToRgb(hex).join(", ");
}

// The color to show for one team. Give the matchup's away and home abbreviations to apply the clash rule for it.
function teamDisplayColor(abbreviation, awayAbbreviation, homeAbbreviation) {
  if (awayAbbreviation && homeAbbreviation) {
    const colors = matchupColors(awayAbbreviation, homeAbbreviation);
    if (abbreviation === awayAbbreviation) return colors.away;
    if (abbreviation === homeAbbreviation) return colors.home;
  }
  return ensureContrast(teamBaseColor(abbreviation));
}

// Sets --away / --home on a card and adds the class that draws the slash tint and the edge glows (styles.css).
function applyMatchupColors(element, awayAbbreviation, homeAbbreviation) {
  const colors = matchupColors(awayAbbreviation, homeAbbreviation);
  element.classList.add("lh-team-card");
  element.dataset.away = awayAbbreviation;   // remembered, so refreshTeamColors can redo the colors when the theme changes
  element.dataset.home = homeAbbreviation;
  element.style.setProperty("--away", rgbList(colors.away));
  element.style.setProperty("--home", rgbList(colors.home));
  addCityWatermarks(element, awayAbbreviation, homeAbbreviation);
}

// ---------- City watermarks ----------
// Each team's word (TEAM_INFO[abbreviation].watermark) runs VERTICALLY along its own outer edge of a matchup card: the away
// team on the left edge (reading bottom to top), the home team on the right edge (reading top to bottom), centered, in the
// team's matchup color at low opacity (styles.css, .lh-city-mark). The word is always fully visible and still. It is sized so
// the whole word fits the card height. While the card is on screen a soft band of light sweeps along each word (CSS only,
// switched on by the class "is-shining" below; the home word starts 0.3s after the away word).
const CITY_MAX_FONT = 40;     // px: the strip beside the card text is 3.25rem wide, so the letters stay inside it
const CITY_FIT = 0.88;        // the word uses at most this much of the card's height (a small margin at both ends)
const CITY_VISIBLE = 0.6;     // a card counts as "shown" once this much of it is on screen

function addCityWatermarks(card, awayAbbreviation, homeAbbreviation) {
  const sides = [["away", awayAbbreviation], ["home", homeAbbreviation]].filter(([, abbreviation]) => (TEAM_INFO[abbreviation] || {}).watermark);
  if (sides.length === 0) return;
  card.classList.add("has-city-marks");

  // One strip per team: [mark box > text]. data-text is the same word again: the shine is drawn on a copy of it (CSS ::before).
  const texts = sides.map(([side, abbreviation]) => {
    const mark = document.createElement("span");
    mark.className = `lh-city-mark is-${side}`;
    mark.setAttribute("aria-hidden", "true"); // decoration only
    const text = document.createElement("span");
    text.className = "lh-city-text";
    text.textContent = TEAM_INFO[abbreviation].watermark;
    text.dataset.text = TEAM_INFO[abbreviation].watermark;
    mark.appendChild(text);
    card.prepend(mark);
    return text;
  });

  // Size: measure each word at 100px, then scale it so the whole word fits the card's height (never clipped).
  const fit = () => {
    const height = card.clientHeight;
    if (!height) return;
    texts.forEach((text) => {
      text.style.fontSize = "100px";
      const length = text.getBoundingClientRect().height; // the word runs vertically, so its length is its height
      if (length > 0) text.style.fontSize = `${Math.min(CITY_MAX_FONT, (100 * height * CITY_FIT) / length)}px`;
    });
  };
  const resizeObserver = new ResizeObserver(fit); // the card grows when its Quick look opens, and on other screen sizes
  resizeObserver.observe(card);
  if (document.fonts) document.fonts.ready.then(fit); // measure again once Comico has loaded

  // Reduced motion: the still word only (the stylesheet also hides the shine).
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // Only a card that is on screen shines (the 3 shown in the Schedule carousel, the game header). Adding the class starts
  // the CSS animation from its beginning, so a card the carousel brings into view starts a fresh sweep; removing it stops it.
  const visibility = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!card.isConnected) { // the card was removed (another day was picked): stop watching it
        visibility.disconnect();
        resizeObserver.disconnect();
      } else {
        card.classList.toggle("is-shining", entry.isIntersecting);
      }
    });
  }, { threshold: CITY_VISIBLE });
  visibility.observe(card);
}

// The two colors a team badge uses: the team color (underline, tints) and a brighter / darker version for the letters (4.5:1).
function badgeColors(abbreviation, awayAbbreviation, homeAbbreviation) {
  const color = teamDisplayColor(abbreviation, awayAbbreviation, homeAbbreviation);
  return { color, text: ensureContrast(color, TEXT_MIN_CONTRAST) };
}

// A small team abbreviation badge in the team's color, next to a player's name. The letters are tinted (dark page) or shaded
// (light page) for 4.5:1 contrast. Pass the matchup's away and home abbreviations when you know them (clash rule).
// The data- attributes let refreshTeamColors redo the colors when the theme changes.
function teamBadgeHtml(abbreviation, awayAbbreviation, homeAbbreviation) {
  if (!abbreviation) return "";
  const { color, text } = badgeColors(abbreviation, awayAbbreviation, homeAbbreviation);
  return `<span class="lh-team-badge" data-team="${abbreviation}" data-away="${awayAbbreviation || ""}" data-home="${homeAbbreviation || ""}" style="--tc: ${rgbList(color)}; --tc-text: ${text}">${abbreviation}</span>`;
}

// For rows that only have a matchup string ("vs BOS" = the player's team is at home, "@ BOS" = away).
function teamBadgeForMatchup(abbreviation, matchup) {
  const text = String(matchup || "");
  const other = text.replace(/^(vs|@)\s*/, "");
  if (text.startsWith("vs")) return teamBadgeHtml(abbreviation, other, abbreviation);
  if (text.startsWith("@")) return teamBadgeHtml(abbreviation, abbreviation, other);
  return teamBadgeHtml(abbreviation);
}

// Inline style for an initials circle: the team's color as the background, white or dark initials (whichever passes contrast).
// The element also needs data-avatar-team / data-away / data-home (see player.js) so refreshTeamColors can redo it.
function teamAvatarStyle(abbreviation, awayAbbreviation, homeAbbreviation) {
  const color = teamDisplayColor(abbreviation, awayAbbreviation, homeAbbreviation);
  return `background: ${color}; color: ${readableTextOn(color)}; border-color: ${color}`;
}

// Redo every team color inside `root` for the theme the page is in now: matchup cards, badges and initials circles.
// root = document (the whole page), or one element such as a share image's box (which is always dark, so its colors are
// worked out against that box's dark background).
function refreshTeamColors(root = document) {
  colorRoot = root === document ? document.documentElement : root;
  try {
    root.querySelectorAll(".lh-team-card[data-away]").forEach((card) => {
      const colors = matchupColors(card.dataset.away, card.dataset.home);
      card.style.setProperty("--away", rgbList(colors.away));
      card.style.setProperty("--home", rgbList(colors.home));
    });
    root.querySelectorAll(".lh-team-badge[data-team]").forEach((badge) => {
      const { color, text } = badgeColors(badge.dataset.team, badge.dataset.away || undefined, badge.dataset.home || undefined);
      badge.style.setProperty("--tc", rgbList(color));
      badge.style.setProperty("--tc-text", text);
    });
    root.querySelectorAll("[data-avatar-team]").forEach((avatar) => {
      avatar.setAttribute("style", teamAvatarStyle(avatar.dataset.avatarTeam, avatar.dataset.away || undefined, avatar.dataset.home || undefined));
    });
  } finally {
    colorRoot = document.documentElement;
  }
}

document.addEventListener("lh-theme-change", () => refreshTeamColors());
