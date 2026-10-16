# LineHunter project notes

## Pages
- `index.html` — dedicated homepage previewing LineHunter tools and value proposition
- `schedule.html` — today's games list and date pager; keeps the schedule view separate from the homepage
- `game.html` — matchup page for a selected game with player props
- `standings.html` — placeholder standings page
- `props.html` — placeholder player props page

## Script usage
- `nav.js` — shared top navigation and drawer, injected on every page
- `app.js` — runs on `schedule.html` to load the current NBA schedule and pager
- `game.js` — runs on `game.html` to render the matchup and prop table
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
- The homepage and static preview cards do not call the API.
- The new standings and props pages are intentionally static placeholders and do not call the API yet.
