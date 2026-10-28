// LineHunter - js/components/playerJump.js
// The jump bar on player.html (#playerJump): one link per [data-lh-jump="Label"] section, in page order. It sits under the
// name and sticks at the top of the screen once the name scrolls away (CSS position: sticky); then it gets .is-stuck, the short
// name ("P. Reed #7", set by renderHeader in js/pages/player.js) shows in front and the section in view is underlined.
// A link is hidden while its section is (Score with no scored prop, research mode) and, from 992px, for the sidebar cards
// (Players, Injuries sit beside the main column there, not below it).

const playerJumpWide = window.matchMedia("(min-width: 992px)");

function setPlayerJumpName(name, jersey) {
  const el = document.getElementById("playerJumpName");
  if (el) el.innerHTML = `${name}${jersey ? ` <span class="lh-pj-jersey">#${jersey}</span>` : ""}`;
}

(function initPlayerJump() {
  const bar = document.getElementById("playerJump");
  const track = document.getElementById("playerJumpLinks");
  if (!bar || !track) return;
  const targets = [...document.querySelectorAll("[data-lh-jump]")];
  targets.forEach((el) => { if (!el.id) el.id = `jump-${el.dataset.lhJump.toLowerCase()}`; });
  track.innerHTML = targets.map((el) => `<a href="#${el.id}" class="lh-pj-link" data-jump-to="${el.id}">${el.dataset.lhJump}</a>`).join("");
  const links = [...track.querySelectorAll(".lh-pj-link")];

  const shown = (el) => el.offsetParent !== null && !(playerJumpWide.matches && el.closest("aside"));
  // Where the bar sticks: right under the navbar while it is on screen, else the very top. The navbar sits inside #site-nav,
  // so it scrolls away with the page and the bar ends up at 0; were the navbar ever to stay put, the bar stays under it.
  const stickTop = () => {
    const nav = document.querySelector(".lh-navbar");
    return nav ? Math.max(0, nav.getBoundingClientRect().bottom) : 0;
  };

  let active = "";
  function update() {
    const top = stickTop();
    bar.style.setProperty("--lh-pj-top", `${top}px`);
    bar.classList.toggle("is-stuck", bar.getBoundingClientRect().top <= top + 1);
    const line = top + bar.offsetHeight + 24;
    let current = "";
    targets.forEach((el, i) => {
      const visible = shown(el);
      links[i].hidden = !visible;
      if (visible && el.getBoundingClientRect().top <= line) current = el.id;
    });
    if (!bar.classList.contains("is-stuck")) current = "";
    if (current === active) return;
    active = current;
    links.forEach((link) => {
      const on = link.dataset.jumpTo === current;
      link.classList.toggle("is-active", on);
      if (on) link.setAttribute("aria-current", "location"); else link.removeAttribute("aria-current");
      // Keep the underlined link in view inside the sideways track
      if (on) track.scrollTo({ left: link.offsetLeft - track.offsetLeft - 16, behavior: "smooth" });
    });
  }

  track.addEventListener("click", (event) => {
    const link = event.target.closest(".lh-pj-link");
    if (!link) return;
    const el = document.getElementById(link.dataset.jumpTo);
    if (!el) return;
    event.preventDefault();
    const nav = document.querySelector(".lh-navbar");
    const navStays = nav && getComputedStyle(nav).position === "fixed"; // a navbar that never scrolls away
    const y = el.getBoundingClientRect().top + window.scrollY - (navStays ? nav.offsetHeight : 0) - bar.offsetHeight - 8;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: Math.max(0, y), behavior: smooth ? "smooth" : "auto" });
  });

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; update(); });
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  window.addEventListener("lh-mode-change", schedule);
  // Sections appear / hide / collapse after their data loads: recheck when the page changes size
  if ("ResizeObserver" in window) new ResizeObserver(schedule).observe(document.querySelector("main") || document.body);
  update();
})();
