// LineHunter - js/components/animatedBars.js
// The player page's bar chart as plain HTML / CSS bars (a Chart.js canvas can't keep a bar "the same bar" between redraws).
// Used by createPropChart (js/components/propChart.js) when it is built with { animatedBars: true }.
//
// Layout: bars sit side by side with a 3px gap, oldest on the left, newest on the right. A bar is at most maxBarWidth wide; with few
// games (L5, L10) the group stays centered with empty space on both sides, with many (L20, Season) the bars shrink to fit the full
// width. The dashed line spans the full plot width.
//
// Animation: every bar is keyed by its game (game id), so when the range, split or stat changes, bars that stay move and resize
// (CSS transitions on transform / width / height), new older games grow up from the baseline, and dropped games shrink down to
// it and disappear. 220 ms ease-out; none with prefers-reduced-motion (css/styles.css).
//
// Labels: the number above a bar only shows while the bar is wide enough to read; the opponent / date under the bars show all
// when they fit, otherwise every Nth one counting back from the newest.
//
//   const bars = createAnimatedBars(innerBox, { maxBarWidth: 56, onHover, onLeave, onClick });
//   bars.render({ games, line, bookLine, bookLabel, scaleMax, barClass, tonight });  // games oldest first (rows from calculateHitRate)
//   bars.toImage()  -> PNG data URL of the chart as drawn now (the share picture)
//   bars.clear()    -> remove everything
// Needs js/components/propChart.js (chartColors, opponentLabel, shortDate) loaded first.

const BAR_GAP = 3;           // px between bars
const BAR_VALUE_MIN_WIDTH = 18; // narrower bars hide the number above them
const BAR_LABEL_MIN_SLOT = 36;  // px one date / opponent label needs
const BAR_LEAVE_MS = 260;    // how long a dropped bar takes to shrink away before it is removed
const AXIS_WIDTH = 30;       // left gutter for the y-axis numbers
const PLOT_TOP = 18;         // room above the tallest bar for its number
const PLOT_BOTTOM = 32;      // room under the bars for the labels

