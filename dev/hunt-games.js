// LineHunter - dev/hunt-games.js
// The Game Breakdown model (the spread and total picks of js/components/gameBreakdown.js) outside the browser, plus a grader for it
// (a console tool, not part of the site).
//
//   node dev/hunt-games.js 2026-10-29          grade the saved night: the book's line vs ours vs the final score, hit / miss
//
// How it works: gameBreakdown.js is loaded unchanged into a Node `vm` context with a few stubs (bdlGet / bdlGetAllPages go to the
// API, the injury report and the game odds come from the snapshot when it has them), so the model here is exactly the site's.
// dev/hunt-snapshot.js calls modelFor() before tip-off and saves { gameOdds, model } per game; this file grades them the next day.
// The book's PREGAME lines can't be fetched later (the API only keeps in-game lines for a finished game), so a night without
// saved gameOdds can show our model vs the final score but not a hit / miss against the book.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "../js/components/gameBreakdown.js"), "utf8");
const BDL_BASE = "/api/bdl/v1";

function makeContext({ injuryRows = null, odds = null, bdl, bdlAll }) {
  const toPath = (url) => String(url).replace(/^\/api\/bdl/, "");
  const context = {
    console, structuredClone, Number, Object, Promise, Math, Date, String, Array, JSON, isFinite, parseFloat,
    BDL_BASE,
    bdlGet: async (url) => {
      const p = toPath(url);
      if (/^\/nba\/v2\/odds/.test(p) && odds) return { data: odds };
      return bdl(p);
    },
    bdlGetAllPages: async (url) => {
      const p = toPath(url);
      if (/^\/v1\/player_injuries/.test(p) && injuryRows) {
        const ids = [...p.matchAll(/team_ids\[\]=(\d+)/g)].map((m) => Number(m[1]));
        return injuryRows.filter((row) => row.player && ids.includes(row.player.team_id));
      }
      return bdlAll(p);
    },
  };
  vm.createContext(context);
  vm.runInContext(SOURCE, context, { filename: "gameBreakdown.js" });
  return context;
}

// { model, odds, picks, ... } exactly as the card computes it, or { error }. `odds` = every book's game-odds rows (saved), else live.
const memo = new Map(); // the same team-ratings request is made for every game of a slate: ask once
const remember = (fn) => (p) => { const key = `${fn.name}:${p}`; if (!memo.has(key)) memo.set(key, fn(p)); return memo.get(key); };
async function modelFor(game, { injuryRows = null, odds = null, bdl, bdlAll }) {
  const context = makeContext({ injuryRows, odds, bdl: remember(bdl), bdlAll: remember(bdlAll) });
  context.__game = game;
  return vm.runInContext("gameModelFor(__game)", context);
}

// What the snapshot saves about our model for one game (small, plain numbers).
function summarize(result) {
  if (!result || result.error || !result.model) return { error: (result && result.error) || "no model" };
  const m = result.model;
  const p = result.picks || {};
  return {
    awayPts: m.awayPts, homePts: m.homePts, total: m.total, margin: m.homePts - m.awayPts,
    odds: result.odds || null,
    spread: p.spread ? { side: p.spread.side || null, team: p.spread.team || null, text: p.spread.text, gap: p.spread.gap, strength: p.spread.strength } : null,
    totalPick: p.total ? { side: p.total.side, text: p.total.text, gap: p.total.gap, strength: p.total.strength } : null,
    tired: m.tired || null,
    missing: (m.missing || []).map((x) => ({ name: x.name, abbr: x.abbr, status: x.status, loss: x.loss })),
  };
}

module.exports = { modelFor, summarize };

