---
name: Line Hunter
description: NBA player prop research for fans and bettors, dark and focused, built to study a line before tip-off.
colors:
  primary: "#280ea1"
  primary-wipe: "#1d0a7c"
  lift: "#9a93ff"
  ink: "#060a16"
  panel: "#0b1229"
  navy: "#14234c"
  rule: "#1f2e5a"
  miss: "#2b3a6c"
  slate: "#5f6da3"
  slate-edge: "#6573a8"
  mist: "#93a1cb"
  haze: "#c3cce9"
  lilac: "#d3d0ff"
  ice: "#d8dff5"
  bar-hit-1: "#46a98f"
  bar-hit-2: "#37907a"
  bar-hit-3: "#2c7a67"
  bar-miss-1: "#bd6570"
  bar-miss-2: "#ab5763"
  bar-miss-3: "#9a4c58"
  hit-low: "#f2969f"
  hit-mid: "#ecc86f"
  hit-high: "#7fdcc0"
typography:
  display:
    fontFamily: "Clash Display, Segoe UI, sans-serif"
    fontSize: "calc(clamp(2rem, 3.4vw, 3.25rem) * 0.82)"
    fontWeight: 600
    lineHeight: 1.1
  number:
    fontFamily: "Clash Display, Segoe UI, sans-serif"
    fontSize: "1.76rem"
    fontWeight: 600
    lineHeight: 1.1
  body:
    fontFamily: "Satoshi, Segoe UI, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "Satoshi, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.2
rounded:
  inner: "4.8px"
  control: "8px"
  panel: "12px"
  pill: "32px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
  button-quiet:
    textColor: "{colors.ice}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 16px"
  control-selected:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.ice}"
    rounded: "{rounded.control}"
  chip:
    textColor: "{colors.mist}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
  chip-selected:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.ice}"
    rounded: "{rounded.pill}"
  tag-posted:
    backgroundColor: "{colors.lift}"
    textColor: "{colors.ink}"
---

# Design System: Line Hunter

## Overview

**Creative North Star: "The Night Scout"**

Line Hunter is someone studying a line in a dark room before tip-off: focused, unhurried, and honest about what the evidence does and doesn't say. Near-black blues recede so the numbers can lead. Attitude comes from Clash Display and the slanted wedge taken from the logo, and it stays out of the data's way.

The screens are dense on purpose, because regulars want many facts at once. That density stays calm by keeping every control quiet until chosen and by giving each signal one job. The system is skeptical by nature. It says what a number is based on, shows less confidence when it has less evidence, and never tells anyone what to bet.

**Key Characteristics:**
- Dark tonal layers, with no shadows.
- Two voices: Clash Display for bets, players and big numbers, and Satoshi for everything you read.
- Controls that stay quiet until chosen.
- Cool teal and dusty rose bars for hits and misses, with brighter red, yellow and green only on hit-rate numbers.
- Every percentage says what sample it comes from.

## Colors

A narrow, cold range of near-black and periwinkle blues, with teal and rose for bars and lighter tints of them, plus gold, for hit-rate numbers.

### Primary
- **Logo Indigo:** the header wedge behind the verdict. It's a place, not a button color.
- **Wipe Indigo:** a shade darker than the logo's indigo, used only for the page wipe so the logo stands out on it.
- **Soft Periwinkle (lift):** selected outlines, focus rings, links and the Posted tag.

### Neutral
- **Night Ink:** the page background and the wells behind segmented controls.
- **Deep Panel:** the surface of every panel.
- **Selected Navy:** selected controls and the left side of the header.
- **Quiet Rule:** panel borders and dividers. It's decorative, so never rely on it alone to identify a control.
- **Worn Slate:** quiet outlines and disabled controls. It's the lightest color that still reads as "off".
- **Mist:** secondary text on panels.
- **Haze and Lilac:** secondary text on navy and on the wedge respectively.
- **Pale Ice:** primary text.

