# Hunt Score engine: work in progress (handoff)

Branch: `claude/relaxed-noether-3n6x6c` (nothing here is on main yet). Engine: `netlify/functions/hunt.js`. Full description: the
"Hunt Score engine" section of `CLAUDE.md`. Runs on localhost with the key in `.env`, or in a cloud
session: the environment's network secret adds the key as the Authorization header, so set a placeholder and let Node use the
proxy:

    BALLDONTLIE_API_KEY=placeholder NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt NODE_NO_WARNINGS=1 node dev/hunt-whatif.js

## Done on the branch
- Traded-player rule (last season's games with his current team only), Role step (tonight's lineup; position rule; 80%
  short-night cut; 3+ games), the big-gap rule (lean up to 70% on the book line past a 25% gap), and every side carries
  `odds`, `fair` (the book's fair chance, cut removed) and `edge` (chance − fair).
- `dev/hunt-whatif.js`: old vs new engine for the top hunts, top 10 by edge, overs vs unders, the under-bias check, the
  calibration check, Role games and "why no Role" per hunt.
- `dev/hunt-backtest-check.js`: showed BALLDONTLIE does NOT keep pregame prop lines for finished games (only a few live
  milestone leftovers). Its verdict line is too generous: it should require pregame over/under lines. Fix it.

## Role step lineup check (added Oct 28, after Fears)
Fears' Role step counted three April 2026 games (36 / 36 / 40 pts in 38-44 min, "without Missi") that were tank games with 4 other
rotation players out; that put his Oct 28 projection at 13.5 vs a 11.5 line. Role games now carry `extras` = other rotation teammates
(slate players, 15+ usual min) absent that night; 1 extra = half weight, 2+ = dropped (`CONFIG.sim.role.extraKeep`,
`buildRotation`). Same-position uses ANY shared listed letter (Sengun "F-C" vs Capela "C"), and 2 role games are enough then.
Results Oct 28: Fears over 52 / proj 13.5 -> under 55 / proj 11.9; Capela 71 -> 65 (proj 6.0 vs 6.5). Not yet handled: players
who LEFT the team (LeBron) are not in the rotation, so games with them still look like tonight's lineup.

## What we learned (Oct 28 slate)
- The sim matches history (calibration: 55% sim vs 55% history), so the shape is fine.
- 94-99% of 65+ scores are unders, and the top 10 by edge was 10/10 unders (average edge: unders +4.4, overs −4.3).
  Lines sit above the players' history; either the books know about grown roles (likely in October) or they shade overs.
  Only graded results can tell: hence the snapshot + grade backtest below.

## In progress: save tonight, grade tomorrow, replay with a tuned engine
- Engine: `io.record` / `io.replay` + `exports.computeWith(date, { record, replay })` (inert on the site).
- `dev/hunt-lib.js` (shared helpers, pick lists) and `dev/hunt-snapshot.js` (saves per game: game, raw props, injury rows,
  scored sides, takenAt, engine version; keeps each game's last snapshot before tip-off). First snapshot: Oct 28, 12 games,
  1,254 sides, taken 30 min before the first tip (17 s per engine run in the cloud).
- TODO `dev/hunt-grade.js`: for each `dev/snapshots/*.json` day, box scores (`/v1/stats?game_ids[]=`), grade each side
  (win / loss / push, profit per $100 at the saved odds), report: overall, by edge bucket (<0, 0-5, 5-10, 10-15, 15+), by
  side, by score bucket, nightly top 10 by edge, nightly top 5 by score, "always under", Brier ours vs the book's fair chance.
  `--replay`: rebuild `{ games, props, injuries }` per day from the snapshot, run `engine.computeWith(date, { replay })` with
  the current engine, grade that too, and print saved vs replay side by side. (Team-level numbers are season-to-date as of
  the replay: a small leak.)
- Snapshots are taken from this cloud thread for now (scheduled check-ins); the local cron was skipped. LATER: move the nightly
  snapshot + grade to a Netlify scheduled function with Netlify Blobs (same data as the parked "results on The Board").

## Snapshot backup
The container's `dev/snapshots/` is lost if the cloud session is reclaimed. Each night's file is also pushed gzipped (about 0.5 MB)
to the data-only branch `hunt-snapshots` (`snapshots/YYYY-MM-DD.json.gz`, never merged). Restore: `git fetch origin hunt-snapshots`,
`git show origin/hunt-snapshots:snapshots/2026-10-28.json.gz | gunzip > dev/snapshots/2026-10-28.json`. After every snapshot run, push the
updated file there too (orphan branch in a temporary worktree).

## Players being compared with Sam's model (Oct 28)
Jokic pts (Sam: proj 28.3, line 27.5, over), Fears pts (Sam: proj 18.0, line 11.5, over), McCain pts, Capela pts (Sam's numbers
to be added). Replay these with the current engine against the box scores in the grade report.

## Parked engine ideas
Rank top hunts by edge (top 10); lineup then vs now in Role (Reaves' "without Luka" games still had LeBron); a position matchup
step ("centers vs MIL") from the Same Position card's data; Role for players with no matching games yet (Richardson, Shead).
