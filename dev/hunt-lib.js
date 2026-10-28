// LineHunter - dev/hunt-lib.js
// Shared by dev/hunt-snapshot.js and dev/hunt-grade.js (console tools, not part of the site): the key from .env, a small
// BALLDONTLIE helper, the snapshot folder, and the pick lists the grader scores (top 10 by edge, top 5 by score).

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
if (!process.env.BALLDONTLIE_API_KEY) {
  try {
    const match = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^BALLDONTLIE_API_KEY\s*=\s*"?([^"\n\r]+)"?/m);
    if (match) process.env.BALLDONTLIE_API_KEY = match[1].trim();
  } catch (error) { /* no .env: the error below says so */ }
}
if (!process.env.BALLDONTLIE_API_KEY) throw new Error("BALLDONTLIE_API_KEY is missing: put it in .env (see .env.example).");

const engine = require(path.join(root, "netlify/functions/hunt.js"));
const snapshotDir = path.join(__dirname, "snapshots");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function bdl(pathAndQuery, attempt = 0) {
  const response = await fetch(`https://api.balldontlie.io${pathAndQuery}`, { headers: { Authorization: process.env.BALLDONTLIE_API_KEY } });
  if (response.status === 429 && attempt < 4) { await sleep(800 * (attempt + 1)); return bdl(pathAndQuery, attempt + 1); }
  if (!response.ok) throw new Error(`BALLDONTLIE answered ${response.status} for ${pathAndQuery.split("?")[0]}`);
  return response.json();
}
async function bdlAll(pathAndQuery) {
  const items = [];
  let cursor = null;
  do {
    const json = await bdl(cursor ? `${pathAndQuery}&cursor=${cursor}` : pathAndQuery);
    items.push(...json.data);
    cursor = json.meta && json.meta.next_cursor;
  } while (cursor);
  return items;
}

const etDate = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

// The engine version a snapshot was taken with: the commit, plus "+changes" when the working copy has uncommitted edits.
function engineVersion() {
  try {
    const commit = execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain netlify/functions/hunt.js", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return dirty ? `${commit}+changes` : commit;
  } catch (error) {
    return "unknown";
  }
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const snapshotFile = (date) => path.join(snapshotDir, `${date}.json`);
const snapshotDates = () => (fs.existsSync(snapshotDir) ? fs.readdirSync(snapshotDir) : [])
  .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).map((name) => name.slice(0, 10)).sort();

// The pick lists, the same rules as the what-if: one pick per player, injured players left out.
const PICKS = { edge: { size: 10, minChance: 55 }, score: { size: 5, minScore: 65 } };
function bestPerPlayer(sides, better) {
  const best = {};
  sides.forEach((p) => { if (!best[p.playerId] || better(p, best[p.playerId])) best[p.playerId] = p; });
  return Object.values(best);
}
const topByEdge = (sides) => bestPerPlayer(sides.filter((p) => !p.injured && p.chance >= PICKS.edge.minChance && Number.isFinite(p.edge)), (a, b) => a.edge > b.edge)
  .sort((a, b) => b.edge - a.edge).slice(0, PICKS.edge.size);
const topByScore = (sides) => bestPerPlayer(sides.filter((p) => !p.injured && p.score >= PICKS.score.minScore), (a, b) => a.score > b.score)
  .sort((a, b) => b.score - a.score).slice(0, PICKS.score.size);

const pad = (text, n) => String(text).padEnd(n);
const padL = (text, n) => String(text).padStart(n);
const statWord = (code) => (code === "3pm" ? "3PM" : String(code).toUpperCase());

module.exports = { root, engine, snapshotDir, bdl, bdlAll, etDate, engineVersion, readJson, snapshotFile, snapshotDates, PICKS, topByEdge, topByScore, pad, padL, statWord };
