// Shared theme helpers and team display palettes (one for the dark theme, one for the light theme).

// The theme the page is in ("light" or "dark": set on <html> by the script in every page's <head>, changed by nav.js).
function isLightTheme() {
  return document.documentElement.getAttribute("data-bs-theme") === "light";
}

// A CSS variable's value, e.g. cssVar("--lh-text"). root = the element to read it from (default: the page).
function cssVar(name, root = document.documentElement) {
  return getComputedStyle(root).getPropertyValue(name).trim();
}

// Team display colors for the DARK theme.
// Most values use the team's primary color; a few are brighter secondary shades
// where the main color would be too dark to read on a dark background.
const TEAM_COLORS = {
  ATL: "#E03A3E", // Hawks red
  BOS: "#007A33", // Celtics green
  BKN: "#FFFFFF", // Nets white (main color is black)
  CHA: "#00788C", // Hornets teal
  CHI: "#CE1141", // Bulls red
  CLE: "#FDBB30", // Cavaliers gold (main wine color is too dark)
  DAL: "#0064B1", // Mavericks royal blue
  DEN: "#FEC524", // Nuggets gold
  DET: "#C8102E", // Pistons red
  GSW: "#FFC72C", // Warriors gold
  HOU: "#CE1141", // Rockets red
  IND: "#FDBB30", // Pacers gold
  LAC: "#C8102E", // Clippers red
  LAL: "#FDB927", // Lakers gold (main purple is too dark)
  MEM: "#5D76A9", // Grizzlies Beale Street blue
  MIA: "#F9A01B", // Heat yellow (main red is dark)
  MIL: "#EEE1C6", // Bucks cream (main green is too dark)
  MIN: "#78BE20", // Timberwolves aurora green (main navy is too dark)
  NOP: "#C8102E", // Pelicans red (main navy is too dark)
  NYK: "#F58426", // Knicks orange
  OKC: "#007AC1", // Thunder blue
  ORL: "#0077C0", // Magic blue
  PHI: "#006BB6", // 76ers blue
  PHX: "#E56020", // Suns orange
  POR: "#E03A3E", // Trail Blazers red
  SAC: "#5A2D81", // Kings purple
  SAS: "#C4CED4", // Spurs silver
  TOR: "#CE1141", // Raptors red
  UTA: "#F9A01B", // Jazz yellow (double-check: the Jazz changed colors recently)
  WAS: "#E31837", // Wizards red
};

// Team display colors for the LIGHT theme: the deep official primaries (dark navy and wine read well on white). Only the
// near-white ones are replaced: Nets white became black, Spurs silver a darker slate.
const TEAM_COLORS_LIGHT = {
  ATL: "#E03A3E", BOS: "#007A33", BKN: "#111111", CHA: "#1D1160", CHI: "#CE1141",
  CLE: "#860038", DAL: "#00538C", DEN: "#0E2240", DET: "#C8102E", GSW: "#1D428A",
  HOU: "#CE1141", IND: "#002D62", LAC: "#C8102E", LAL: "#552583", MEM: "#5D76A9",
  MIA: "#98002E", MIL: "#00471B", MIN: "#0C2340", NOP: "#0C2340", NYK: "#006BB6",
  OKC: "#007AC1", ORL: "#0077C0", PHI: "#006BB6", PHX: "#1D1160", POR: "#E03A3E",
  SAC: "#5A2D81", SAS: "#5B6770", TOR: "#CE1141", UTA: "#4F2D7F", WAS: "#002B5C",
};

function getTeamColor(teamAbbreviation) {
  const palette = isLightTheme() ? TEAM_COLORS_LIGHT : TEAM_COLORS;
  return palette[teamAbbreviation] || (isLightTheme() ? "#111111" : "#FFFFFF");
}

// Which of 10 gray shades a team's abbreviation on a matchup card uses (0 = the strongest). It is just a bit of variety:
// the shades themselves are the CSS classes .lh-abbr-0 ... .lh-abbr-9, which have a set for each theme.
function getNeutralTeamIndex(teamAbbreviation) {
  const hash = (teamAbbreviation || "")
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return hash % 10;
}
