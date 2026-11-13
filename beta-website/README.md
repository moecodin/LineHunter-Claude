# Line Hunter beta website (design preview)

A test version of the Line Hunter site, used to try out layouts and features before they go into the real site.

**Everything here is made up.** The players, games, stats, injuries and odds are fictional. Sportsbooks and markets are named Book A–D and Market A–C on purpose. Sign-in, the Hunt List, connectors and export are a design preview: nothing is sent anywhere, and no passwords are stored.

## Run it

You need [Node.js](https://nodejs.org). From this folder:

```
node serve.js
```

Then open http://localhost:4173. The front page is `signin.html`.

## What's here

- `signin.html`: front page with sign-in and sign-up
- `index.html`: home page after sign-in (tonight's games, featured players, Streak Board)
- `player.html`, `game.html`, `streak-board.html`, `tonight.html`, `featured.html`: stat pages
- `profile.html`: account, password, settings, connectors and previous hunts
- `DESIGN.md`: colors, fonts and design rules
- `landing-*.html`, `preview-colors.html`: older design experiments
