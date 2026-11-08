# Handoff: LineHunter UI design thread (Nov 8, 2026)

Paste this at the start of the new thread. Read `CLAUDE.md` too: it describes every page, and the "Indigo restyle (Nov 2026, branch design-tweaks)" section lists everything this thread built.

## Who does what

- **This thread (UI):** front-end design only (HTML pages, `css/styles.css`, `js/components/`, `js/pages/`).
- **Engine thread:** owns `netlify/functions/hunt.js`, the `/api/hunt` redirect in `netlify.toml`, and everything in `dev/`. Don't edit those here.
- **Johnatan** (GitHub `linehunter00-rgb`): PR #5 (`origin/landing-page`), a beta prototype in `beta-website/` plus a root `landing.html`. Not merged. Its look is the reference for the site's design.

## Owner's standing rules

- Batch work on a local branch. Push to `main` only when the owner says so, in one push, to save Netlify deploy credits.
- Push as a fast-forward straight to main: `git push origin <branch>:main`. Don't push feature branches or open PRs unless asked (each can trigger a Netlify deploy preview).
- Mockup first, then build (the owner approves each mockup).
- Commit messages end with the co-author line the session gives you.

## Where things stand

- `main` = everything from this thread, pushed Nov 8 (the last push included this file).
- Tag `swiss-design-v1` = the old Swiss design, if a rollback is ever needed.
- Design worktree: `/home/moecodin/Documents/LineHunter-design` (branch `design-tweaks-2`, same commit as main). The main checkout `/home/moecodin/Documents/LineHunter-Claude` is on the engine branch; don't switch it.
- For new work, start a fresh branch from `origin/main` in the design worktree.

## The design (decided)

- **Look:** the beta's indigo "Night Scout" look (`beta-website/DESIGN.md` in PR #5), not Swiss. Tokens are at the top of `css/styles.css` (dark and light). Fonts are Clash Display (headings, numbers) and Satoshi (body), loaded from Fontshare as two separate links. Corners: 12px panels, 8px controls, 4.8px inner, pill chips; bars stay square.
- **Labels:** sentence case everywhere. Caps only for the Today eyebrow, game-card times and small status tags.
- **Hunt Score is beta-only.** It shows only on `hunt-score.html` (with a game-model section) and `hunt-model.html`, both tagged Beta in Tools. The Board, player and game pages show no Hunt Score (`BOARD_HUNT = false` in `js/components/board.js`).
- **The Board** lives on Today and Tools › The Board only. The game page has "Top hit rates" (`js/components/gameTopHits.js`).
- **Homepage tagline:** "Research the line. Then hunt it."
- **From the Swiss design:**
  - Built: 1, one left edge per section; 2, thin rules instead of boxes inside panels.
  - Approved next: 3 to 6 (see the to-do).

## To-do, in order

1. **Swiss ideas 3 to 6** (approved from a before / after mockup; build them site-wide):
   - **3, section labels:** a small muted sentence-case label above every panel title ("Form" over "Prop chart", "Matchup", "History", "Lineup", "Volume", "Minutes", "Shooting", "Roster", "Status"). The player page markup still has `data-lh-kicker="..."` on its titles. The `::before` that drew them is turned off in `.lh-pp [data-lh-kicker]::before` and `.lh-gp ...`; re-enable it in muted sentence case (0.75rem, `--lh-muted`, no caps) and add kickers to the game, Board, Matchup and tool pages.
   - **4, number strips:** big numbers in one row split by thin vertical rules, tiny labels above. Apply to the chart summary (hit rate / average, adding Last 5 and Season), season averages, Opportunity, and the Board's opened-row averages. The Analyzer's Defender check (`.lh-mx-tile`) is already done this way and can be the model.
   - **5, one spacing step:** 12px between panels and 16px padding inside, everywhere. Remove one-off gaps.
   - **6, color only for meaning:** teal / rose only for over / under; periwinkle only for selected or active; team color only on the photo circle and the team badge. Names, labels and chips stay neutral. One exception: hit-rate numbers keep the beta's how-often colors (rose under 50%, gold 50–74%, teal 75%+).
2. **Quick look on Today:** the wheel replaced the old game cards and their Quick look (injuries, top prop). Add a small panel under the front game.
3. **The Board's opened row:**
   - It lost projected minutes, opponent rank, pace and back-to-back with the Hunt Score. Bring them back from team stats directly.
   - Restyle the big thin averages (they'll be covered by item 4).
4. **Homepage Top Hit Rates card:** it uses the old row layout. Reuse the game page's Top hit rates rows.
5. **Later:** player photos (set `PLAYER_PHOTO_URL` in `js/components/playerPhoto.js` once there's a source), line history / movement, sign-in and My Picks (placeholders in the More sheet).

## Testing locally

- Run `netlify dev --offline -p 8899` in the design worktree (it needs `.env`; the worktree has its own gitignored copy whose `SITE_PASSWORD` was set to the site password the owner gave).
- Open `http://localhost:8899/`. The password gate covers every page; to see the gate signed out, use `http://127.0.0.1:8899/`.
- **API rate limit:** after many reloads the API answers "Too many requests" and cards stay on loading. Wait a minute.
- **Hidden browser pane:** when the in-app browser pane is hidden, sections that load on scroll (game page ratings) never trigger and screenshots go stale. Check with JS measurements instead.
- Mockups live in `design/indigo-mockup/` (home, player, player-mobile, game). They're published too, behind the password, unlinked and noindex. The owner is fine with that.

## Bugs fixed this thread (in case something similar shows up)

- **Class clash:** a class named `.lh-sheet` on the homepage hid the phone Tools / Search / More sheets. Check new class names for clashes (`grep -n "\.lh-yourname" css/styles.css`).
- **Cached slate:** a cached slate drew before later scripts loaded, so the Hit List and Streaks stayed on "Loading...". `loadTopHitRates` now waits for `DOMContentLoaded`.
