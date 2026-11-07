// Everything people see around sign-in: the form, the pop-up, the header button and the guest preview. See auth.js.
(function () {
  const AUTH = window.LH_AUTH;
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const NOTE = "Design preview: no account is created. Don't enter a real password.";

  // The same form works in the sign-in page's bar and in the pop-up
  function bindForm(root, onDone) {
    const f = (name) => root.querySelector(`[data-f="${name}"]`);
    const seg = f("modes");
    const email = f("email");
    const password = f("password");
    const msg = f("msg");
    let mode = "in";

    const say = (text) => { msg.textContent = text; };
    const mark = (field, bad) => (bad ? field.setAttribute("aria-invalid", "true") : field.removeAttribute("aria-invalid"));

    seg.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      mode = b.dataset.mode;
      seg.dataset.mode = mode;
      seg.querySelectorAll("button").forEach((m) => m.setAttribute("aria-pressed", String(m === b)));
      f("submit").textContent = mode === "in" ? "Sign in" : "Create account";
      f("password-label").textContent = mode === "in" ? "Password" : "Password, 8 or more characters";
      password.autocomplete = mode === "in" ? "current-password" : "new-password";
      f("forgot").hidden = mode === "up";
      if (f("title")) f("title").textContent = mode === "in" ? "Sign in to Line Hunter" : "Sign up for Line Hunter";
      say("");
      mark(email, false);
      mark(password, false);
    }));

    f("forgot").addEventListener("click", () => openModal("forgot", email.value.trim()));

    root.addEventListener("submit", (e) => {
      e.preventDefault();
      const address = email.value.trim();
      const badEmail = !EMAIL.test(address);
      const badPassword = mode === "up" ? password.value.length < 8 : password.value.length === 0;
      mark(email, badEmail);
      mark(password, badPassword);
      if (badEmail) { say("Enter your email address, like name@example.com."); email.focus(); return; }
      if (badPassword) {
        say(mode === "up" ? "Use at least 8 characters for your password." : "Enter your password.");
        password.focus();
        return;
      }
      if (!AUTH.signIn(address, f("stay").checked)) {
        say("Your browser is blocking saved site data, so we can't sign you in. Allow it and try again.");
        return;
      }
      password.value = "";
      onDone();
    });
  }

  // The pop-up
  const modal = document.createElement("dialog");
  modal.className = "am";
  modal.innerHTML = `
    <button type="button" class="am-close" aria-label="Close">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M1 1l12 12M13 1L1 13"/></svg>
    </button>
    <form class="am-view" data-view="auth" novalidate>
      <p class="am-why" data-a="why" hidden></p>
      <h2 id="am-title" data-f="title">Sign in to Line Hunter</h2>
      <p class="am-sub">Get every stat, streak and game log, and keep track of your hunts.</p>
      <div class="si-modes am-modes" data-f="modes" data-mode="in" role="group" aria-label="Choose sign in or sign up">
        <span class="si-thumb" aria-hidden="true"></span>
        <button type="button" data-mode="in" aria-pressed="true">Sign in</button>
        <button type="button" data-mode="up" aria-pressed="false">Sign up</button>
      </div>
      <label class="si-field"><span>Email</span><input data-f="email" type="email" autocomplete="email" inputmode="email" spellcheck="false"></label>
      <label class="si-field"><span data-f="password-label">Password</span><input data-f="password" type="password" autocomplete="current-password"></label>
      <div class="am-row">
        <label class="si-stay"><input data-f="stay" type="checkbox"> Stay signed in</label>
        <button type="button" class="si-link" data-f="forgot">Forgot password?</button>
      </div>
      <p class="si-msg" data-f="msg" role="status"></p>
      <button class="si-submit am-submit" data-f="submit" type="submit">Sign in</button>
      <p class="si-note">${NOTE}</p>
    </form>
    <form class="am-view" data-view="forgot" novalidate hidden>
      <h2>Reset your password</h2>
      <p class="am-sub">Enter your email and we'll send you a link to choose a new one.</p>
      <label class="si-field"><span>Email</span><input data-r="email" type="email" autocomplete="email" inputmode="email" spellcheck="false"></label>
      <p class="si-msg" data-r="msg" role="status"></p>
      <button class="si-submit am-submit" type="submit">Send reset link</button>
      <button type="button" class="si-link am-back" data-r="back">Back to sign in</button>
    </form>`;
  document.body.appendChild(modal);

  const authView = modal.querySelector('[data-view="auth"]');
  const forgotView = modal.querySelector('[data-view="forgot"]');
  const resetEmail = modal.querySelector('[data-r="email"]');
  const resetMsg = modal.querySelector('[data-r="msg"]');

  function showView(view) {
    authView.hidden = view !== "auth";
    forgotView.hidden = view !== "forgot";
    modal.setAttribute("aria-label", view === "auth" ? "Sign in or sign up" : "Reset your password");
  }

  // `why` says what brought the pop-up up. New guests have no account yet, so it starts on Sign up.
  function openModal(view, email, why) {
    showView(view || "auth");
    const whyLine = authView.querySelector('[data-a="why"]');
    whyLine.hidden = !why;
    whyLine.innerHTML = why || "";
    if (why) authView.querySelector('[data-mode="up"]').click();
    resetMsg.textContent = "";
    authView.querySelector('[data-f="msg"]').textContent = "";
    authView.querySelectorAll("[aria-invalid]").forEach((field) => field.removeAttribute("aria-invalid"));
    if (email !== undefined) resetEmail.value = email;
    if (!modal.open) modal.showModal();
    (view === "forgot" ? resetEmail : authView.querySelector('[data-f="email"]')).focus();
  }

  modal.querySelector(".am-close").addEventListener("click", () => modal.close());
  modal.addEventListener("click", (e) => { // only the dimmed area outside the card closes it
    if (e.target !== modal) return;
    const box = modal.getBoundingClientRect();
    if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) modal.close();
  });
  modal.querySelector('[data-r="back"]').addEventListener("click", () => {
    if (AUTH.user()) modal.close();
    else openModal("auth");
  });
  forgotView.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!EMAIL.test(resetEmail.value.trim())) {
      resetEmail.setAttribute("aria-invalid", "true");
      resetMsg.classList.remove("is-info");
      resetMsg.textContent = "Enter your email address, like name@example.com.";
      resetEmail.focus();
      return;
    }
    resetEmail.removeAttribute("aria-invalid");
    resetMsg.classList.add("is-info");
    resetMsg.textContent = "Design preview: no email was sent. When this goes live, a reset link goes to this address.";
  });
  bindForm(authView, () => location.reload());

  window.LH_MODAL = { open: openModal };

  // Beta sits beside the logo as real text, so it can be removed at launch without touching the logo
  const beta = () => {
    const tag = document.createElement("span");
    tag.className = "lh-beta";
    tag.textContent = "Beta";
    return tag;
  };
  const logoLink = document.querySelector(".site-header a:has(.logo)");
  const bigLogo = document.querySelector(".wl-brand");
  if (logoLink) logoLink.append(beta());
  if (bigLogo) bigLogo.append(beta());

  // Sign-in page: its own form, and the three buttons let guests in for a look
  if (AUTH.page === "signin") {
    document.querySelectorAll("[data-get-started]").forEach((b) => b.addEventListener("click", () => {
      openModal("auth");
      authView.querySelector('[data-mode="up"]').click(); // new visitors start on Sign up
    }));
    document.querySelectorAll(".wl-btn").forEach((link) => link.addEventListener("click", AUTH.enterAsGuest));
    return;
  }

  // Header: your profile at the top left, or a sign-in button for guests
  const user = AUTH.user();
  const nav = document.querySelector(".site-nav");
  if (user && logoLink) {
    const group = document.createElement("div");
    group.className = "lh-brand";
    logoLink.before(group);
    const me = document.createElement("a");
    me.className = "lh-me";
    me.id = "lh-me";
    me.href = "profile.html";
    me.setAttribute("aria-label", "Your profile");
    if (AUTH.page === "account") me.setAttribute("aria-current", "page");
    me.textContent = (user.name || user.email).trim().charAt(0).toUpperCase();
    group.append(me, logoLink);
  }
  if (user) return;

  // Guests from here down. They get the three pages, with the numbers blurred, and one free prop a day.
  // All of this only hides data on screen and counts in this browser. A real launch must do both on the server.
  const here = location.pathname.split("/").pop() || "index.html";
  if (logoLink) {
    logoLink.href = "signin.html";
    logoLink.removeAttribute("data-wipe");
    logoLink.setAttribute("aria-label", "Back to the sign-in page");
  }
  if (nav) {
    nav.innerHTML = [["tonight.html", "Tonight's games"], ["featured.html", "Featured players"], ["streak-board.html", "Streak Board"]]
      .map(([href, label]) => `<a href="${href}"${href === here ? ' aria-current="page"' : ""}>${label}</a>`).join("");
    const inBtn = document.createElement("button");
    inBtn.type = "button";
    inBtn.className = "lh-signin";
    inBtn.textContent = "Sign in";
    inBtn.addEventListener("click", () => openModal("auth"));
    nav.before(inBtn);
  }
  const gameBack = document.querySelector(".gm-back");
  if (gameBack) gameBack.href = gameBack.getAttribute("href").replace("index.html", "tonight.html");

  // Lists: a whole row or card opens that player, instead of showing more stats in place
  document.addEventListener("click", (e) => {
    const opener = e.target.closest && e.target.closest(".row-open, .card-open");
    if (!opener) return;
    const link = opener.parentElement.querySelector("a.name");
    if (!link) return;
    e.preventDefault();
    e.stopPropagation();
    location.href = link.href;
  }, true);

  // One free prop in one game a day, reset at midnight on the visitor's own clock
  const FREE_KEY = "lh-free-prop";
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  };
  const readFree = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(FREE_KEY));
      return saved && saved.day === today() && saved.game !== undefined ? saved : null;
    } catch (err) { return null; }
  };
  const writeFree = (free) => { try { localStorage.setItem(FREE_KEY, JSON.stringify(free)); } catch (err) { /* blocked: it counts for this page only */ } };
  const escape = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const freeLink = (free) => `<a href="${escape(free.url)}">${escape(free.player)}, ${escape(free.label)}</a>`;

  function banner(html) {
    const main = document.querySelector("main");
    if (!main) return;
    const bar = document.createElement("aside");
    bar.className = "lh-free";
    bar.innerHTML = `<p>${html}</p><button type="button" class="lh-free-in">Sign in or sign up</button>`;
    bar.querySelector("button").addEventListener("click", () => openModal("auth"));
    main.before(bar);
  }

  // The player page: the free prop in its one game opens fully, anything else is blurred under the sign-in block
  const statMenu = document.getElementById("stat");
  const gameMenu = document.getElementById("game-select");
  const layout = document.querySelector(".rs-page > .rs-layout");
  if (statMenu && gameMenu && layout) {
    const name = document.querySelector(".rs-who h1").textContent.trim();
    const playerId = new URLSearchParams(location.search).get("p") || "";
    const label = () => `${statMenu.selectedOptions[0].textContent.trim()}, ${gameMenu.selectedOptions[0].textContent.trim()}`;
    let free = readFree();
    if (!free) {
      const gameQuery = gameMenu.value === "0" ? "" : `&game=${encodeURIComponent(gameMenu.value)}`;
      free = { day: today(), player: name, stat: statMenu.value, game: gameMenu.value, label: label(), url: `player.html?p=${encodeURIComponent(playerId)}&stat=${encodeURIComponent(statMenu.value)}${gameQuery}` };
      writeFree(free);
    }

    const wrap = document.createElement("div");
    wrap.className = "lh-locked";
    layout.before(wrap);
    const box = document.createElement("div");
    box.className = "lh-gate";
    box.innerHTML = `<div class="lh-gate-card">
      <h2>Sign in for the full experience</h2>
      <p>Guests get one free prop a day, and today's was ${freeLink(free)}. It resets at midnight.</p>
      <button type="button" class="si-submit">Sign in or sign up</button>
    </div>`;
    box.querySelector("button").addEventListener("click", () => openModal("auth"));
    wrap.append(layout, box);

    banner(`This is your free prop for today: <b>${escape(free.player)}, ${escape(free.label)}</b>. Other games, props and players open when you sign in.`);
    const notice = document.querySelector(".lh-free");
    const controls = document.querySelector(".rs-controls");

    const apply = () => {
      const open = free.player === name && free.stat === statMenu.value && free.game === gameMenu.value;
      document.documentElement.classList.toggle("fl-open", open);
      layout.inert = !open;
      box.hidden = open;
      if (notice) notice.hidden = !open;
      if (!open) openModal("auth", undefined, `You've used today's free prop: ${freeLink(free)}. It resets at midnight.`); // closing it leaves the blur and the sign-in block
    };
    // On the same player the stat and game menus stay live, so they can switch back. Other players' controls are locked.
    controls.inert = free.player !== name;
    statMenu.addEventListener("change", apply);
    gameMenu.addEventListener("change", apply);
    apply();
    return;
  }

  // Everything else keeps its numbers blurred, and the names stay clickable
  const panel = document.getElementById("panel");
  if (panel) panel.inert = true;
  const side = document.querySelector("#game .rs-side");
  if (side) side.inert = true;
  const free = readFree();
  banner(free
    ? `You've used today's free prop: ${freeLink(free)}. It resets at midnight, or sign in to see everything.`
    : "Guest preview: the first player you open becomes today's free prop. Sign in to see everything.");
})();