### Hit Rate
- **Rose (hit-low):** 49% and below.
- **Gold (hit-mid):** 50% to 74%.
- **Teal (hit-high):** 75% and up.

### Named Rules
**The How-Often Rule.** On numbers, red, yellow and green mean how often something hit, and nothing else. They never appear on buttons or status. The cutoffs are the owner's and apply at every sample size, following the rounded number on screen.

**The Shared Hue Rule.** Bars and hit-rate numbers use one teal green and one dusty rose, deeper on bars and lighter on numbers, so they read as one cool palette with the blues. Every bar shade keeps at least 3:1 against the panel.

**The Green And Red Bars Rule.** In the game-by-game chart, green bars hit the line and red bars missed it. In the small home page and Streak Board charts, bright teal is the current streak, deep teal an earlier hit and rose a miss. On the ladder and the game page, green bars are above break-even and red bars are below it. Direction and ▲▼ always repeat what the color says, so color is never the only signal. Number colors still follow the How-Often Rule, so a green bar can sit above a yellow number.

## Typography

**Display Font:** Clash Display (with Segoe UI)
**Body Font:** Satoshi (with Segoe UI)

**Character:** Clash Display is sharp and stylish, so it carries the headlines and big numbers. Satoshi is rounder and friendlier, so it carries the reading. Size and contrast between the two make the hierarchy, never slant or heavy capitals, which read as a video game.

### Hierarchy
- **Display:** semibold, sentence case, the bet headline and the player's name.
- **Number:** semibold, for readout numbers and ladder line values. Numbers are the display voice's main job.
- **Body:** sentences and verdicts.
- **Label:** small quiet text, such as readout captions, key items and table headers. 11px is the floor, and only for short labels with strong contrast.

### Named Rules
**The Say-The-Sample Rule.** A percentage is never alone. A sentence nearby says what games it comes from, and a sample's size changes how much confidence it's given. At 15+ games the header leads with a decimal hit rate. Under 15 it leads with the record, with whole numbers and a smaller gap. Under 5 the bars lead with the record too.

## Layout

Panels sit on a single 12px gap. Wide screens use a main column and a 352px side rail, capped at 1560px. The rail joins the main column at 1100px and below.

The primary evidence comes first. The bet and the sample sentence come first, then the game-by-game chart, the range and filter controls, and the ladder, all in one panel.

- **Every width:** the game is a menu in the top bar, filters sit behind a "Filter games" toggle, and Latest news and Expected lineup start closed. The view lives in the address, so links can share it.
- **720px and below:** one column. Ranges become a drop menu, books and the color key move under the ladder, and defense and injuries come before the game log. Elements move in the real page order so Tab order matches the screen.
- **1000px and below:** the bet bar sits along the bottom and appears once the top controls scroll away. Above that it sits in the sticky header once the ladder is gone.
- **360px and below:** tighter gaps and more bottom padding.
- **500px tall and below (phones on their side):** the header stops following, and bars shorten.

Reserve space for text that comes and goes, so comparison surfaces don't jump as content changes.

## Elevation & Depth

This system has no shadows. Depth comes from tonal steps, from ink to panel to navy, and from 1px rules. The only box-shadows are inset outlines drawn as borders.

## Shapes

Gently rounded rectangles: 12px for panels, 8px for controls, about 5px for controls inside a well, and full pills for filter chips.

The slant comes from the logo. It appears as the header wedge, the Posted tag and the page wipe.

**The Slant-Off-The-Data Rule.** The slant never touches something being measured. Bars have flat ends, because the distance from the break-even line is the message.

## Components

### Buttons
Quiet and outlined, with one action never shouting over the data.
- **Shape:** 8px corners, 44px tall.
- **Default:** no fill, a slate outline and ice text. A second small line can say exactly what the button will use.
- **Hover:** a navy fill, on devices that can hover.
- **Text links:** periwinkle and underlined, used for small recoveries like "Back to the chart" and "Clear".

