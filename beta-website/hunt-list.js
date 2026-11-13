// The Hunt List: a side tab holding the picks you've chosen, priced at whichever book you select.
// DESIGN PREVIEW: every price and "offered" result below is made up, and nothing is sent to any book.
(function () {
  const AUTH = window.LH_AUTH;

  const BOOKS = [
    { id: "book-a", name: "Book A", kind: "book" },
    { id: "book-b", name: "Book B", kind: "book" },
    { id: "book-c", name: "Book C", kind: "book" },
    { id: "book-d", name: "Book D", kind: "book" },
    { id: "market-a", name: "Market A", kind: "market" },
    { id: "market-b", name: "Market B", kind: "market" },
    { id: "market-c", name: "Market C", kind: "market" },
  ];
  const bookById = (id) => BOOKS.find((b) => b.id === id) || BOOKS[0];

  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  const breakeven = (o) => (o > 0 ? 100 / (o + 100) : -o / (-o + 100)) * 100;
  // Sportsbook prices are the ones the player page showed when the pick was saved. Market prices are made up from them.
  function quote(pick, book) {
    if (book.kind === "book") {
      const american = pick.quotes[book.id];
      return american === null || american === undefined ? null : { american, need: breakeven(american) };
    }
    const seed = hash(`${pick.player}|${pick.pick}|${pick.game}|${book.id}`);
    const prices = Object.values(pick.quotes).filter((o) => o !== null);
    if (!prices.length || seed % 100 < 45) return null;
    const cents = Math.round(prices.reduce((sum, o) => sum + breakeven(o), 0) / prices.length);
    return { cents, need: cents };
  }
  const fmtAmerican = (n) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);
  const toDecimal = (n) => (n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n));
  function toAmerican(decimal) {
    return decimal >= 2 ? Math.round((decimal - 1) * 100) : -Math.round(100 / (decimal - 1));
  }

  window.LH_BOOKS = { BOOKS, bookById };

  if (!AUTH.user() || AUTH.page === "signin") return;

  const escape = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const options = (kind) => BOOKS.filter((b) => b.kind === kind).map((b) => `<option value="${b.id}">${b.name}</option>`).join("");

  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "hl-tab";
  tab.setAttribute("aria-expanded", "false");
  tab.setAttribute("aria-controls", "hl-panel");

  const panel = document.createElement("aside");
  panel.className = "hl";
  panel.id = "hl-panel";
  panel.setAttribute("aria-labelledby", "hl-title");
  panel.inert = true;
  panel.innerHTML = `
    <header class="hl-head">
      <h2 id="hl-title">Hunt List</h2>
      <button type="button" class="hl-close" aria-label="Close Hunt List">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M1 1l12 12M13 1L1 13"/></svg>
      </button>
    </header>
    <label class="hl-book"><span>Price it at</span>
      <select id="hl-book">
        <optgroup label="Sportsbooks">${options("book")}</optgroup>
        <optgroup label="Markets">${options("market")}</optgroup>
      </select>
    </label>
    <ul class="hl-items" id="hl-items"></ul>
    <footer class="hl-foot" id="hl-foot"></footer>`;
  document.body.append(tab, panel);

  // Picks saved before prices were recorded can't be priced, so they drop off
  const all = AUTH.hunts();
  if (all.some((p) => !p.quotes)) AUTH.saveHunts(all.filter((p) => p.quotes));

  const bookMenu = panel.querySelector("#hl-book");
  bookMenu.value = bookById(AUTH.prefs().book).id;

  function render() {
    const picks = AUTH.hunts();
    const book = bookById(bookMenu.value);
    tab.innerHTML = `Hunt List<span class="hl-count">${picks.length}</span>`;
    tab.setAttribute("aria-label", `Hunt List, ${picks.length} ${picks.length === 1 ? "pick" : "picks"}`);

    const bothSides = (p) => picks.some((o) => o !== p && o.playerId === p.playerId && o.stat === p.stat && o.line === p.line && o.matchup === p.matchup && o.side !== p.side);
    const pctClass = (n) => (Math.round(n) >= 75 ? "hl-high" : Math.round(n) >= 50 ? "hl-mid" : "hl-low");
    const evidence = (p, q) => {
      const pct = (p.hits / p.total) * 100;
      return `<small class="hl-evidence">Last ${p.total}: ${p.hits} of ${p.total} (<span class="${pctClass(pct)}">${Math.round(pct)}%</span>), needs ${q.need.toFixed(1)}%</small>`;
    };
    const priced = picks.map((p) => ({ p, q: quote(p, book) }));
    const items = panel.querySelector("#hl-items");
    items.innerHTML = picks.length ? priced.map(({ p, q }, i) => `
      <li class="hl-item${q ? "" : " is-missing"}">
        <div class="hl-pick">
          <a href="player.html${escape(p.url || "")}">${escape(p.player)}</a>
          <span>${escape(p.pick)}</span>
          <small>${escape(p.game)}</small>
          ${q ? evidence(p, q) : ""}
        </div>
        <div class="hl-price">${q
          ? `<b>${q.american !== undefined ? fmtAmerican(q.american) : `${q.cents}¢`}</b>`
          : `<b class="hl-dash" aria-hidden="true">—</b>`}</div>
        <button type="button" class="hl-remove" data-i="${i}" aria-label="Remove ${escape(p.player)}, ${escape(p.pick)}">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M1 1l12 12M13 1L1 13"/></svg>
        </button>
        ${q ? "" : `<p class="hl-warn">${book.name} doesn't offer this.</p>`}
        ${bothSides(p) ? `<p class="hl-warn">You have both sides of this line.</p>` : ""}
      </li>`).join("") : `<li class="hl-empty">No picks yet. Open a player and choose <b>Add to Hunt List</b>.</li>`;

    const live = priced.filter((x) => x.q);
    const foot = panel.querySelector("#hl-foot");
    if (!picks.length) { foot.innerHTML = ""; return; }

    const conflict = live.some((x) => bothSides(x.p));
    const games = live.map((x) => x.p.matchup);
    const sameGame = new Set(games).size < games.length;
    let total = "";
    if (conflict) {
      total = `<p class="hl-total-note">Remove one side of the line to see a total.</p>`;
    } else if (live.length && book.kind === "book" && sameGame) {
      // Picks from one game move together, so multiplying their odds would overstate the payout
      total = `<p class="hl-total-note">${live.length} picks share a game. ${book.name} prices same-game parlays itself, so we don't estimate a total.</p>`;
    } else if (live.length && book.kind === "book") {
      const decimal = live.reduce((sum, x) => sum * toDecimal(x.q.american), 1);
      total = `<div class="hl-total"><span>${live.length > 1 ? `Estimated parlay, ${live.length} picks` : "Odds, 1 pick"}</span><b>${fmtAmerican(toAmerican(decimal))}</b></div>`;
    } else if (live.length) {
      total = `<div class="hl-total"><span>Each pick trades on its own at ${book.name}</span><b>${live.length} of ${picks.length}</b></div>`;
    }
    const connected = AUTH.prefs().connected.includes(book.id);
    foot.innerHTML = `
      ${total}
      <button type="button" class="hl-export"${live.length && !conflict ? "" : " disabled"}>Export to ${book.name}</button>
      <p class="hl-msg" id="hl-msg" role="status"></p>
      ${connected ? "" : `<p class="hl-hint">${book.name} isn't connected. <a href="profile.html#connectors">Connect it</a></p>`}
      <p class="hl-note">Sample odds, made up for this preview. Line Hunter doesn't take bets. 21+ where legal.</p>`;
    const exportBtn = foot.querySelector(".hl-export");
    exportBtn.addEventListener("click", () => {
      foot.querySelector("#hl-msg").textContent = `Design preview: nothing was sent. When this goes live, your ${live.length === 1 ? "pick opens" : `${live.length} picks open`} at ${book.name}.`;
    });
  }

  // While it's open, the page behind can't take focus. A click outside closes it.
  const behind = () => [...document.body.children].filter((el) => el !== panel && !["SCRIPT", "DIALOG"].includes(el.tagName));
  function setOpen(open) {
    panel.classList.toggle("is-open", open);
    panel.inert = !open;
    tab.setAttribute("aria-expanded", String(open));
    behind().forEach((el) => { el.inert = open; });
    (open ? panel.querySelector(".hl-close") : tab).focus({ preventScroll: true });
  }
  document.addEventListener("click", (e) => {
    if (panel.classList.contains("is-open") && !e.target.closest("#hl-panel, .hl-tab, dialog")) setOpen(false);
  });

  tab.addEventListener("click", () => setOpen(!panel.classList.contains("is-open")));
  panel.querySelector(".hl-close").addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("is-open") && !document.querySelector("dialog[open]")) setOpen(false);
  });
  bookMenu.addEventListener("change", render);
  panel.querySelector("#hl-foot").addEventListener("click", (e) => {
    if (e.target.closest(".hl-hint a")) setOpen(false); // on the profile page, this link only changes the tab
  });
  panel.querySelector("#hl-items").addEventListener("click", (e) => {
    const b = e.target.closest(".hl-remove");
    if (!b) return;
    const list = AUTH.hunts();
    list.splice(Number(b.dataset.i), 1);
    AUTH.saveHunts(list);
    document.dispatchEvent(new CustomEvent("lh-hunts-changed"));
    panel.querySelector(".hl-close").focus();
  });
  document.addEventListener("lh-hunts-changed", render);
  // A new default from Settings applies straight away
  document.addEventListener("lh-default-book", () => { bookMenu.value = bookById(AUTH.prefs().book).id; render(); });
  document.addEventListener("lh-connectors-changed", render);
  render();
})();
