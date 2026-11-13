// Fills the two scrolling columns with featured players. Uses FEATURED, TEAM_COLORS, ALL, chart and initials from data.js and script.js.
(function () {
  const block = ({ player, tag }) => {
    const p = ALL.find((x) => x.player === player);
    return `<article class="rl-card" style="--team:${TEAM_COLORS[p.team]}">
      <div class="rl-who"><span class="rl-avatar">${initials(p.player)}</span><span class="rl-tag">${tag}</span></div>
      <p class="rl-name">${p.player}</p>
      <p class="rl-meta">${p.team} &middot; ${p.pos}</p>
      <p class="rl-avg">${p.avg.toFixed(1)}</p>
      <p class="rl-label">${p.market}, last 8 average</p>
      <p class="rl-prop">${p.dir} ${p.line} ${p.market}</p>
      ${chart(p)}
    </article>`;
  };
  // Every other player goes to each column, so all ten show and the same face never sits side by side.
  [[document.getElementById("rl-a"), 0], [document.getElementById("rl-b"), 1]].forEach(([track, side]) => {
    const once = FEATURED.filter((_, i) => i % 2 === side).map(block).join("");
    track.innerHTML = once + once; // doubled, so the loop has no seam
  });

  // Owner's rule: the columns scroll forever and never stop, whatever the browser or its settings.
  // The left one runs up and the right one runs down. Moving by half a doubled list loops without a jump.
  const LOOP = 40000;
  const up = document.getElementById("rl-a");
  const down = document.getElementById("rl-b");
  function frame(now) {
    const shift = ((now % LOOP) / LOOP) * 50;
    up.style.transform = `translate3d(0, ${-shift}%, 0)`;
    down.style.transform = `translate3d(0, ${shift - 50}%, 0)`;
    requestAnimationFrame(frame);

  // The wave plays, except for visitors with "reduce motion" on: they get the still image, and the video never downloads.
  const wave = document.getElementById("wl-wave");
  const stillOnly = window.matchMedia("(prefers-reduced-motion: reduce)");
  function setWave() {
    if (stillOnly.matches) wave.pause();
    else wave.play().catch(() => { /* the still image stays up if the video can't play */ });
  }
  stillOnly.addEventListener("change", setWave);
  setWave();
  }
  requestAnimationFrame(frame);
})();
