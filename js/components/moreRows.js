// LineHunter - js/components/moreRows.js
// Phones only (the CSS does the hiding, so desktop and tablet are unchanged): a list shows its first few items by default
// (3 by default), with a "Show more" button for the rest. limitRowsOnPhones(container, itemSelector, keep) marks the items
// after the first `keep` and adds the button. The schedule page uses it for the rows of Top Hit Rates / Hot Players (3 rows)
// and for the small cards of the Hit List / Streaks grids (2 cards).

const PHONE_ROWS = 3;

function limitRowsOnPhones(container, rowSelector, keep = PHONE_ROWS) {
  if (!container) return;
  container.classList.remove("lh-clip", "is-expanded");
  const oldLink = container.querySelector(":scope > .lh-more-link");
  if (oldLink) oldLink.remove();

  const rows = [...container.querySelectorAll(rowSelector)];
  rows.forEach((row, index) => row.classList.toggle("lh-more-row", index >= keep));
  if (rows.length <= keep) return;

  container.classList.add("lh-clip");
  const link = document.createElement("button");
  link.type = "button";
  link.className = "lh-more-link";
  link.textContent = "Show more";
  link.setAttribute("aria-expanded", "false");
  link.addEventListener("click", () => {
    const open = container.classList.toggle("is-expanded");
    link.textContent = open ? "Show less" : "Show more";
    link.setAttribute("aria-expanded", String(open));
  });
  container.appendChild(link);
}
