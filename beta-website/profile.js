// The profile page: a column of tabs, one panel showing at a time. Uses PROPS and GAME_DATES from data.js. DESIGN PREVIEW: see auth.js.
(function () {
  const AUTH = window.LH_AUTH;
  const user = AUTH.user();
  if (!user) return; // auth.js is already on its way to the sign-in page
  const $ = (id) => document.getElementById(id);
  const initial = (text) => text.trim().charAt(0).toUpperCase();
  const { BOOKS, bookById } = window.LH_BOOKS;

  // Tabs. The address remembers the open one, so links like profile.html#connectors work.
  const tabs = [...document.querySelectorAll(".pf-tabs [role=tab]")];
  function openTab(tab, moveFocus) {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute("aria-controls")).hidden = !on;
    });
    history.replaceState(null, "", `#${tab.dataset.tab}`);
    tab.scrollIntoView({ block: "nearest", inline: "nearest" }); // on phones the tabs are a row you swipe across
    if (moveFocus) tab.focus();
  }
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => openTab(t));
    t.addEventListener("keydown", (e) => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      openTab(tabs[(i + step + tabs.length) % tabs.length], true);
    });
  });
  const tabFromAddress = () => tabs.find((t) => `#${t.dataset.tab}` === location.hash) || tabs[0];
  openTab(tabFromAddress());
  window.addEventListener("hashchange", () => openTab(tabFromAddress()));
  // Web fonts change the tab widths, so line the open tab up again once they arrive
  if (document.fonts) document.fonts.ready.then(() => openTab(tabFromAddress()));

  // Name
  function showName(name) {
    $("pf-title").textContent = name || "Your profile";
    $("pf-avatar").textContent = initial(name || user.email);
    if ($("lh-me")) $("lh-me").textContent = initial(name || user.email);
  }
  $("pf-name").value = user.name;
  showName(user.name);
  $("pf-name-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("pf-name").value.trim();
    const saved = AUTH.setName(name);
    $("pf-name-msg").classList.toggle("is-info", saved);
    $("pf-name-msg").textContent = saved ? (name ? "Saved." : "Name cleared.") : "Your browser is blocking saved site data, so this couldn't be saved.";
    if (saved) showName(name);
  });

  // Email stays hidden until you choose to see it
  function maskEmail(email) {
    const [local, domain] = email.split("@");
    return `${local.charAt(0)}${"•".repeat(Math.max(local.length - 1, 3))}@${domain}`;
  }
  let shown = false;
  function showEmail() {
    $("pf-email").textContent = shown ? user.email : maskEmail(user.email);
    $("pf-email-toggle").textContent = shown ? "Hide" : "Show";
    $("pf-email-toggle").setAttribute("aria-label", shown ? "Hide email address" : "Show email address");
  }
  $("pf-email-toggle").addEventListener("click", () => { shown = !shown; showEmail(); });
  showEmail();

  // Password
  $("pf-forgot").addEventListener("click", () => window.LH_MODAL.open("forgot", user.email));
  $("pf-pass-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const msg = $("pf-pass-msg");
    const fail = (text, field) => { msg.classList.remove("is-info"); msg.textContent = text; field.focus(); };
    if (!$("pf-pass-now").value) return fail("Enter your current password.", $("pf-pass-now"));
    if ($("pf-pass-new").value.length < 8) return fail("Use at least 8 characters for your new password.", $("pf-pass-new"));
    if ($("pf-pass-new").value !== $("pf-pass-again").value) return fail("The new passwords don't match.", $("pf-pass-again"));
    e.target.reset();
    msg.classList.add("is-info");
    msg.textContent = "Design preview: nothing was changed. When this goes live, your password updates here.";
  });

  // Settings: the default book
  const fillBooks = (kind) => BOOKS.filter((b) => b.kind === kind).map((b) => `<option value="${b.id}">${b.name}</option>`).join("");
  $("pf-default-book").innerHTML = `<optgroup label="Sportsbooks">${fillBooks("book")}</optgroup><optgroup label="Markets">${fillBooks("market")}</optgroup>`;
  $("pf-default-book").value = bookById(AUTH.prefs().book).id;
  $("pf-default-book").addEventListener("change", (e) => {
    const saved = AUTH.savePrefs({ ...AUTH.prefs(), book: e.target.value });
    $("pf-settings-msg").classList.toggle("is-info", saved);
    $("pf-settings-msg").textContent = saved ? `Saved. Your Hunt List now opens at ${bookById(e.target.value).name}.` : "Your browser is blocking saved site data, so this couldn't be saved.";
    if (saved) document.dispatchEvent(new CustomEvent("lh-default-book"));
    renderConnectors();
  });

  // Connectors
  function connectorRow(book) {
    const prefs = AUTH.prefs();
    const on = prefs.connected.includes(book.id);
    return `<li class="pf-conn">
      <span><b>${book.name}</b>${prefs.book === book.id ? '<small class="pf-default">Default</small>' : ""}</span>
      <span class="pf-conn-state${on ? " is-on" : ""}">${on ? "Connected" : "Not connected"}</span>
      <button type="button" class="pf-ghost" data-book="${book.id}" aria-label="${on ? "Disconnect" : "Connect"} ${book.name}">${on ? "Disconnect" : "Connect"}</button>
    </li>`;
  }
  function renderConnectors() {
    $("pf-conn-books").innerHTML = BOOKS.filter((b) => b.kind === "book").map(connectorRow).join("");
    $("pf-conn-markets").innerHTML = BOOKS.filter((b) => b.kind === "market").map(connectorRow).join("");
  }
  $("pf-connectors").addEventListener("click", (e) => {
    const b = e.target.closest("[data-book]");
    if (!b) return;
    const prefs = AUTH.prefs();
    const id = b.dataset.book;
    const connected = prefs.connected.includes(id) ? prefs.connected.filter((x) => x !== id) : [...prefs.connected, id];
    AUTH.savePrefs({ ...prefs, connected });
    document.dispatchEvent(new CustomEvent("lh-connectors-changed"));
    renderConnectors();
    document.querySelector(`[data-book="${id}"]`).focus();
  });
  renderConnectors();

  $("pf-out").addEventListener("click", AUTH.signOut);

  // Previous hunts: sample history, worked out from the made-up game logs, so the finished state can be judged.
  // Every player here is on an active streak, so each one's latest game is a hit. Every other row uses that player's
  // latest miss instead, so the list shows both results.
  const STAT = { "3PM": "TPM" };
  const isHit = (p, value) => (p.dir === "Over" ? value > p.line : value < p.line);
  const samples = PROPS.slice(0, 6).map((p, row) => {
    let at = p.games.length - 1;
    if (row % 2) {
      const miss = p.games.map((value, i) => (isHit(p, value) ? -1 : i)).filter((i) => i !== -1).pop();
      if (miss !== undefined) at = miss;
    }
    return { p, at, value: p.games[at], hit: isHit(p, p.games[at]) };
  });
  const hits = samples.filter((s) => s.hit).length;
  $("pf-sample-note").textContent = `Sample history · ${hits} of ${samples.length} hit`;
  $("pf-history").innerHTML = samples.map(({ p, at, value, hit }) => `
    <li class="pf-hunt">
      <span><a href="player.html?p=${p.player.replace(/\W/g, "")}&stat=${STAT[p.market] || p.market}&side=${p.dir}">${p.player}</a><small>${p.dir} ${p.line} ${p.market}, ${GAME_DATES[at]} vs ${p.opps[at]}</small></span>
      <span class="pf-result ${hit ? "pf-hit" : "pf-miss"}">${hit ? "Hit" : "Miss"}<small>${value} ${p.market}</small></span>
    </li>`).join("");
})();
