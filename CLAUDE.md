# LineHunter project notes

## Pages
- `index.html` — dedicated homepage previewing LineHunter tools and value proposition, plus a live Top Hit Rates card
- `schedule.html` — today's games list and date pager; keeps the schedule view separate from the homepage
- `game.html` — matchup page for a selected game with player props
- `standings.html` — placeholder standings page
- `props.html` — placeholder player props page
- `player.html` — player page (`player.html?id=PLAYER_ID&prop=pts`): header with injury badge (popover) and next game, season averages strip, prop chart with tabs / L5–Season / All–Home–Away / alt line, and a game log table that follows the filters
- `hitrate-test.html` — console-only test page for the hit-rate functions

## Script usage
- `nav.js` — shared top navigation and drawer, plus the responsible gaming footer (`.lh-footer`), injected on every page that has `#site-nav`
- `app.js` — runs on `schedule.html` to load the current NBA schedule and pager
- `game.js` — runs on `game.html` to render the matchup and prop table; loads every player's game logs once (current season, plus last season when fewer than 20 games played). The table has an L5/L10/L20/Season toggle, a CSS mini bar graph, Hit % and Avg columns sortable by header click (default Hit % high→low). `WINDOWS`, `windowResult` and `renderWindowButtons` are shared with the drawer
- `js/stats.js` — shared stats code for the homepage and `game.html`: `bdlGet`/`bdlGetAllPages`, `fetchPlayers`, prop helpers (`propStatKey`, `PROP_CODES`, `pickOneLinePerPlayer`), `loadPlayerGameLogs` (batched `player_ids[]` requests in groups of 5, paginated, with the current → last season fallback), `calculateHitRate`, `hitRateForWindow`, and the `miniGraph` HTML helper
- `js/top-hit-rates.js` — homepage Top Hit Rates card: next slate (today or the next day with games), L10 over hit rates for PTS/REB/AST/3PM/PRA, min 8 games, cached in sessionStorage for 10 minutes. Rows link to `game.html?id=GAME&player=PLAYER&prop=pts`, which opens that player's drawer
- `js/share.js` — shared share-as-image code: `shareNodeAsImage` (off-screen `.lh-share-card` → PNG via html2canvas, loaded from cdnjs on first tap → share sheet, or download), `shareChartCard` (player, prop, line, hit rate, average + the chart via `chart.toImage()`), `SHARE_NOTE_HTML` (disclaimer + 1-800-GAMBLER). Used by the Hit List cards, a Share button on the player page's chart card, and one in the game page drawer header
- `js/hit-list.js` — schedule page "Hit List" card (right of Top Hit Rates): a grid of six small slip cards (Perfect Five, Under the Weather, Home Cookin' / Road Warriors, Bad Blood = vs tonight's opponent, Light It Up = team totals built from the player logs, Heat Check), 3–5 legs (2+ teams for Light It Up) each, with an inline "Combined odds" parlay ($10) link. No downloads of its own: `js/top-hit-rates.js` builds one "leg" per line (`buildHitListLeg`) and calls `showHitList(slate)`; legs are cached with the slate for 10 minutes. Each card has a share icon: `shareCategory` builds an off-screen `.lh-share-card` (logo, date, card, disclaimer + 1-800-GAMBLER note), draws it with html2canvas (loaded from cdnjs on first tap) and opens the share sheet, or downloads the PNG where files can't be shared. Legs link to `game.html?id=…&player=…&prop=…`
- `player-drawer.js` — right-side offcanvas on `game.html` with stat tabs, L5/L10/L20/Season toggle, hit rate, and the shared prop chart; reuses the logs `game.js` already loaded. Alt line is drawer-only and resets on player/prop change. Has an "Open player page →" link (`player.html?id=…&prop=…`)
- `js/propChart.js` — shared prop chart for the drawer and `player.html`: `createPropChart(container, { height, onLineChange })` builds the Chart.js bar chart, HTML tooltip (opponent, date, stat breakdown, minutes, W/L score), and alt line stepper (± 0.5, min 0.5, faint "Book" marker, Reset). Also `CHART_STAT_TABS`, `WINDOWS`, `renderToggleButtons`, `renderWindowButtons`
- `js/player.js` — runs on `player.html`: player, injuries, next game + that game's lines (`player_id` filter), and game logs (current → last season fallback). With no book line, the line starts at the season average rounded to .5 and is labeled "No line"
- `api.js` — shared team color helpers and palette data
- `config.js` — standalone API key source; not touched in the homepage/schedule split

## Shared navigation
- `nav.js` injects the shared top drawer navigation into each page.
- The drawer uses Bootstrap `offcanvas-top` and hides the desktop links behind the hamburger menu.
- The navbar is intentionally shared from one place so the logo, links, and drawer styling are updated in one file.

## Styling
- `styles.css` contains the dark-violet design tokens and custom drawer layout.
- The project keeps a violet accent palette and uses `--lh-accent` token values from the design system.

## Bootstrap Icons
- Bootstrap Icons are loaded from the CDN for the drawer tiles and section headings.
- Icons used in the navigation include basketball, calendar, trophy, and chart/graph items.

## Drawer design
- The drawer slides down from the top of the page.
- The right side contains a round close button with a thin violet border.
- The NBA group header uses the `.lh-label` style and a basketball icon.
- Links are arranged as tiles in a responsive grid, with a darker hover state and violet icon highlight.
- The Schedule link now points to `schedule.html`, while the homepage remains a static overview page.

## Homepage preview carousel
- The homepage uses a single Bootstrap carousel to rotate through the major LineHunter tools instead of a static four-card grid.
- Each slide follows the reference layout: left-aligned explainer text with a two-line headline, right-side phone-style mock card, and static sample data for the game, props, hit-rates, and standings tools.
- The mock cards pull from the shared `TEAM_COLORS` palette in `api.js` without making any API calls.
- The carousel includes fade transitions, five-second auto-advance, hover pause, dot indicators, and prev/next ghost-style arrows.
- Reduced-motion users get a static, non-animated slide experience and no auto-advance.

## API note
- `config.js` is not touched here. The project continues to keep API configuration separate from view logic.
- The homepage carousel's preview cards are static and do not call the API. The Top Hit Rates card below the carousel does (via `js/stats.js`), and the carousel's hit-rates slide links to it once data is available.
- The new standings and props pages are intentionally static placeholders and do not call the API yet.
