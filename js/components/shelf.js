// LineHunter - js/components/shelf.js
// Helpers for a horizontal "shelf": a row of cards inside a .lh-shelf-track that scrolls sideways (scroll-snap, hidden
// scrollbar) while the rest of the page doesn't. The ← → buttons (data-shelf-target="#trackId" data-shelf-dir="-1|1")
// move it one card. Used by the schedule page's Hit List (lines mode) and Streaks (research mode).
//   refreshShelf("#hitlistShelf")  call after drawing the cards: back to the first card, arrows up to date.

function updateShelfArrows(track) {
  document.querySelectorAll(`[data-shelf-target="#${track.id}"]`).forEach((button) => {
    const direction = Number(button.dataset.shelfDir);
    button.disabled = direction < 0
      ? track.scrollLeft <= 1                                           // at the start: no ←
      : track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;  // at the end: no →
  });
}

function refreshShelf(selector) {
  const track = document.querySelector(selector);
  if (!track) return;
  if (!track.dataset.shelfBound) {
    track.addEventListener("scroll", () => updateShelfArrows(track), { passive: true });
    track.dataset.shelfBound = "1";
  }
  track.scrollLeft = 0;
  updateShelfArrows(track);
}

// One click = one card (its width plus the gap).
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-shelf-dir]");
  if (!button) return;
  const track = document.querySelector(button.dataset.shelfTarget);
  const item = track && track.querySelector(".lh-shelf-item");
  if (!item) return;
  const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  track.scrollBy({ left: Number(button.dataset.shelfDir) * (item.offsetWidth + gap), behavior: reduced ? "auto" : "smooth" });
});

window.addEventListener("resize", () => {
  document.querySelectorAll(".lh-shelf-track").forEach(updateShelfArrows);
});