### Selected State
**The One Selected Look Rule.** Every pick-one control and chip shows selection the same way: navy fill, periwinkle outline and ice text. Indigo and ice fills don't mean selected.

### Chips
- **Style:** pills with a rule outline and mist text, plus a count of games they would leave.
- **Unavailable:** a dashed outline and slate text when the count is 0.

### Cards / Containers
Panels use the deep panel color, a 1px rule and 12px corners. Secondary panels collapse with a chevron.

### Inputs / Fields
Native selects and steppers on night ink with a 1px rule. Phone drop menus use 16px text so iOS won't zoom. At their limit steppers stay focusable and dim to slate, so pressing again does nothing.

### Line Ladder
The signature component: nearby lines side by side, each with a bar growing up or down from a white break-even line, showing how far its hit rate sits from what its price needs.
- **Rows:** line, sample dots, hit rate, odds and the gap to break-even, with row labels on wider screens.
- **Bars:** green above break-even and red below it, hollow under 5 games. Distance from break-even is the only thing the bar means. The largest gap on the ladder fills the space, with a floor of 10 points so tiny gaps stay tiny.
- **Sample dots:** three dots for L10, L20 and All against that line's price. Filled clears it, hollow doesn't, and a dash means too few games.
- **Compare:** pin one line and select another for a side-by-side table under the ladder. The pinned bar gets a dashed outline.
- **Motion:** bars travel to new values in 280ms, passing through the line when they change sides, on `cubic-bezier(.16, 1, .3, 1)`. New lines fade in over 180ms. With reduced motion, changed bars pulse in opacity without travelling.

### Game Page
One page per game on tonight's slate, opened from the home page's game wheel.
- **Header:** the game card at full width: team colors, slanted seam, moneylines and records.
- **Props:** each tracked player's main prop first, then their other main stats. Hit rate follows the How-Often Rule; the small bar grows right in green or left in red from a white break-even line.
- **Context:** injury report, team matchup and last meetings, using the same side panels as the player page.
- **Motion:** the front wheel card grows into the header in 280ms on `cubic-bezier(.16, 1, .3, 1)` with a page-to-page view transition, and shrinks back on return. Browsers without it use the logo wipe; reduced motion cuts straight to the page.

### Verdict Readout
Three numbers on the wedge: hit rate, what the price needs, and the distance between them, with one plain sentence on how the samples compare.

### Stacked Chart
Green bars for hits and red bars for misses, with lighter and darker shades for each stat, against a line that alternates white and ink dashes so it shows on any bar. The line travels when it changes. The chart fades in when the games or stat change.

### Page Wipe
A wipe indigo panel with the logo, covering the old page and sliding off the new one. Forward goes left to right, and back to Home reverses it. The logo is embedded so it's ready on the first frame.

### Front Page Player Columns
- **Always scrolling (owner's rule):** the two columns of 9:16 player blocks on the sign-in page scroll in opposite directions forever and never stop, on every device and browser, even when the visitor has "reduce motion" turned on. Don't add a pause or a reduced-motion exception unless the owner asks.
- **Motion:** 40s per loop on `linear`, fading out at the column's top and bottom edges.

## Do's and Don'ts

### Do:
- **Do** say what a percentage is based on, right beside it.
- **Do** lower the visual confidence as the sample shrinks.
- **Do** keep 44px touch targets wherever the pointer is a finger.
- **Do** keep text at 4.5:1 and meaningful bars, marks and outlines at 3:1 against their background.
- **Do** show that past results aren't predictions, and keep the 21+ and 1-800-GAMBLER footer on every page.

### Don't:
- **Don't** use red, yellow or green for anything but hit rates.
- **Don't** add a color or badge that means "good bet". The site doesn't give betting advice.
- **Don't** add shadows, or cut the slant into bars.
- **Don't** use team logos until they're licensed or supplied by the owner.
- **Don't** animate on page load, or use motion that isn't explaining a change.
