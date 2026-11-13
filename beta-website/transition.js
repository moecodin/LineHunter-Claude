// Loaded in <head>, so the new page starts covered before anything paints.
// Add data-wipe to a link to give it the transition; data-wipe="back" reverses it.
(function () {
  const FLAG = "lh-wipe";
  const root = document.documentElement;

  // The fallback timers keep the page usable if the animation can't run,
  // for example in a background tab.
  let arriving = null;
  try {
    arriving = sessionStorage.getItem(FLAG);
    sessionStorage.removeItem(FLAG);
  } catch (err) { /* storage blocked: the new page just appears without the reveal */ }

  if (arriving) {
    root.classList.add("wipe-reveal");
    if (arriving === "left") root.classList.add("wipe-left");
    const done = () => root.classList.remove("wipe-reveal", "wipe-left");
    root.addEventListener("animationend", (e) => { if (e.pseudoElement === "::after") done(); });
    setTimeout(done, 1500);
  }

  document.addEventListener("click", (e) => {
    const link = e.target.closest && e.target.closest("a[data-wipe]");
    if (!link || e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // let "open in new tab" work
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    e.preventDefault();
    if (document.querySelector(".wipe-cover")) return;

    const direction = link.dataset.wipe === "back" ? "left" : "right";
    const cover = document.createElement("div");
    cover.className = direction === "left" ? "wipe-cover wipe-left" : "wipe-cover";
    cover.setAttribute("aria-hidden", "true");

    let gone = false;
    const go = () => {
      if (gone) return;
      gone = true;
      try { sessionStorage.setItem(FLAG, direction); } catch (err) { /* see above */ }
      window.location.href = link.href;
    };
    cover.addEventListener("animationend", go);
    setTimeout(go, 800);
    document.body.appendChild(cover);
  });

  // Coming back with the Back button can restore the page with the cover still on it.
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    const cover = document.querySelector(".wipe-cover");
    if (cover) cover.remove();
    root.classList.remove("wipe-reveal", "wipe-left");
  });
})();
