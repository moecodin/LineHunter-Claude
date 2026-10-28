// LineHunter - dev/hunt-replay.js
// Runs ANY version of the Hunt Score engine (this branch's, or main's old one saved to a file) on a saved snapshot, as if it were
// the moment the snapshot was taken (a console tool, not part of the site). It works by serving the three things that can't be
// fetched again later from the snapshot (the day's games, every book's props, the injury report) through a wrapped fetch and a
// frozen Date.now, so engines without the record / replay hooks work too. Everything else (game logs, team numbers) is the live API.
//
//   const { runEngineOn, loadSnapshot } = require("./hunt-replay");
//   const snap = loadSnapshot("2026-10-28");                       // dev/snapshots/DATE.json (or .json.gz)
//   const body = await runEngineOn("/path/to/hunt.js", snap);       // { props, topHunts, ... } as /api/hunt would answer

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function loadSnapshot(date) {
  const file = path.join(__dirname, "snapshots", `${date}.json`);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : zlib.gunzipSync(fs.readFileSync(`${file}.gz`)).toString("utf8");
  const snap = JSON.parse(text);
  const games = Object.values(snap.games);
  const takenAt = games.map((g) => Date.parse(g.takenAt)).sort((a, b) => a - b)[0]; // the earliest snapshot of the day
  return {
    date: snap.date, takenAt,
    games: games.map((g) => g.game),
    props: Object.fromEntries(games.map((g) => [g.game.id, g.props])),
    injuries: games.flatMap((g) => g.injuries),
    sidesByGame: Object.fromEntries(games.map((g) => [g.game.id, g.sides])),
  };
}

async function runEngineOn(enginePath, snap, { frozenAt = snap.takenAt } = {}) {
  const realFetch = global.fetch;
  const realNow = Date.now;
  const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  global.fetch = (url, options) => {
    const u = new URL(String(url));
    if (u.pathname === "/v1/games" && u.searchParams.get("start_date") === snap.date) return Promise.resolve(json({ data: snap.games, meta: {} }));
    if (u.pathname === "/nba/v2/odds/player_props") return Promise.resolve(json({ data: snap.props[u.searchParams.get("game_id")] || [], meta: {} }));
    if (u.pathname === "/v1/player_injuries") return Promise.resolve(json({ data: snap.injuries, meta: {} }));
    return realFetch(url, options);
  };
  Date.now = () => frozenAt;
  try {
    delete require.cache[require.resolve(enginePath)]; // a fresh engine: no warm cache from an earlier run
    const answer = await require(enginePath).handler({ httpMethod: "GET", queryStringParameters: { date: snap.date } });
    const body = JSON.parse(answer.body);
    if (answer.statusCode !== 200) throw new Error(`${path.basename(enginePath)}: ${body.error}`);
    return body;
  } finally {
    global.fetch = realFetch;
    Date.now = realNow;
  }
}

module.exports = { loadSnapshot, runEngineOn };
