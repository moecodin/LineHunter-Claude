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
- TODO: `.gitignore` `dev/snapshots/`; cron lines for the user's machine (hourly noon-10pm ET snapshot, morning grade; use the
  full path from `which node`, `cd` into the repo, append to `dev/snapshots/cron.log`; check the machine's time zone).

## Parked engine ideas
Rank top hunts by edge (top 10); lineup then vs now in Role (Reaves' "without Luka" games still had LeBron); a position matchup
step ("centers vs MIL") from the Same Position card's data; Role for players with no matching games yet (Richardson, Shead).
