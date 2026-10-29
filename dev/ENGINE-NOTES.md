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
- DONE (first version, Oct 29): `dev/hunt-grade.js` (see CLAUDE.md). It was the TODO below:
- (old TODO text) `dev/hunt-grade.js`: for each `dev/snapshots/*.json` day, box scores (`/v1/stats?game_ids[]=`), grade each side
  (win / loss / push, profit per $100 at the saved odds), report: overall, by edge bucket (<0, 0-5, 5-10, 10-15, 15+), by
  side, by score bucket, nightly top 10 by edge, nightly top 5 by score, "always under", Brier ours vs the book's fair chance.
  `--replay`: rebuild `{ games, props, injuries }` per day from the snapshot, run `engine.computeWith(date, { replay })` with
  the current engine, grade that too, and print saved vs replay side by side. (Team-level numbers are season-to-date as of
  the replay: a small leak.)
- Snapshots are taken from this cloud thread for now (scheduled check-ins); the local cron was skipped. LATER: move the nightly
  snapshot + grade to a Netlify scheduled function with Netlify Blobs (same data as the parked "results on The Board").

## Replaying any engine version on a snapshot
`dev/hunt-replay.js` (`loadSnapshot`, `runEngineOn(enginePath, snap)`) serves the saved games / props / injuries through a wrapped
fetch and a frozen Date.now, so main's old engine (`git show origin/main:netlify/functions/hunt.js > some/file.js`) and this
branch's engine score the same saved night. Check: main's engine replayed on the Oct 28 snapshot reproduced the live site's numbers
(Fears under 53, McCain 80, Capela 78). The grader should use it for "old vs new".

## First grade (Oct 28, 9 of 12 games final, replayed on the 6:30 pm lines)
About 1,000 sides graded. Below score 65 both engines were fair (we said 46-59%, won 49-52%). From 65 up we overstate by 8-10 points
(65-69: said 67, won 57-59%; 70+: 31-33%, only 6-16 picks). Edge 10-14 won 55%, edge 15+ won 40% (35 picks), overs at edge 5+ won 39%
(49 picks), every under won 55% (the baseline). Score 65+ by stat (new engine): PTS 5/15 (33%), 3PM 10/15, PRA 6/11, REB 3/5, AST 3/4.
Top 5 by score: 1 of 5 each engine; top 10 by edge: 5 of 10. Sam on the four players: Jokic, Fears, Capela all wrong (McCain pending).
One night only: do not tune on it. Capela played 22 min (the Role step said 19.4, Sam 9) but scored 10, so the minutes call was right
and the per-minute rate was low.

## Snapshot backup
The container's `dev/snapshots/` is lost if the cloud session is reclaimed. Each night's file is also pushed gzipped (about 0.5 MB)
to the data-only branch `hunt-snapshots` (`snapshots/YYYY-MM-DD.json.gz`, never merged). Restore: `git fetch origin hunt-snapshots`,
`git show origin/hunt-snapshots:snapshots/2026-10-28.json.gz | gunzip > dev/snapshots/2026-10-28.json`. After every snapshot run, push the
updated file there too (orphan branch in a temporary worktree).

## Players being compared with Sam's model (Oct 28)
Sam's card (davidsasser.com): projection vs line, side, his L10 avg minutes. His L10 mixes last season's games (playoffs
included) with this season's, and he has no lineup information. Numbers typed from screenshots:

| Player | Sam | Ours at 6:30 pm snapshot (old engine ea3e1fc) | Ours with the lineup fix (b62a476) |
|---|---|---|---|
| Jokic pts | proj 28.3, line 27.5, Over | Over 26.5: 51, edge 0, proj 27.5 | not re-run |
| Fears pts | proj 18.0, line 11.5, Over (+6.5), L10 avg 21.9, 32 min | Over 11.5: 52, proj 13.5 | Under 55, proj 11.9, edge +4 |
| McCain pts | proj 13.7, line 17.5, Under (-3.8), 25.1 min | Under 17.5: 68, proj 15.1 | Under 67, proj 15.3, Role 20.1 -> 25.6 min |
| Capela pts | proj 2.1, line 7.5, Under (-5.4), L10 avg 4.0, 9.0 min | Under 6.5: 66, proj 5.8 | Under 65, proj 6.0, Role 10.5 -> 19.4 min |

Capela is the big disagreement: Sam has him at 9 minutes (no lineup knowledge; Sengun and Smart are out), the engine at about 19.
The line also moved from 7.5 (Sam's older snapshot) to 6.5 (DraftKings at 6:30 pm). Grade all four against the box scores.

## Parked engine ideas
Rank top hunts by edge (top 10); lineup then vs now in Role (Reaves' "without Luka" games still had LeBron); a position matchup
step ("centers vs MIL") from the Same Position card's data; Role for players with no matching games yet (Richardson, Shead).