function createAnimatedBars(host, { maxBarWidth = 56, onHover = () => {}, onLeave = () => {}, onClick = null } = {}) {
  host.insertAdjacentHTML("afterbegin", `
    <div class="lh-bars" role="img" aria-label="Bar chart of recent games against the line">
      <div class="lh-bars-plot">
        <div class="lh-bars-line" hidden></div>
        <div class="lh-bars-book" hidden><span></span></div>
      </div>
    </div>`);
  const root = host.querySelector(".lh-bars");
  const plot = host.querySelector(".lh-bars-plot");
  const lineEl = plot.querySelector(".lh-bars-line");
  const bookEl = plot.querySelector(".lh-bars-book");

  const barEls = new Map();  // game id (or "tonight") -> { el, fill, valueEl, labelEl }
  const tickEls = new Map(); // tick number -> element
  let lastArgs = null;       // the last render() arguments, for resizes
  let layout = null;         // the final positions of the last render, for toImage()

  const percent = (value, scaleMax) => `${Math.max(0, Math.min(100, (value / scaleMax) * 100))}%`;

  // Run `change` with all transitions switched off (the first draw and resizes jump straight to place).
  function withoutTransitions(change) {
    root.classList.add("is-still");
    change();
    void root.offsetWidth; // apply the jump before transitions come back
    root.classList.remove("is-still");
  }

  function makeBar(id) {
    const el = document.createElement("div");
    el.className = "lh-bar";
    el.innerHTML = `<div class="lh-bar-fill"><span class="lh-bar-value"></span></div><div class="lh-bar-label"><span></span><span></span></div>`;
    const bar = { el, fill: el.firstChild, valueEl: el.querySelector(".lh-bar-value"), labelEl: el.querySelector(".lh-bar-label"), game: null };
    el.addEventListener("pointerenter", () => {
      if (!bar.game) return;
      root.classList.add("has-hover");
      el.classList.add("is-hover");
      onHover(bar.game, plot.offsetLeft + bar.x + bar.width / 2, plot.offsetTop + plot.clientHeight - bar.heightPx);
    });
    el.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "touch") return; // on phones a tap's highlight stays, like the tooltip, until the next tap
      el.classList.remove("is-hover");
      if (!root.querySelector(".lh-bar.is-hover")) root.classList.remove("has-hover");
      onLeave();
    });
    if (onClick) el.addEventListener("click", () => { if (bar.game) onClick(bar.game); });
    plot.appendChild(el);
    barEls.set(id, bar);
    return bar;
  }

  function dropBar(id) {
    const bar = barEls.get(id);
    barEls.delete(id);
    bar.el.classList.add("is-leaving");
    bar.fill.style.height = "0%";
    setTimeout(() => bar.el.remove(), BAR_LEAVE_MS);
  }

  // Draw (or update) everything for these games. Bars already on screen keep their element and animate to their new place.
  function render(args) {
    lastArgs = args;
    const { games, line, bookLine, bookLabel, scaleMax, ticks, barClass, tonight } = args;
    const width = plot.clientWidth;
    const plotHeight = plot.clientHeight;
    if (!width) return; // not laid out yet (hidden): the resize observer draws it when it has a size

    const first = barEls.size === 0;
    const slots = games.length + (tonight ? 1 : 0);
    const barWidth = Math.max(1, Math.min(maxBarWidth, (width - BAR_GAP * (slots - 1)) / slots));
    const groupWidth = slots * barWidth + (slots - 1) * BAR_GAP;
    const startX = (width - groupWidth) / 2;
    const slot = barWidth + BAR_GAP;
    const labelEvery = Math.max(1, Math.ceil(BAR_LABEL_MIN_SLOT / slot));
    const radius = `${Math.min(6, barWidth / 2)}px ${Math.min(6, barWidth / 2)}px 0 0`;

    layout = { width, plotHeight, scaleMax, ticks, line, bookLine, bookLabel, bars: [] };
    const wanted = new Set();

    const place = (id, index, game, isTonight) => {
      wanted.add(id);
      let bar = barEls.get(id);
      const isNew = !bar;
      if (isNew) bar = makeBar(id);
      const x = startX + index * slot;
      const value = isTonight ? (line ?? scaleMax * 0.45) : game.value;
      const fromNewest = slots - 1 - index;
      // ("Tonight" is wider than a narrow slot: it only shows when it fits.)
      const showLabel = isTonight ? slot >= 48 : fromNewest % labelEvery === 0;
      const showValue = barWidth >= BAR_VALUE_MIN_WIDTH;

      bar.game = isTonight ? null : game;
      bar.x = x;
      bar.width = barWidth;
      bar.heightPx = (Math.min(value, scaleMax) / scaleMax) * plotHeight;
      bar.el.classList.toggle("is-tonight", isTonight);
      bar.el.style.width = `${barWidth}px`;
      bar.el.style.transform = `translateX(${x}px)`;
      bar.fill.style.borderRadius = radius;
      bar.fill.className = `lh-bar-fill ${isTonight ? "" : barClass(game)}`;
      bar.valueEl.textContent = isTonight ? "?" : game.value;
      bar.valueEl.style.opacity = showValue ? "" : "0";
      const [top, bottom] = isTonight ? ["Tonight", ""] : [opponentLabel(game), shortDate(game.date)];
      bar.labelEl.children[0].textContent = top;
      bar.labelEl.children[1].textContent = bottom;
      bar.labelEl.style.opacity = showLabel ? "" : "0";
      bar.el.classList.toggle("is-post", !isTonight && Boolean(game.postseason));
      if (isNew) {
        // Appear: at the final place and width, growing up from the baseline.
        bar.fill.style.height = "0%";
        void bar.el.offsetWidth;
      }
      bar.fill.style.height = percent(value, scaleMax);
      layout.bars.push({ game: isTonight ? null : game, x, width: barWidth, height: bar.heightPx, showValue, showLabel, isTonight, cls: isTonight ? "" : barClass(game) });
    };

    const draw = () => {
      games.forEach((game, index) => place(game.gameId, index, game, false));
      if (tonight) place("tonight", games.length, null, true);
      [...barEls.keys()].filter((id) => !wanted.has(id)).forEach(dropBar);

      // Y-axis grid lines and numbers.
      const tickSet = new Set(ticks);
      ticks.forEach((tick) => {
        let el = tickEls.get(tick);
        if (!el) {
          el = document.createElement("div");
          el.className = "lh-bars-tick";
          el.innerHTML = `<span>${tick}</span>`;
          plot.prepend(el);
          tickEls.set(tick, el);
        }
        el.style.bottom = percent(tick, scaleMax);
      });
      [...tickEls.keys()].filter((tick) => !tickSet.has(tick)).forEach((tick) => {
        const el = tickEls.get(tick);
        tickEls.delete(tick);
        el.classList.add("is-leaving");
        setTimeout(() => el.remove(), BAR_LEAVE_MS);
      });

      // The dashed line (full plot width) and the faint second marker.
      lineEl.hidden = line === null;
      if (line !== null) lineEl.style.bottom = percent(line, scaleMax);
      bookEl.hidden = bookLine === null || bookLine === line;
      if (!bookEl.hidden) {
        bookEl.style.bottom = percent(bookLine, scaleMax);
        bookEl.firstChild.textContent = `${bookLabel || "Book"} ${lineText(bookLine)}`;
      }
    };

    if (first) withoutTransitions(draw); else draw(); // the first draw jumps straight to place
  }

  // Keep the bars fitted to the width (window resize, phone rotation, drawer opening): jump, don't animate.
  const observer = new ResizeObserver(() => {
    if (lastArgs) withoutTransitions(() => render(lastArgs));
  });
  observer.observe(plot);

  function clear() {
    lastArgs = null;
    layout = null;
    barEls.forEach((bar) => bar.el.remove());
    barEls.clear();
    tickEls.forEach((el) => el.remove());
    tickEls.clear();
    lineEl.hidden = true;
    bookEl.hidden = true;
    root.classList.remove("has-hover");
  }

  // The chart as a PNG data URL, drawn on a canvas from the final layout (not from whatever frame the animation is on).
  function toImage() {
    if (!layout) return null;
    const colors = chartColors();
    const scale = 2;
    const totalWidth = AXIS_WIDTH + layout.width;
    const totalHeight = PLOT_TOP + layout.plotHeight + PLOT_BOTTOM;
    const canvas = document.createElement("canvas");
    canvas.width = totalWidth * scale;
    canvas.height = totalHeight * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    const baseY = PLOT_TOP + layout.plotHeight;
    const yOf = (value) => baseY - (Math.min(value, layout.scaleMax) / layout.scaleMax) * layout.plotHeight;

    ctx.font = "10px 'JetBrains Mono', monospace";
    layout.ticks.forEach((tick) => {
      ctx.strokeStyle = `rgba(${colors.lineRgb}, 0.12)`;
      ctx.beginPath();
      ctx.moveTo(AXIS_WIDTH, yOf(tick));
      ctx.lineTo(totalWidth, yOf(tick));
      ctx.stroke();
      ctx.fillStyle = colors.muted;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(tick, AXIS_WIDTH - 6, yOf(tick));
    });

    layout.bars.forEach((bar) => {
      const x = AXIS_WIDTH + bar.x;
      const top = baseY - bar.height;
      const radius = Math.min(6, bar.width / 2);
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.lineTo(x, top + radius);
      ctx.quadraticCurveTo(x, top, x + radius, top);
      ctx.lineTo(x + bar.width - radius, top);
      ctx.quadraticCurveTo(x + bar.width, top, x + bar.width, top + radius);
      ctx.lineTo(x + bar.width, baseY);
      ctx.closePath();
      if (bar.isTonight) {
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = colors.muted;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = bar.cls.includes("is-noline") ? colors.noLine : colors[bar.cls.replace("is-", "")] || colors.push;
        ctx.fill();
      }
      const centerX = x + bar.width / 2;
      if (bar.showValue) {
        ctx.fillStyle = colors.text;
        ctx.font = "700 12px Satoshi, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(bar.isTonight ? "?" : bar.game.value, centerX, top - 4);
      }
      if (bar.showLabel) {
        ctx.fillStyle = colors.muted;
        ctx.font = "10px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(bar.isTonight ? "Tonight" : opponentLabel(bar.game), centerX, baseY + 6);
        if (!bar.isTonight) ctx.fillText(shortDate(bar.game.date), centerX, baseY + 18);
      }
    });

    if (layout.line !== null) {
      const y = yOf(layout.line);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(AXIS_WIDTH, y);
      ctx.lineTo(totalWidth, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }
    return canvas.toDataURL("image/png");
  }

  // Drop the hover highlight (a tap somewhere else on a phone).
  function unhover() {
    root.querySelectorAll(".lh-bar.is-hover").forEach((el) => el.classList.remove("is-hover"));
    root.classList.remove("has-hover");
    onLeave();
  }

  return { render, clear, toImage, unhover, axis: { width: AXIS_WIDTH, top: PLOT_TOP, bottom: PLOT_BOTTOM } };
}
