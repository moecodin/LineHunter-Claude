// LineHunter - js/components/my-hunts.js
// The "My Hunts" drawer: the bet slip (js/core/hunts.js) as a list of bet tickets, with the Single / Parlay odds, a stake box
// and "To win". Desktop: a Bootstrap offcanvas from the right (the same structure and behavior as the player drawer: overlay,
// Esc closes it, focus moves in and back). Phones: the same element opens from the bottom as a ~90% sheet.
// Opened by anything with data-lh-open-hunts (the navbar item and the phone tab, both built in js/components/nav.js), which
// also show the count badge (data-hunts-count). The whole thing is lines-only: research mode hides it and keeps the slip saved.
//
// Needs js/core/hunts.js and js/components/hunt-button.js (huntStatName) loaded first.

(function () {
  const STAKE_KEY = "lh-hunts-stake";
  const DEFAULT_STAKE = 10;
  const PHONE = "(max-width: 767.98px)";

  const escapeText = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const bookShort = (book) => lhHunts.bookLabel(book); // "draftkings" -> "DK" (js/core/hunts.js)
  const formatAmerican = (odds) => (odds === null || odds === undefined ? "–" : odds > 0 ? `+${odds}` : `${odds}`);
  const toDecimal = (odds) => (odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds));
  const toAmerican = (decimal) => (decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1)));
  const money = (amount) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  function readStake() {
    try {
      const saved = Number(localStorage.getItem(STAKE_KEY));
      return Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_STAKE;
    } catch (error) {
      return DEFAULT_STAKE;
    }
  }
  let stake = readStake();

  // ---------- the drawer element ----------

  const drawer = document.createElement("div");
  drawer.className = "offcanvas offcanvas-end lh-hunts-drawer lines-only";
  drawer.id = "lhHuntsDrawer";
  drawer.tabIndex = -1;
  drawer.setAttribute("aria-labelledby", "lhHuntsTitle");
  drawer.innerHTML = `
    <div class="offcanvas-header align-items-start">
      <div>
        <h2 class="lh-hunts-title" id="lhHuntsTitle">My Hunts</h2>
        <div class="lh-hunts-date" id="lhHuntsDate"></div>
      </div>
      <button type="button" class="lh-drawer-close ms-auto" data-bs-dismiss="offcanvas" aria-label="Close"><i class="bi bi-x-lg"></i></button>
    </div>
    <div class="offcanvas-body lh-hunts-body">
      <ul class="lh-hunts-list" id="lhHuntsList"></ul>
      <p class="lh-hunts-empty" id="lhHuntsEmpty">No hunts yet. Tap + on any prop to start a slip.</p>
    </div>
    <div class="lh-hunts-foot" id="lhHuntsFoot">
      <div class="lh-hunts-total">
        <span class="lh-hunts-type" id="lhHuntsType">Single</span>
        <span class="lh-hunts-total-odds" id="lhHuntsOdds">–</span>
      </div>
      <div class="lh-hunts-note" id="lhHuntsNote" hidden></div>
      <div class="lh-hunts-stake-row">
        <label class="lh-hunts-stake" for="lhHuntsStake">
          <span class="lh-hunts-stake-label">Stake</span>
          <span class="lh-hunts-stake-box"><span aria-hidden="true">$</span><input type="number" id="lhHuntsStake" min="0" step="1" inputmode="decimal"></span>
        </label>
        <div class="lh-hunts-win">
          <span class="lh-hunts-stake-label">To win</span>
          <span class="lh-hunts-win-amount" id="lhHuntsWin">–</span>
        </div>
      </div>
      <button type="button" class="lh-hunts-clear" id="lhHuntsClear">Clear all</button>
      <div class="lh-hunts-legal">Bet within your limits · 21+ · 1-800-GAMBLER</div>
    </div>`;
  document.body.appendChild(drawer);

  const list = drawer.querySelector("#lhHuntsList");
  const stakeInput = drawer.querySelector("#lhHuntsStake");
  stakeInput.value = stake;

  // Desktop from the right, phones from the bottom. Bootstrap reads the placement class when it opens.
  function openMyHunts() {
    if (document.body.classList.contains("research-mode")) return;
    const instance = bootstrap.Offcanvas.getOrCreateInstance(drawer);
    if (!drawer.classList.contains("show")) {
      const phone = window.matchMedia(PHONE).matches;
      drawer.classList.toggle("offcanvas-bottom", phone);
      drawer.classList.toggle("offcanvas-end", !phone);
    }
    instance.show();
  }
  window.openMyHunts = openMyHunts;

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-lh-open-hunts]")) return;
    event.preventDefault();
    openMyHunts();
  });

  // ---------- drawing ----------

  function legHtml(leg) {
    const started = leg.tipoff && Date.parse(leg.tipoff) <= Date.now();
    const time = leg.tipoff && !started
      ? new Date(leg.tipoff).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      : "";
    const matchup = [leg.team, leg.opp].filter(Boolean).join(" · ");
    const side = leg.side === "under" ? "Under" : "Over";
    return `
      <li class="lh-hleg lh-hleg--${leg.side}">
        <div class="lh-hleg-main">
          <div class="lh-hleg-top">
            <span class="lh-hleg-name">${escapeText(leg.player)}</span>
            ${started ? `<span class="lh-hleg-tag">Started</span>` : ""}
            <button type="button" class="lh-hleg-remove" data-hunt-remove="${escapeText(leg.id)}" aria-label="Remove ${escapeText(leg.player)} ${side} ${leg.line} from My Hunts"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
          </div>
          <div class="lh-hleg-prop"><span class="lh-hleg-side">${side}</span> ${leg.line} ${escapeText(huntStatName(leg.stat))}${leg.isAlt ? ` <span class="lh-hleg-tag">Alt</span>` : ""}</div>
          <div class="lh-hleg-match">${escapeText(matchup)}${time ? ` · ${time}` : ""}</div>
        </div>
        <div class="lh-hleg-stub">
          <span class="lh-hleg-odds">${formatAmerican(leg.odds)}</span>
          ${bookShort(leg.book) ? `<span class="lh-hleg-book">${escapeText(bookShort(leg.book))}</span>` : ""}
        </div>
      </li>`;
  }

  // Single / Parlay, the combined odds, and "To win" for the stake.
  function renderTotals(legs) {
    const priced = legs.filter((leg) => leg.odds !== null && leg.odds !== undefined);
    const missing = legs.length - priced.length;
    drawer.querySelector("#lhHuntsType").textContent = legs.length > 1 ? "Parlay" : "Single";

    let decimal = null;
    if (legs.length && !missing) decimal = priced.reduce((total, leg) => total * toDecimal(leg.odds), 1);
    drawer.querySelector("#lhHuntsOdds").textContent = decimal === null ? "–" : formatAmerican(toAmerican(decimal));

    const note = drawer.querySelector("#lhHuntsNote");
    note.hidden = !missing;
    note.textContent = missing ? `${missing} ${missing === 1 ? "leg has" : "legs have"} no odds yet, so the total can't be worked out.` : "";

    const win = drawer.querySelector("#lhHuntsWin");
    win.textContent = decimal === null || !(stake > 0) ? "–" : money(Math.round(stake * (decimal - 1) * 100) / 100);
  }

  function render() {
    const legs = lhHunts.getAll();
    list.innerHTML = legs.map(legHtml).join("");
    drawer.querySelector("#lhHuntsEmpty").hidden = legs.length > 0;
    drawer.querySelector("#lhHuntsFoot").hidden = legs.length === 0;
    drawer.querySelector("#lhHuntsDate").textContent = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    renderTotals(legs);

    // The count on the phone tab's badge and on the floating pill.
    document.querySelectorAll("[data-hunts-count]").forEach((badge) => {
      badge.textContent = legs.length;
      badge.hidden = legs.length === 0;
    });
    document.querySelectorAll("[data-pill-count]").forEach((count) => { count.textContent = legs.length; });
    const pillElement = document.getElementById("lhHuntsPill");
    if (pillElement) pillElement.dataset.empty = String(legs.length === 0);
  }

  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-hunt-remove]");
    if (button) lhHunts.remove(button.dataset.huntRemove);
  });

  stakeInput.addEventListener("input", () => {
    const value = Math.round(Number(stakeInput.value) * 100) / 100;
    stake = Number.isFinite(value) && value > 0 ? value : 0;
    try {
      if (stake > 0) localStorage.setItem(STAKE_KEY, String(stake));
    } catch (error) {
      // storage blocked: the stake is kept for this visit only
    }
    renderTotals(lhHunts.getAll());
  });

  drawer.querySelector("#lhHuntsClear").addEventListener("click", () => {
    if (window.confirm("Clear every leg from My Hunts?")) lhHunts.clear();
  });

  // ---------- the floating pill and the "ADDED" mini ticket ----------
  // The pill is a small ticket stub: MY HUNTS | dashed divider | count + chevron. Desktop: always there (bottom right).
  // Phones: only once the slip has a leg, just above the bottom tab bar. Hidden while the drawer is open.
  const pill = document.createElement("button");
  pill.type = "button";
  pill.id = "lhHuntsPill";
  pill.className = "lh-hpill lines-only";
  pill.setAttribute("data-lh-open-hunts", "");
  pill.setAttribute("aria-label", "Open My Hunts");
  pill.innerHTML = `<span class="lh-hpill-label">My Hunts</span><span class="lh-hpill-divider" aria-hidden="true"></span><span class="lh-hpill-count" data-pill-count>0</span><i class="bi bi-chevron-up" aria-hidden="true"></i>`;
  document.body.appendChild(pill);

  const added = document.createElement("div");
  added.className = "lh-hadded lines-only";
  added.id = "lhHuntsAdded";
  added.setAttribute("role", "status");
  added.setAttribute("aria-live", "polite");
  added.hidden = true;
  document.body.appendChild(added);
  let addedTimer = null;
  const hideAdded = () => { clearTimeout(addedTimer); added.hidden = true; };
  added.addEventListener("click", (event) => { if (event.target.closest("[data-added-close]")) hideAdded(); });

  // A mini ticket above the pill: ADDED (or REPLACED when it took the place of another pick), the player, the prop and the odds.
  function showAdded(leg, replaced) {
    const side = leg.side === "under" ? "Under" : "Over";
    added.className = `lh-hadded lines-only lh-hadded--${leg.side}`;
    added.innerHTML = `
      <button type="button" class="lh-hadded-x" data-added-close aria-label="Close"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
      <div class="lh-hadded-label">${replaced ? "Replaced" : "Added"}</div>
      <div class="lh-hadded-body">
        <div class="lh-hadded-main">
          <div class="lh-hadded-name">${escapeText(leg.player)}</div>
          <div class="lh-hadded-prop"><span class="lh-hleg-side">${side}</span> ${leg.line} ${escapeText(huntStatName(leg.stat))}${leg.isAlt ? ` <span class="lh-hleg-tag">Alt</span>` : ""}</div>
        </div>
        <div class="lh-hadded-odds">${formatAmerican(leg.odds)}</div>
      </div>`;
    added.hidden = false;
    clearTimeout(addedTimer);
    addedTimer = setTimeout(hideAdded, 4000);
  }

  drawer.addEventListener("show.bs.offcanvas", () => { document.body.classList.add("lh-hunts-open"); hideAdded(); });
  drawer.addEventListener("hidden.bs.offcanvas", () => document.body.classList.remove("lh-hunts-open"));

  document.addEventListener("lh-hunts-change", (event) => {
    render();
    const { action, leg, replaced } = event.detail || {};
    if (action === "add" && leg && !document.body.classList.contains("lh-hunts-open")) showAdded(leg, replaced);
  });

  // Research mode hides My Hunts: close it if it is open (the slip stays saved).
  document.addEventListener("lh-mode-change", () => {
    if (document.body.classList.contains("research-mode")) {
      const instance = bootstrap.Offcanvas.getInstance(drawer);
      if (instance) instance.hide();
    }
  });

  render();
})();
