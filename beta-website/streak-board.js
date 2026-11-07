const ALL = PROPS.map(enrich).sort((a, b) => b.streak - a.streak || b.cushion - a.cushion);
const state = { market: "All", dir: "All", query: "", selected: ALL[0].id };
const $ = (id) => document.getElementById(id);
const sheetMode = window.matchMedia("(max-width: 820px)");

function visible() {
  const q = state.query.trim().toLowerCase();
  return ALL
    .filter((p) => state.market === "All" || p.market === state.market)
    .filter((p) => state.dir === "All" || p.dir === state.dir)
    .filter((p) => !q || p.player.toLowerCase().includes(q) || p.team.toLowerCase().includes(q));
}

function renderFilters() {
  $("market-filters").innerHTML = ["All", ...Object.keys(MARKET_NAMES)].map((m) => {
    const count = ALL.filter((p) => m === "All" || p.market === m).length;
    return `<button type="button" data-market="${m}" aria-pressed="${state.market === m}"><span>${m === "All" ? "All stats" : MARKET_NAMES[m]}</span><span class="count">${count}</span></button>`;
  }).join("");
  $("dir-filters").innerHTML = ["All", "Over", "Under"].map((d) =>
    `<button type="button" data-dir="${d}" aria-pressed="${state.dir === d}">${d}</button>`).join("");
}

function card(p) {
  const selected = state.selected === p.id;
  return `
    <article class="card${selected ? " is-selected" : ""}">
      <button type="button" class="card-open" data-id="${p.id}" aria-pressed="${selected}" aria-label="Show stats for ${p.player}"></button>
      <span class="card-top">
        <a class="name" href="${playerUrl(p)}">${p.player}</a>
        <span class="odds">${fmtOdds(p.odds)}</span>
      </span>
      <span class="meta">${p.team} &middot; ${p.pos}</span>
      <span class="prop"><span class="dir dir-${p.dir.toLowerCase()}">${p.dir}</span> ${p.line} ${p.market}</span>
      ${chart(p)}
    </article>`;
}

function renderLadder() {
  const list = visible();
  $("empty").hidden = list.length > 0;
  const lengths = [...new Set(list.map((p) => p.streak))];
  $("ladder").innerHTML = lengths.map((n) => {
    const group = list.filter((p) => p.streak === n);
    return `
      <section class="rung" aria-label="${n} game streaks">
        <div class="rung-num"><strong>${n}</strong><span>straight</span></div>
        <div class="rung-cards">${group.map(card).join("")}</div>
      </section>`;
  }).join("");
}

function renderPanel() {
  const p = ALL.find((x) => x.id === state.selected);
  $("panel").innerHTML = `
    <button type="button" class="panel-close" id="panel-close">Close</button>
    <article class="tile">
      <div class="tile-top">
        <div>
          <h2><a href="${playerUrl(p)}">${p.player}</a></h2>
          <p class="meta">${p.team} &middot; ${p.pos} &middot; ${p.next}</p>
        </div>
        <p class="tile-streak"><strong>${p.streak}</strong><span>straight</span></p>
      </div>
      <p class="tile-prop">${p.dir} <b>${p.line}</b> ${MARKET_NAMES[p.market]} <span>${fmtOdds(p.odds)}</span></p>
      ${chart(p, true)}
    </article>
    <dl class="panel-stats">
      <div><dt>L8 average</dt><dd>${p.avg.toFixed(1)}</dd></div>
      <div><dt>Avg vs line</dt><dd>${signed(p.cushion)}</dd></div>
      <div><dt>Past week</dt><dd>${p.week}/${PAST_WEEK_GAMES}</dd></div>
    </dl>
    ${gameLog(p)}`;
}

function setSheet(open) {
  $("panel").classList.toggle("is-open", open);
  $("backdrop").hidden = !open;
  document.body.classList.toggle("sheet-open", open);
}

function closeSheet() {
  if (!$("panel").classList.contains("is-open")) return;
  setSheet(false);
  const origin = document.querySelector(`.card-open[data-id="${state.selected}"]`);
  if (origin) origin.focus();
}

$("ladder").addEventListener("click", (e) => {
  const b = e.target.closest(".card-open");
  if (!b) return;
  state.selected = b.dataset.id;
  renderPanel();
  document.querySelectorAll(".card-open").forEach((c) => {
    c.setAttribute("aria-pressed", c === b);
    c.parentElement.classList.toggle("is-selected", c === b);
  });
  if (sheetMode.matches) { setSheet(true); $("panel").focus(); }
});
$("panel").addEventListener("click", (e) => { if (e.target.id === "panel-close") closeSheet(); });
$("backdrop").addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
sheetMode.addEventListener("change", () => setSheet(false));

function refresh() {
  renderFilters();
  renderLadder();
  const list = visible();
  if (list.length && !list.some((p) => p.id === state.selected)) {
    state.selected = list[0].id;
    renderLadder();
    renderPanel();
  }
}

$("market-filters").addEventListener("click", (e) => {
  const b = e.target.closest("[data-market]");
  if (b) { state.market = b.dataset.market; refresh(); }
});
$("dir-filters").addEventListener("click", (e) => {
  const b = e.target.closest("[data-dir]");
  if (b) { state.dir = b.dataset.dir; refresh(); }
});
$("search").addEventListener("input", (e) => { state.query = e.target.value; refresh(); });
$("reset").addEventListener("click", () => {
  Object.assign(state, { market: "All", dir: "All", query: "" });
  $("search").value = "";
  refresh();
});

renderFilters();
renderLadder();
renderPanel();
