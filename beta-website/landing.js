// Shared by the three landing page examples. Uses ALL and GAMES_TODAY from data.js and script.js.
(function () {
  // Paste the real invite here (for example https://discord.gg/abc123) and every Discord button uses it.
  const DISCORD_URL = "";
  const CLOSED_KEY = "lh-discord-closed";
  const OPEN_DELAY = 1600;

  // Numbers shown in a hero come straight from the same data as the board below.
  document.querySelectorAll("[data-stat]").forEach((el) => {
    const top = ALL[0];
    const stats = {
      games: `${GAMES_TODAY.length} games tonight`,
      props: `${ALL.length} props tracked`,
      streak: `${top.streak}-game streak: ${top.player}`,
    };
    el.textContent = stats[el.dataset.stat];
  });

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll("video").forEach((v) => { v.removeAttribute("autoplay"); v.pause(); });
  }

  const pop = document.createElement("aside");
  pop.className = "lp-discord";
  pop.hidden = true;
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-labelledby", "lp-discord-title");
  pop.innerHTML = `
    <button type="button" class="lp-discord-close" aria-label="Close Discord message">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M1 1l12 12M13 1L1 13"/></svg>
    </button>
    <h2 id="lp-discord-title">Join the Line Hunter Discord</h2>
    <p>Talk through tonight's props with other bettors.</p>
    <a class="lp-discord-join" href="#discord" data-discord data-in-pop>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>
      Join the Discord
    </a>
    <p class="lp-discord-note" hidden>Design preview: the invite link isn't connected yet.</p>`;
  document.body.appendChild(pop);

  const closeBtn = pop.querySelector(".lp-discord-close");
  const note = pop.querySelector(".lp-discord-note");
  let opener = null;
  let hideTimer = null;

  function open(from) {
    clearTimeout(hideTimer);
    opener = from || null;
    pop.hidden = false;
    pop.getBoundingClientRect(); // starts the fade from the closed state
    pop.classList.add("is-open");
    if (from) pop.querySelector(".lp-discord-join").focus(); // arriving on its own, it leaves focus alone
  }

  function close() {
    pop.classList.remove("is-open");
    hideTimer = setTimeout(() => { pop.hidden = true; }, 200);
    try { sessionStorage.setItem(CLOSED_KEY, "1"); } catch (err) { /* storage blocked: it returns on the next page load */ }
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
  }

  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !pop.hidden && pop.classList.contains("is-open")) close();
  });

  // Discord buttons go to the invite. Until there is one, they bring the message back.
  document.querySelectorAll("[data-discord]").forEach((link) => {
    if (DISCORD_URL) {
      link.href = DISCORD_URL;
      link.target = "_blank";
      link.rel = "noopener";
      return;
    }
    link.addEventListener("click", (e) => {
      e.preventDefault();
      if (link.hasAttribute("data-in-pop")) note.hidden = false;
      else open(link);
    });
  });

  let closedBefore = false;
  try { closedBefore = sessionStorage.getItem(CLOSED_KEY) === "1"; } catch (err) { /* see above */ }
  if (!closedBefore) setTimeout(() => { if (pop.hidden) open(); }, OPEN_DELAY);
})();
