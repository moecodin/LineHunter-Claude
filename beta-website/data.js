// SAMPLE DATA for the design only. Every player, line, odd and result is made up.
// Replace this list with a real feed later. Streaks, averages and hit rates are
// worked out from `games` in script.js, so nothing else needs updating.
// `games` runs oldest to newest and lines up with GAME_DATES.

const GAME_DATES = ["Oct 20", "Oct 22", "Oct 24", "Oct 26", "Oct 28", "Oct 30", "Nov 1", "Nov 3"];
const PAST_WEEK_GAMES = 4; // the last four entries above fall inside the past week

const PROPS = [
  { player: "Marcus Vale",    team: "DEN", pos: "PG", market: "PTS", dir: "Over",  line: 24.5, odds: -115, next: "vs PHX, Wed", opps: ["UTA","LAC","SAC","POR","HOU","MEM","NOP","OKC"], games: [27,31,26,33,29,25,38,30] },
  { player: "Tobias Renner",  team: "MIL", pos: "PF", market: "REB", dir: "Over",  line: 9.5,  odds: -120, next: "at CLE, Wed", opps: ["IND","DET","TOR","WAS","CHA","BKN","ORL","ATL"], games: [11,12,10,14,11,13,10,12] },
  { player: "Kai Moreau",     team: "ATL", pos: "PG", market: "AST", dir: "Over",  line: 7.5,  odds: -110, next: "vs ORL, Wed", opps: ["MIA","NYK","CHI","BOS","PHI","TOR","IND","MIL"], games: [6,9,10,8,11,9,8,12] },
  { player: "Devin Ashby",    team: "BOS", pos: "SG", market: "3PM", dir: "Over",  line: 2.5,  odds: 105,  next: "vs GSW, Wed", opps: ["PHI","CLE","ATL","DET","WAS","CHA","BKN","TOR"], games: [2,3,4,3,5,3,4,3] },
  { player: "Luca Ferran",    team: "OKC", pos: "SF", market: "PRA", dir: "Over",  line: 34.5, odds: -112, next: "vs DAL, Wed", opps: ["SAS","HOU","POR","UTA","GSW","LAL","DEN","MIN"], games: [30,38,41,36,44,39,37,35] },
  { player: "Andre Whitlock", team: "CHI", pos: "C",  market: "PTS", dir: "Under", line: 18.5, odds: -108, next: "vs DET, Wed", opps: ["CLE","ATL","MIL","IND","BKN","NYK","WAS","MIA"], games: [21,14,16,12,17,15,18,13] },
  { player: "Noah Stenberg",  team: "MIN", pos: "C",  market: "REB", dir: "Over",  line: 11.5, odds: -105, next: "at SAC, Wed", opps: ["LAL","PHX","MEM","NOP","SAS","POR","UTA","OKC"], games: [10,9,13,12,15,12,14,13] },
  { player: "Theo Marsh",     team: "NYK", pos: "PG", market: "AST", dir: "Under", line: 6.5,  odds: -125, next: "vs BKN, Wed", opps: ["ORL","PHI","CHA","MIA","TOR","CHI","CLE","DET"], games: [8,7,5,4,6,5,6,3] },
  { player: "Rafael Quint",   team: "MIA", pos: "SG", market: "3PM", dir: "Over",  line: 1.5,  odds: -135, next: "at WAS, Wed", opps: ["BKN","CHA","ORL","NYK","IND","ATL","DET","CHI"], games: [1,0,2,3,2,4,2,3] },
  { player: "Cole Adeyemi",   team: "SAS", pos: "PF", market: "PRA", dir: "Over",  line: 28.5, odds: -110, next: "vs LAC, Wed", opps: ["DAL","NOP","OKC","GSW","MEM","HOU","PHX","POR"], games: [33,25,30,31,29,35,32,30] },
  { player: "Jonah Pike",     team: "DAL", pos: "C",  market: "REB", dir: "Under", line: 8.5,  odds: -102, next: "at OKC, Wed", opps: ["HOU","UTA","LAC","SAC","DEN","MIN","GSW","LAL"], games: [10,9,7,6,8,5,7,8] },
  { player: "Isaiah Bray",    team: "LAL", pos: "SF", market: "PTS", dir: "Over",  line: 21.5, odds: -118, next: "vs NOP, Wed", opps: ["GSW","POR","DEN","PHX","UTA","SAC","MEM","DAL"], games: [19,24,18,26,23,28,22,25] },
  { player: "Milo Hartigan",  team: "GSW", pos: "PG", market: "AST", dir: "Over",  line: 5.5,  odds: -115, next: "at BOS, Wed", opps: ["LAC","SAC","HOU","SAS","MIN","DAL","NOP","UTA"], games: [7,5,4,8,6,9,6,7] },
  { player: "Eli Navarro",    team: "PHI", pos: "SF", market: "PTS", dir: "Under", line: 15.5, odds: -106, next: "vs CHA, Wed", opps: ["WAS","BOS","NYK","TOR","MIL","IND","MIA","BKN"], games: [14,17,19,12,13,15,11,14] },
];

