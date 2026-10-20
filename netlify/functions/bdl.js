// LineHunter - netlify/functions/bdl.js
// A small proxy between the site and BALLDONTLIE, so the API key stays on the server and never reaches the browser.
//
//   Browser:  GET /api/bdl/v1/games?start_date=2026-10-20&end_date=2026-10-20     (or /api/bdl?path=/v1/games&start_date=...)
//   netlify.toml sends /api/bdl/* here; this function checks the path against an allowlist, adds the key from the
//   BALLDONTLIE_API_KEY environment variable, calls https://api.balldontlie.io and returns the JSON.
//
// Cache headers let Netlify's CDN share one answer between visitors. The cache key is the full URL INCLUDING the query string
// (Netlify-Vary: query below), so /v1/stats?player_ids[]=1 and /v1/stats?player_ids[]=2 never share an entry.
//   15 seconds   box scores (/v1/stats?game_ids[]=) unless every game was Final before today (then 24 hours)
//   30 seconds   games from today on while one is live
//   2 minutes    player props and odds
//   5 minutes    games from today on when none is live
//   10 minutes   injuries, advanced stats, this season's player game logs
//   24 hours     past seasons (stats, averages, games), teams
//   6 hours      this season's standings, team averages, players
// Only successful (200) answers are cached; errors and 429s are sent with no-store.

const API_ORIGIN = "https://api.balldontlie.io";

// Only the endpoints the site actually uses. Anything else is refused.
const ALLOWED_PATHS = [
  /^\/v1\/games$/,
  /^\/v1\/games\/\d+$/,
  /^\/v1\/stats$/,
  /^\/v1\/players$/,
  /^\/v1\/players\/active$/,
  /^\/v1\/players\/\d+$/,
  /^\/v1\/player_injuries$/,
  /^\/v1\/standings$/,
  /^\/v1\/teams$/,
  /^\/nba\/v1\/team_season_averages\/(general|shooting)$/,
  /^\/nba\/v1\/season_averages\/(general|shooting)$/,
  /^\/nba\/v2\/odds$/,
  /^\/nba\/v2\/odds\/player_props$/,
  /^\/nba\/v2\/stats\/advanced$/,
];

const MINUTE = 60;
const TTL = { box: 15, live: 30, props: 2 * MINUTE, games: 5 * MINUTE, medium: 10 * MINUTE, season: 6 * 60 * MINUTE, past: 24 * 60 * MINUTE };

// Today's date in New York (the NBA's day), "YYYY-MM-DD".
function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// BALLDONTLIE names a season by the year it starts; from September on the new one is current.
function currentSeasonYear() {
  const [year, month] = today().split("-").map(Number);
  return month >= 9 ? year : year - 1;
}

// True when the request asks only for seasons before the current one (their numbers never change).
function isPastSeason(params) {
  const seasons = [...params.getAll("seasons[]"), ...params.getAll("season")].map(Number).filter(Boolean);
  return seasons.length > 0 && seasons.every((season) => season < currentSeasonYear());
}

// A game that has started and is not Final carries a quarter / "Halftime" status instead of a start time.
function anyLiveGame(body) {
  try {
    const data = JSON.parse(body).data;
    return (Array.isArray(data) ? data : [data]).some((game) => game && game.status && game.status !== "Final" && !/^\d{4}-\d{2}-\d{2}T/.test(game.status));
  } catch (error) {
    return true; // can't tell: use the short cache
  }
}

// True when the stat lines are all from Final games played before today (a box score that will not change).
function allGamesSettled(body) {
  try {
    const rows = JSON.parse(body).data;
    return rows.length > 0 && rows.every((row) => row.game && row.game.status === "Final" && row.game.date < today());
  } catch (error) {
    return false;
  }
}

// How long a response may be shared, by endpoint (and, for games, by the dates asked for).
function ttlFor(path, params, body) {
  if (/^\/nba\/v2\/odds/.test(path)) return TTL.props;
  if (path === "/v1/player_injuries" || path === "/nba/v2/stats/advanced") return TTL.medium;
  if (path === "/v1/teams") return TTL.past;

  if (path === "/v1/stats") {
    // A game's box score can still be changing, but once every game in it was Final before today (head-to-head history) it is settled.
    if (params.has("game_ids[]")) return allGamesSettled(body) ? TTL.past : TTL.box;
    return isPastSeason(params) ? TTL.past : TTL.medium;           // last season's logs never change; this season's change daily
  }

  if (path === "/v1/games" || /^\/v1\/games\/\d+$/.test(path)) {
    // A whole past season, or days that are already over, are past games.
    const lastDay = params.get("end_date") || params.get("start_date");
    if (lastDay && lastDay < today()) return TTL.past;
    if (!lastDay && params.has("seasons[]")) return isPastSeason(params) ? TTL.past : TTL.games;
    return anyLiveGame(body) ? TTL.live : TTL.games;
  }

  return isPastSeason(params) ? TTL.past : TTL.season; // standings, team and season averages, players
}

function reply(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return reply(405, { error: "Only GET is allowed." }, { "Cache-Control": "no-store" });

  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) return reply(500, { error: "BALLDONTLIE_API_KEY is not set on the server." }, { "Cache-Control": "no-store" });

  // The query string as the browser sent it (arrays like team_ids[]=1&team_ids[]=2 stay intact).
  let rawQuery = event.rawQuery;
  if (rawQuery === undefined) {
    const multi = event.multiValueQueryStringParameters || {};
    rawQuery = Object.entries(multi).flatMap(([name, values]) => values.map((value) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)).join("&");
  }
  const params = new URLSearchParams(rawQuery);

  // The API path: either after /api/bdl (the redirect keeps the original path) or in ?path=/v1/...
  let path = params.get("path");
  params.delete("path");
  if (!path) path = (event.path || "").replace(/^(\/api\/bdl|\/\.netlify\/functions\/bdl)/, "");
  path = path.replace(/\/+$/, "");

  if (path.includes("..") || !ALLOWED_PATHS.some((pattern) => pattern.test(path))) {
    return reply(403, { error: "That endpoint is not allowed." }, { "Cache-Control": "no-store" });
  }

  const query = params.toString();
  if (query.length > 4000) return reply(414, { error: "Query too long." }, { "Cache-Control": "no-store" });

  let upstream;
  try {
    upstream = await fetch(`${API_ORIGIN}${path}${query ? `?${query}` : ""}`, { headers: { Authorization: key } });
  } catch (error) {
    return reply(502, { error: "Could not reach BALLDONTLIE." }, { "Cache-Control": "no-store" });
  }

  const body = await upstream.text();
  if (!upstream.ok) {
    // Errors (401, 429, 5xx...) pass through with their status, and are never cached.
    return reply(upstream.status, body || { error: `Upstream status ${upstream.status}` }, { "Cache-Control": "no-store" });
  }

  const seconds = ttlFor(path, params, body);
  return reply(200, body, {
    "Cache-Control": "public, max-age=0, must-revalidate",                       // the browser always checks...
    "Netlify-Vary": "query",                                                     // ...and the CDN keeps one copy per full query string
    "Netlify-CDN-Cache-Control": `public, s-maxage=${seconds}, stale-while-revalidate=${seconds}`, // ...Netlify's CDN shares the answer
  });
};
