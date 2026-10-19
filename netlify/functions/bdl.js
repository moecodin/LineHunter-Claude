// LineHunter - netlify/functions/bdl.js
// A small proxy between the site and BALLDONTLIE, so the API key stays on the server and never reaches the browser.
//
//   Browser:  GET /api/bdl/v1/games?start_date=2026-10-20&end_date=2026-10-20     (or /api/bdl?path=/v1/games&start_date=...)
//   netlify.toml sends /api/bdl/* here; this function checks the path against an allowlist, adds the key from the
//   BALLDONTLIE_API_KEY environment variable, calls https://api.balldontlie.io and returns the JSON.
//
// Cache headers let Netlify's CDN share one answer between visitors (the cache is per full URL, query included):
//   about 1 minute   live data: games from today on, box scores
//   about 10 minutes props / odds, injuries, player game logs, advanced stats
//   about 6 hours    season-level data: standings, team and season averages, teams, players, past games

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
  /^\/nba\/v1\/season_averages\/shooting$/,
  /^\/nba\/v2\/odds$/,
  /^\/nba\/v2\/odds\/player_props$/,
  /^\/nba\/v2\/stats\/advanced$/,
];

const MINUTE = 60;
const TTL = { live: MINUTE, medium: 10 * MINUTE, season: 6 * 60 * MINUTE };

function today() {
  return new Date().toISOString().slice(0, 10);
}

// How long a response may be shared, by endpoint (and, for games, by the dates asked for).
function ttlFor(path, params) {
  if (/^\/nba\/v2\/odds/.test(path) || path === "/v1/player_injuries" || path === "/nba/v2/stats/advanced") return TTL.medium;

  if (path === "/v1/stats") {
    // A game's box score can still be changing; a player's season of game logs changes at most once a day.
    return params.has("game_ids[]") ? TTL.live : TTL.medium;
  }

  if (path === "/v1/games" || /^\/v1\/games\/\d+$/.test(path)) {
    // Games on or after today can be live. A whole season, or days that are already over, are past games.
    const end = params.get("end_date");
    const start = params.get("start_date");
    const lastDay = end || start;
    if (lastDay && lastDay < today()) return TTL.season;
    if (!lastDay && params.has("seasons[]")) return TTL.season;
    return TTL.live;
  }

  return TTL.season; // standings, teams, players, team and season averages
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

  const seconds = ttlFor(path, params);
  return reply(200, body, {
    "Cache-Control": "public, max-age=0, must-revalidate",                       // the browser always checks...
    "Netlify-CDN-Cache-Control": `public, s-maxage=${seconds}, stale-while-revalidate=${seconds}`, // ...Netlify's CDN shares the answer
  });
};