// SAMPLE picks for the homepage's Featured players, in the order shown. Phones show the first five.
const FEATURED = [
  { player: "Marcus Vale", tag: "Superstar" },
  { player: "Luca Ferran", tag: "Superstar" },
  { player: "Kai Moreau", tag: "Superstar" },
  { player: "Devin Ashby", tag: "One to watch" },
  { player: "Noah Stenberg", tag: "One to watch" },
  { player: "Isaiah Bray", tag: "Superstar" },
  { player: "Tobias Renner", tag: "Superstar" },
  { player: "Cole Adeyemi", tag: "One to watch" },
  { player: "Milo Hartigan", tag: "One to watch" },
  { player: "Theo Marsh", tag: "One to watch" },
];

// SAMPLE tonight's slate for the homepage wheel, in tip-off order. Each game's
// featured streak is looked up from PROPS by team. mlAway and mlHome are moneylines.
const GAMES_DATE = "Wednesday, Nov 4";
const GAMES_TODAY = [
  { away: "CHA", home: "PHI", time: "7:00 PM ET", mlAway: 210,  mlHome: -255 },
  { away: "MIA", home: "WAS", time: "7:00 PM ET", mlAway: -190, mlHome: 160 },
  { away: "BKN", home: "NYK", time: "7:30 PM ET", mlAway: 320,  mlHome: -400 },
  { away: "GSW", home: "BOS", time: "7:30 PM ET", mlAway: 145,  mlHome: -175 },
  { away: "ORL", home: "ATL", time: "7:30 PM ET", mlAway: 118,  mlHome: -138 },
  { away: "MIL", home: "CLE", time: "7:30 PM ET", mlAway: -110, mlHome: -110 },
  { away: "DET", home: "CHI", time: "8:00 PM ET", mlAway: 130,  mlHome: -155 },
  { away: "DAL", home: "OKC", time: "8:00 PM ET", mlAway: 240,  mlHome: -295 },
  { away: "LAC", home: "SAS", time: "8:30 PM ET", mlAway: -125, mlHome: 105 },
  { away: "PHX", home: "DEN", time: "9:00 PM ET", mlAway: 165,  mlHome: -195 },
  { away: "NOP", home: "LAL", time: "10:00 PM ET", mlAway: 180, mlHome: -215 },
  { away: "MIN", home: "SAC", time: "10:00 PM ET", mlAway: -135, mlHome: 115 },
];

// Main color for each team, used on the game blocks.
const TEAM_COLORS = {
  ATL: "#E03A3E", BKN: "#000000", BOS: "#007A33", CHA: "#00788C", CHI: "#CE1141",
  CLE: "#860038", DAL: "#00538C", DEN: "#0E2240", DET: "#C8102E", GSW: "#1D428A",
  HOU: "#CE1141", IND: "#002D62", LAC: "#C8102E", LAL: "#552583", MEM: "#5D76A9",
  MIA: "#98002E", MIL: "#00471B", MIN: "#0C2340", NOP: "#0C2340", NYK: "#F58426",
  OKC: "#007AC1", ORL: "#0077C0", PHI: "#006BB6", PHX: "#1D1160", POR: "#E03A3E",
  SAC: "#5A2D81", SAS: "#C4CED4", TOR: "#CE1141", UTA: "#002B5C", WAS: "#002B5C",
};

// Our own artwork for each team, shown instead of NBA logos.
const MARK_FILES = {
  ATL: "hawks", BKN: "nets", BOS: "celtics", CHA: "hornets", CHI: "bulls",
  CLE: "cavaliers", DAL: "mavericks", DEN: "nuggets", DET: "pistons", GSW: "warriors",
  HOU: "rockets", IND: "pacers", LAC: "clippers", LAL: "lakers", MEM: "grizzlies",
  MIA: "heat", MIL: "bucks", MIN: "timberwolves", NOP: "pelicans", NYK: "knicks",
  OKC: "thunder", ORL: "magic", PHI: "sixers", PHX: "suns", POR: "blazers",
  SAC: "kings", SAS: "spurs", TOR: "raptors", UTA: "jazz", WAS: "wizards",
};
const TEAM_MARKS = Object.fromEntries(Object.entries(MARK_FILES).map(([team, file]) => [team, `assets/marks/${file}.svg`]));
