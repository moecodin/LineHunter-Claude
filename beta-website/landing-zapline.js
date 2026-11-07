// Landing example 3: fills the product panel from the real sample data and draws the stars.
// Uses ALL, GAMES_TODAY, GAMES_DATE, chart and propText from data.js and script.js.
(function () {
  const top = ALL[0];
  const slate = GAMES_TODAY.map((g) => `
    <li><a href="game.html?g=${g.away}-${g.home}"><span>${g.away} @ ${g.home}</span><span>${g.time}</span></a></li>`).join("");

  document.getElementById("zp-main").innerHTML = `
    <div class="zp-stats">
      <div class="zp-card">
        <h3>Longest active streak</h3>
        <strong>${top.streak} straight</strong>
        <small>${top.player}, ${propText(top)}</small>
      </div>
      <div class="zp-card">
        <h3>Props tracked</h3>
        <strong>${ALL.length}</strong>
        <small>${GAMES_TODAY.length} games, ${GAMES_DATE}</small>
      </div>
    </div>
    <div class="zp-card zp-chart">
      <h3>${top.player}, last ${top.games.length} games against ${top.line} ${top.market}</h3>
      ${chart(top)}
    </div>
    <div class="zp-card zp-slate">
      <h3>Tonight's slate</h3>
      <ul>${slate}</ul>
    </div>`;

  const video = document.getElementById("zp-video");
  const ready = () => video.classList.add("is-ready");
  if (video.readyState >= 2) ready();
  else video.addEventListener("loadeddata", ready, { once: true });

  // Stars keep a fixed seed, so they stay put when the window resizes.
  const canvas = document.getElementById("zp-stars");
  function drawStars() {
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = box.width * ratio;
    canvas.height = box.height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    let seed = 41;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const total = Math.round((box.width * box.height) / 5200);
    for (let i = 0; i < total; i++) {
      ctx.globalAlpha = 0.15 + rand() * 0.6;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(rand() * box.width, rand() * box.height, 0.3 + rand() * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  new ResizeObserver(drawStars).observe(canvas);
})();
