// LineHunter - dev/hunt-snapshot.js
// Saves today's Hunt Score slate before the games, for dev/hunt-grade.js to grade the next morning (a console tool, run by cron
// on localhost; not part of the site). Past prop lines and injury reports can't be fetched later, so this keeps them.
//
//   node dev/hunt-snapshot.js              today (America/New_York)
//
// Each run scores the games that have not started yet and saves, per game, what the engine saw and said:
//   game       the game as it stood (tip-off, teams)
//   props      every book's raw player props for it (the engine's input; replayed by `hunt-grade.js --replay`)
//   injuries   the injury report rows for its two teams at that hour
//   sides      every scored side (line, odds, chance, fair chance, edge, score, factors, why)
//   takenAt    when, and version = the engine's commit (+changes = uncommitted edits)
// Run it as often as you like (cron: hourly in the afternoon and evening): a game keeps its LAST snapshot before tip-off, so the
// lines and injury news are as fresh as they were when the game started. Files: dev/snapshots/YYYY-MM-DD.json (gitignored).

const fs = require("fs");
const { engine, snapshotDir, etDate, engineVersion, readJson, snapshotFile } = require("./hunt-lib");

(async () => {
  const date = etDate();
  const takenAt = new Date().toISOString();
  const version = engineVersion();
  engine.CONFIG.retries = 6; // wait longer on rate limits before giving up on a request
  let result;
  for (let attempt = 0; ; attempt++) { // `partial` = some data requests failed for good and were skipped: wait and run again
    result = await engine.computeWith(date, { record: true });
    if (!result.body.partial || attempt >= 2) break;
    await new Promise((resolve) => setTimeout(resolve, 20000));
  }
  const { body, inputs } = result;
  if (body.partial) console.warn(`${takenAt} · ${date}: PARTIAL snapshot, ${body.partial} request(s) skipped: ${body.skipped.join(" | ")}`);
  const games = (inputs && inputs.games) || [];
  if (!games.length) {
    console.log(`${takenAt} · ${date}: no games left to tip off, nothing saved.`);
    return;
  }

  fs.mkdirSync(snapshotDir, { recursive: true });
  const file = snapshotFile(date);
  const saved = fs.existsSync(file) ? readJson(file) : { date, games: {} };
  const injuries = inputs.injuries || [];
  let updated = 0;
  games.forEach((game) => {
    const teamIds = [game.home_team.id, game.visitor_team.id];
    saved.games[game.id] = {
      takenAt, version, game,
      props: (inputs.props && inputs.props[game.id]) || [],
      injuries: injuries.filter((row) => row.player && teamIds.includes(row.player.team_id)),
      sides: body.props.filter((p) => p.gameId === game.id),
    };
    updated++;
  });
  saved.updatedAt = takenAt;
  fs.writeFileSync(file, JSON.stringify(saved));

  const sides = Object.values(saved.games).reduce((n, g) => n + g.sides.length, 0);
  console.log(`${takenAt} · ${date} · engine ${version}: saved ${updated} game(s) not started yet (${body.props.length} sides); the file holds ${Object.keys(saved.games).length} game(s), ${sides} sides.`);
})().catch((error) => { console.error(`${new Date().toISOString()} · snapshot failed: ${error.message || error}`); process.exit(1); });