// ---------------- grader ----------------
if (require.main === module) {
  const { snapshotFile, snapshotDates, readJson, bdl, pad, padL } = require("./hunt-lib");
  const date = process.argv[2] || snapshotDates().slice(-1)[0];
  (async () => {
    const snap = readJson(snapshotFile(date));
    const rows = [];
    for (const saved of Object.values(snap.games)) {
      const fresh = (await bdl(`/v1/games/${saved.game.id}`)).data;
      if (fresh.status !== "Final") continue;
      const a = fresh.visitor_team.abbreviation;
      const h = fresh.home_team.abbreviation;
      const actual = { away: fresh.visitor_team_score, home: fresh.home_team_score };
      actual.margin = actual.home - actual.away;
      actual.total = actual.home + actual.away;
      const m = saved.model && !saved.model.error ? saved.model : null;
      const book = m && m.odds ? m.odds : null; // { total, spreadHome, vendor }
      rows.push({ label: `${a} @ ${h}`, tip: fresh.datetime, actual, model: m, book });
    }
    rows.sort((x, y) => Date.parse(x.tip) - Date.parse(y.tip));
    const out = [];
    out.push(`GAME LINES · ${date} · ${rows.length} final games · the book = ${[...new Set(rows.filter((r) => r.book).map((r) => r.book.vendor))].join(", ") || "none saved"}, our model = the Game Breakdown card`);
    const fmt = (v, signed) => (v === null || v === undefined ? "  –" : (signed && v > 0 ? "+" : "") + (Math.round(v * 10) / 10));
    const hit = (ok) => (ok === null ? "  –" : ok ? "HIT " : "miss");
    out.push("");
    out.push(`  ${pad("Game", 11)} ${pad("Final", 9)} | ${pad("SPREAD (home)", 36)} | ${pad("TOTAL", 43)}`);
    out.push(`  ${pad("", 11)} ${pad("", 9)} | ${pad("book", 7)} ${pad("ours", 7)} ${pad("our pick", 14)} result | ${pad("book", 6)} ${pad("ours", 7)} ${pad("our pick", 14)} result  closer`);
    const tally = { spread: { n: 0, hit: 0 }, total: { n: 0, hit: 0 }, winner: { n: 0, hit: 0 }, bookErr: [], ourErr: [], bookTot: [], ourTot: [] };
    rows.forEach((r) => {
      const { actual, model, book } = r;
      let spreadCell = `${pad("–", 7)} ${pad("–", 7)} ${pad("", 14)}        `;
      let totalCell = `${pad("–", 6)} ${pad("–", 7)} ${pad("", 14)}`;
      let extra = "";
      if (model) {
        const ourMargin = model.margin;
        const winnerOk = (ourMargin > 0) === (actual.margin > 0);
        tally.winner.n++; if (winnerOk) tally.winner.hit++;
        let spreadHit = null;
        let spreadPick = "";
        if (book && book.spreadHome !== null && model.spread && !model.spread.even) {
          const covered = actual.margin + book.spreadHome; // > 0: the home team covered its line
          spreadHit = covered === 0 ? null : (model.spread.side === "home") === (covered > 0);
          spreadPick = model.spread.text;
          if (spreadHit !== null) { tally.spread.n++; if (spreadHit) tally.spread.hit++; }
        }
        spreadCell = `${pad(book && book.spreadHome !== null ? fmt(-book.spreadHome, true) : "–", 7)} ${pad(fmt(ourMargin, true), 7)} ${pad(spreadPick, 14)} ${hit(spreadHit)}  `;
        let totalHit = null;
        let totalPickText = "";
        if (book && Number.isFinite(book.total) && model.totalPick && model.totalPick.side !== "none") {
          totalHit = actual.total === book.total ? null : (model.totalPick.side === "over") === (actual.total > book.total);
          totalPickText = model.totalPick.text;
          if (totalHit !== null) { tally.total.n++; if (totalHit) tally.total.hit++; }
        }
        totalCell = `${pad(book && Number.isFinite(book.total) ? String(book.total) : "–", 6)} ${pad(fmt(model.total), 7)} ${pad(totalPickText, 14)} ${hit(totalHit)}`;
        if (book && Number.isFinite(book.total)) {
          const be = Math.abs(book.total - actual.total);
          const oe = Math.abs(model.total - actual.total);
          tally.bookTot.push(be); tally.ourTot.push(oe);
          extra = ` ${oe < be ? "ours" : oe > be ? "book" : "tie"}`;
        }
        if (book && book.spreadHome !== null) { tally.bookErr.push(Math.abs(-book.spreadHome - actual.margin)); tally.ourErr.push(Math.abs(ourMargin - actual.margin)); }
      }
      out.push(`  ${pad(r.label, 11)} ${pad(`${actual.away}-${actual.home}`, 9)} | ${spreadCell}| ${totalCell}${extra}`);
    });
    const avg = (l) => (l.length ? (l.reduce((a, b) => a + b, 0) / l.length).toFixed(1) : "–");
    out.push("");
    out.push("RECORD");
    out.push(`  our winners (straight up)     ${tally.winner.hit}-${tally.winner.n - tally.winner.hit}`);
    out.push(`  our spread picks vs the book  ${tally.spread.hit}-${tally.spread.n - tally.spread.hit}${tally.spread.n ? "" : "   (no saved book spread)"}`);
    out.push(`  our total picks vs the book   ${tally.total.hit}-${tally.total.n - tally.total.hit}${tally.total.n ? "" : "   (no saved book total)"}`);
    out.push(`  average miss on the margin    book ${avg(tally.bookErr)}  ·  ours ${avg(tally.ourErr)}`);
    out.push(`  average miss on the total     book ${avg(tally.bookTot)}  ·  ours ${avg(tally.ourTot)}`);
    const text = out.join("\n");
    console.log(text);
    fs.writeFileSync(path.join(__dirname, "hunt-games.txt"), `${text}\n`);
  })().catch((error) => { console.error(error.message || error); process.exit(1); });
}
