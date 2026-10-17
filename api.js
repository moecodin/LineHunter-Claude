// Shared team color palette for dark backgrounds.Check
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

function getTeamColor(teamAbbreviation) {
  return TEAM_COLORS[teamAbbreviation] || "#FFFFFF";
}

function getNeutralTeamColor(teamAbbreviation) {
  const palette = [
    "#FFFFFF",
    "#F3F4F6",
    "#E5E7EB",
    "#D1D5DB",
    "#C0C7D1",
    "#AAB3BE",
    "#919BA9",
    "#7A8394",
    "#626C7A",
    "#4B5563"
  ];

  const hash = (teamAbbreviation || "")
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);

  return palette[hash % palette.length];
}
