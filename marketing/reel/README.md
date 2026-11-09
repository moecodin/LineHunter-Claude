# Reel scripts (marketing/reel.js)

Run: `node marketing/reel.js --script=tour` (file name without .json). Options: `--player="Jalen Brunson"` `--stat=reb` `--demo` `--keep`.
Output: `marketing/out/reel-<script>-<date>.mp4` (1080x1920, 30 fps, silent) and `-cover.png`.

A script is a list of scenes, played in order.

## Cards
- `{ "card": "title", "kicker": "...", "title": "line 1", "hero": "line 2 (purple)", "wall": "BIG FAINT WORD", "sub": "...", "size": 132, "sec": 2.2 }`
- `{ "card": "end", "kicker": "...", "title": "...", "hero": "...", "sub": "Free · no sign-up", "sec": 3 }` (always shows linehunterapp.com and the disclaimer)

## Page scenes
`{ "url": "top-hit-rates.html", "caption": ["line 1", "line 2 (purple)"], "captionAt": "top", "before": [...], "actions": [...], "hold": 900, "cleanup": "hunts" }`
- `caption`: one or two lines; `captionAt: "top"` puts it high instead of the middle.
- `before`: steps done before filming starts (scrolling into place); `actions`: the filmed steps; `hold`: ms kept at the end; `"speed": 1.4` plays the scene faster.
- `cleanup: "hunts"` empties the slip afterwards.

## Actions
- `{ "do": "wait", "ms": 800 }`
- `{ "do": "scroll", "by": 500, "ms": 1200 }` (page; add `"in": "#selector"` to scroll a box)
- `{ "do": "scrollTo", "sel": "#storyDeck", "offset": 70 }`
- `{ "do": "swipeH", "sel": "#games-list", "by": 320, "times": 2 }` (a sideways row)
- `{ "do": "swipe", "sel": "#storyDeck .lh-sd-card", "dx": -320, "times": 2 }` (drag: the Top picks deck, or `#gameWheel` for the games wheel)
- `{ "do": "tap", "sel": "[data-bd-head]", "text": "{last}", "nth": 0 }` (falls back to the first match without the text)
- `{ "do": "type", "sel": "#hbpSearch", "text": "brunson" }`
- `{ "do": "hunt", "n": 3 }` (Hunts builder: add the first n props)
- `{ "do": "eval", "js": "..." }`

## Placeholders
`{player}` `{first}` `{last}` `{playerId}` `{oppId}` `{stat}` `{STAT}` `{date}`. The player is `--player`, else the top row of tonight's Board.
