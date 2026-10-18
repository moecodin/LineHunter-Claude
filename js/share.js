// LineHunter - js/share.js
// Shared "share as an image" code for the Hit List cards, the player page and the player drawer.
//   shareNodeAsImage(): draws an off-screen element to a PNG, then opens the share sheet or downloads it.
//   shareChartCard():   builds the picture for a prop chart (name, prop, line, hit rate, the chart itself).
// html2canvas (the tool that draws HTML to an image) is only downloaded the first time someone taps share.

const HTML2CANVAS_URL = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
let html2canvasPromise = null;

// Under every shared picture.
const SHARE_NOTE_HTML = `
  <div class="lh-share-note">
    <div class="lh-share-url">linehunter.app</div>
    <div>Based on past results — not guarantees.</div>
    <div>Please gamble responsibly. 21+. Problem gambling? Call 1-800-GAMBLER.</div>
  </div>`;

// The logo row at the top of every shared picture. rightText = the small label on the right.
function shareBrandHtml(rightText) {
  return `
    <div class="lh-share-brand">
      <span class="lh-logo">Line<span>Hunter</span></span>
      <span class="lh-label text-muted">${rightText}</span>
    </div>`;
}

function loadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  if (!html2canvasPromise) {
    html2canvasPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = HTML2CANVAS_URL;
      script.onload = () => resolve(window.html2canvas);
      script.onerror = () => {
        html2canvasPromise = null; // let the next tap try again
        reject(new Error("Couldn't load the image tool."));
      };
      document.head.appendChild(script);
    });
  }
  return html2canvasPromise;
}

// innerHtml: the picture's content (it gets the .lh-share-card look, built off-screen).
// button: the share button that was tapped; its icon turns into an hourglass while we work.
async function shareNodeAsImage(innerHtml, { filename, title, text, button }) {
  const icon = button.querySelector("i");
  const normalIcon = icon ? icon.className : "";
  button.disabled = true;
  if (icon) icon.className = "bi bi-hourglass-split";

  const holder = document.createElement("div");
  holder.className = "lh-share-card";
  holder.innerHTML = innerHtml;
  document.body.appendChild(holder);

  try {
    const [html2canvas] = await Promise.all([loadHtml2Canvas(), document.fonts ? document.fonts.ready : null]);
    const canvas = await html2canvas(holder, { backgroundColor: "#0b0b0b", scale: 2, useCORS: true, logging: false });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Couldn't make the image.");

    const file = new File([blob], filename, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title, text });
    } else {
      // No share sheet here (most desktops): save the picture instead.
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }
  } catch (error) {
    // Closing the share sheet counts as an AbortError: that's not a problem.
    if (error.name !== "AbortError") {
      console.error(error);
      button.title = "Sharing failed. Try again.";
    }
  } finally {
    holder.remove();
    if (icon) icon.className = normalIcon;
    button.disabled = false;
  }
}

// A picture of a prop chart. chart = the object from createPropChart (js/propChart.js).
// info: { name, meta, propLabel, filterText, lineText, hitRateText, averageText }, all plain text.
function shareChartCard(chart, info, button) {
  const image = chart.toImage();
  if (!image) return; // nothing drawn yet
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const stat = (label, value) => `<div><div class="lh-label">${label}</div><div class="lh-drawer-stat">${value}</div></div>`;

  shareNodeAsImage(`
    ${shareBrandHtml(today)}
    <div class="lh-hitlist-card lh-share-panel">
      <h2 class="lh-display lh-share-name">${info.name}</h2>
      <div class="lh-label mb-3">${info.meta}</div>
      <div class="lh-label mb-2">${info.propLabel} · ${info.filterText}</div>
      <div class="d-flex gap-4 mb-3">
        ${stat("Line", info.lineText)}
        ${stat("Hit rate", info.hitRateText)}
        ${stat("Average", info.averageText)}
      </div>
      <img class="lh-share-chart" src="${image}" alt="">
    </div>
    ${SHARE_NOTE_HTML}`, {
    filename: `linehunter-${info.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
    title: `${info.name} · ${info.propLabel}`,
    text: `${info.name} ${info.propLabel} on LineHunter.`,
    button,
  });
}
