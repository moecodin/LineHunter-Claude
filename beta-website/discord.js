// Discord in the bottom right corner: a round button that opens a card when clicked. It never opens on its own, so it can't cover the data.
(function () {
  // Paste the real invite here (for example https://discord.gg/abc123).
  const DISCORD_URL = "https://discord.gg/NdPXKyUxV";
  const MARK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>`;

  const box = document.createElement("div");
  box.className = "dc";
  box.innerHTML = `
    <button type="button" class="dc-fab" aria-label="Open the Line Hunter Discord invite" aria-expanded="false">${MARK}</button>
    <aside class="dc-card" aria-labelledby="dc-title">
      <div class="dc-body">
        <button type="button" class="dc-close" aria-label="Close Discord message">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M1 1l12 12M13 1L1 13"/></svg>
        </button>
        <h2 id="dc-title">Join the Line Hunter Discord</h2>
        <p>Talk through tonight's props with other bettors.</p>
        <a class="dc-join" href="${DISCORD_URL || "#discord"}"${DISCORD_URL ? ' target="_blank" rel="noopener"' : ""}>${MARK} Join the Discord</a>
        <p class="dc-note" hidden>Design preview: the invite link isn't connected yet.</p>
      </div>
    </aside>`;
  document.body.appendChild(box);

  const fab = box.querySelector(".dc-fab");
  const join = box.querySelector(".dc-join");

  function setOpen(open, moveFocus) {
    box.classList.toggle("is-open", open);
    fab.setAttribute("aria-expanded", String(open));
    if (moveFocus) (open ? join : fab).focus({ preventScroll: true });
  }

  fab.addEventListener("click", () => setOpen(true, true));
  box.querySelector(".dc-close").addEventListener("click", () => setOpen(false, true));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && box.classList.contains("is-open")) setOpen(false, box.contains(document.activeElement));
  });
  document.querySelectorAll("[data-discord-open]").forEach((b) => b.addEventListener("click", () => setOpen(true, true)));
  if (!DISCORD_URL) {
    join.addEventListener("click", (e) => {
      e.preventDefault();
      box.querySelector(".dc-note").hidden = false;
    });
  }

})();
