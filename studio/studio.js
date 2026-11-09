// LineHunter Studio (hidden page, studio.html): pick a source (Hit List card or Streaks), tick the rows, pick a design,
// size and photo, then download a post-ready PNG. The data is the slate js/components/top-hit-rates.js already builds
// (event "lh-top-slate"); the designs live in studio/designs/, the photo library in studio/photos/ (+ uploads kept in this browser).
// Needs: js/components/hit-list.js (HITLIST_CATEGORIES, buildSlip, shortName), js/components/share.js (loadHtml2Canvas).

const SIZES = { post: { w: 1080, h: 1350, label: "Post 4:5" }, square: { w: 1080, h: 1080, label: "Square 1:1" }, story: { w: 1080, h: 1920, label: "Story 9:16" } };
const STUDIO_NOTE = "Based on past results, not guarantees. Please gamble responsibly. 21+.\nProblem gambling? Call 1-800-GAMBLER. linehunterapp.com";
const LOGO_DARK = "assets/img/lh-lockup-on-dark.svg", LOGO_LIGHT = "assets/img/lh-lockup-on-light.svg";
const STREAK_SOURCES = [
  { id: "s-nuggets", label: "30+ PTS", title: "30-point streaks", stat: "30+ PTS", pick: (p) => (p.nuggets && p.nuggets.count >= 2 ? p.nuggets.count : 0) },
  { id: "s-reb", label: "Rebounds", title: "Rebounds streaks", stat: "10+ REB", pick: (p) => p.streaks.reb },
  { id: "s-ast", label: "Assists", title: "Assists streaks", stat: "8+ AST", pick: (p) => p.streaks.ast },
  { id: "s-3pm", label: "3PM", title: "Threes streaks", stat: "3+ 3PM", pick: (p) => p.streaks.fg3m },
];

const S = { slate: null, groups: [], source: null, rows: [], design: "night-poster", size: "post", photoId: "none", fields: {}, photos: [], uploads: [],
  style: { fontHead: "", fontBody: "", hero: 100, title: 100, rows: 100, colors: {}, off: {} } };
const HEAD_FONTS = ["Clash Display", "General Sans", "Cabinet Grotesk", "Switzer", "Boska", "Zodiak", "Gambetta", "Bebas Neue", "Satoshi"];
const BODY_FONTS = ["Satoshi", "General Sans", "Switzer", "Cabinet Grotesk", "Zodiak"];
const hexRgb = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); const n = m ? parseInt(m[1], 16) : 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function loadStyle() { try { const v = JSON.parse(localStorage.getItem("lh-studio-style") || "null"); if (v) S.style = { ...S.style, ...v, colors: v.colors || {}, off: v.off || {} }; } catch (e) { /* ok */ } }
function saveStyle() { try { localStorage.setItem("lh-studio-style", JSON.stringify(S.style)); } catch (e) { /* ok */ } }
function tokensFor(design) { return { ...design.tokens, ...(S.style.colors[design.id] || {}) }; }
// The CSS variables the designs read: colors, fonts. Set on a wrapper around the card (preview, thumbnails and export all use it).
function themeVars(design) {
  const t = tokensFor(design), st = S.style, bg = hexRgb(t.bg), ac = hexRgb(t.accent), ink = hexRgb(t.ink);
  const q = (f) => `'${f}'`;
  return `--c-bg:${t.bg};--c-ink:${t.ink};--c-mut:${t.mut};--c-accent:${t.accent};--c-good:${t.good || t.accent};--c-rule:${t.rule};--c-bg-rgb:${bg};--c-accent-rgb:${ac};--c-ink-rgb:${ink};--f-head:${q(st.fontHead || (design.id === "night-poster" ? "Clash Display" : "Clash Display"))};--f-body:${q(st.fontBody || "Satoshi")}`;
}
function themed(design, html, data) { return `<div class="st-theme" style="${themeVars(design)};width:${data.w}px;height:${data.h}px">${html}</div>`; }
async function ensureFonts(design) {
  if (!document.fonts) return;
  const heads = [S.style.fontHead || "Clash Display", S.style.fontBody || "Satoshi"];
  await Promise.all(heads.flatMap((f) => ["400", "500", "600", "700", "800"].map((w) => document.fonts.load(`${w} 40px "${f}"`).catch(() => null))));
}
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---------- Lock ----------
async function sha(text) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
const WORDS = [["copper", "harbor", "velvet", "maple", "signal", "granite", "ember", "cobalt", "juniper", "saffron"], ["lantern", "orbit", "falcon", "meadow", "anchor", "quartz", "thunder", "willow", "compass", "marble"], ["drift", "spark", "trail", "summit", "echo", "bridge", "comet", "ridge", "harvest", "tide"]];
function newPassphrase() { const r = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n; return WORDS.map((a) => a[r(a.length)]).join("-") + "-" + (10 + r(90)); }
function setLocked(locked) { $("stLock").hidden = !locked; document.body.style.overflow = locked ? "hidden" : ""; }
async function unlock() {
  const typed = $("stPass").value.trim().toLowerCase();
  if (!typed) return;
  if ((await sha(typed)) === window.STUDIO_PASS_HASH) { try { localStorage.setItem("lh-studio-ok", window.STUDIO_PASS_HASH); } catch (e) { /* ok */ } $("stErr").textContent = ""; setLocked(false); startStudio(); }
  else $("stErr").textContent = "That passphrase doesn't match.";
}
async function generatePass() {
  const p = newPassphrase(), h = await sha(p);
  $("stNewPass").textContent = p; $("stNewHash").textContent = `window.STUDIO_PASS_HASH = "${h}";`; $("stGenBox").hidden = false;
}

// ---------- Sources ----------
function dateLabel(iso) { if (!iso) return ""; return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }); }
function buildSources(slate) {
  const hit = [], streaks = [];
  HITLIST_CATEGORIES.filter((c) => !c.bbq && !c.brick).forEach((cat) => {
    const slip = buildSlip(cat, slate);
    if (!slip) return;
    hit.push({ id: "h-" + cat.key, label: cat.label, title: cat.label, rows: slip.map((p) => ({
      full: p.hunt ? p.hunt.player : p.name, n: p.hunt ? shortName(p.hunt.player) : p.name,
      t: p.hunt ? p.hunt.team : "", stat: p.text, rec: p.proof })) });
  });
  const fan = slate.fan || [];
  STREAK_SOURCES.forEach((src) => {
    const rows = fan.map((p) => ({ p, n: src.pick(p) })).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 10)
      .map((x) => ({ full: x.p.name, n: shortName(x.p.name), t: x.p.team, stat: src.stat, rec: `${x.n} straight` }));
    if (rows.length) streaks.push({ id: src.id, label: src.label, title: src.title, rows });
  });
  return [{ label: "Hit List cards", items: hit }, { label: "Streaks", items: streaks }].filter((g) => g.items.length);
}
function chooseSource(item) {
  S.source = item;
  S.rows = item.rows.map((r, i) => ({ ...r, id: i, on: i < 7 }));
  S.fields = { hero: "100%", title: item.title, subtitle: dateLabel(S.slate && S.slate.date), footer: "Find your next streak free on LineHunter", kicker: "Tonight's research" };
  autoPhoto();
  renderControls(); renderAll();
}

// ---------- Photos ----------
async function loadPhotos() {
  try { const res = await fetch("studio/photos/credits.json", { cache: "no-cache" }); S.photos = res.ok ? await res.json() : []; } catch (e) { S.photos = []; }
  S.uploads = await idbAll();
}
function allPhotos() {
  return [...S.photos.map((p) => ({ id: "lib:" + p.file, player: p.player, url: "studio/photos/" + p.file, credit: `Photo: ${p.photographer} / ${p.license}`, lic: p.license, sa: p.shareAlike })),
          ...S.uploads.map((u) => ({ id: "up:" + u.id, player: u.player, url: URL.createObjectURL(u.blob), credit: u.credit ? `Photo: ${u.credit}` : "", lic: "upload", mine: true }))];
}
function autoPhoto() {
  const lead = S.rows.find((r) => r.on); if (!lead) { S.photoId = "none"; return; }
  const last = norm(lead.full).split(" ").pop(), first = norm(lead.full)[0];
  const m = allPhotos().find((p) => norm(p.player).split(" ").pop() === last && norm(p.player)[0] === first);
  S.photoId = m ? m.id : "none";
}
function idbOpen() { return new Promise((res, rej) => { const r = indexedDB.open("lh-studio", 1); r.onupgradeneeded = () => r.result.createObjectStore("photos", { keyPath: "id" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbAll() { try { const db = await idbOpen(); return await new Promise((res) => { const q = db.transaction("photos").objectStore("photos").getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }); } catch (e) { return []; } }
async function idbPut(rec) { const db = await idbOpen(); return new Promise((res, rej) => { const t = db.transaction("photos", "readwrite"); t.objectStore("photos").put(rec); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function idbDelete(id) { const db = await idbOpen(); return new Promise((res) => { const t = db.transaction("photos", "readwrite"); t.objectStore("photos").delete(id); t.oncomplete = res; }); }
async function saveUpload() {
  const file = $("stUpFile").files[0], player = $("stUpPlayer").value.trim(), credit = $("stUpCredit").value.trim();
  if (!file || !player || !credit) { $("stUpMsg").textContent = "Pick a file and fill in the player and the photographer / source (it prints on the image)."; return; }
  const bmp = await createImageBitmap(file); const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
  const id = "u" + Date.now(); await idbPut({ id, player, credit: credit, blob });
  S.uploads = await idbAll(); S.photoId = "up:" + id;
  $("stUpMsg").textContent = "Saved on this device."; $("stUpFile").value = ""; renderControls(); renderAll();
}
const photoCache = {};
// html2canvas draws the lockup SVG clipped, so both logos are turned into PNGs on a canvas first.
async function rasterLogo(url) {
  const key = "logo|" + url; if (photoCache[key]) return photoCache[key];
  const img = await loadImg(url); const c = document.createElement("canvas"); c.width = 924; c.height = 160; c.getContext("2d").drawImage(img, 0, 0, 924, 160);
  return (photoCache[key] = c.toDataURL("image/png"));
}
function loadImg(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); }
// "duotone": grayscale mapped from the page color to indigo, drawn on a canvas (html2canvas can't blend, so it is baked in here).
async function processPhoto(url, mode, tint) {
  const key = url + "|" + mode + "|" + (tint ? tint.join(",") : ""); if (photoCache[key]) return photoCache[key];
  if (mode !== "duotone") return (photoCache[key] = url);
  const img = await loadImg(url); const k = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const g = c.getContext("2d"); g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height), px = d.data, lo = tint ? [Math.round(tint[0][0] * 1.4 + 4), Math.round(tint[0][1] * 1.4 + 4), Math.round(tint[0][2] * 1.8 + 18)] : [10, 14, 40], hi = tint ? tint[1] : [154, 147, 255];
  for (let i = 0; i < px.length; i += 4) {
    let l = (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) / 255; l = Math.min(1, Math.max(0, (l - 0.08) * 1.25));
    px[i] = lo[0] + (hi[0] - lo[0]) * l * 0.85; px[i + 1] = lo[1] + (hi[1] - lo[1]) * l * 0.85; px[i + 2] = lo[2] + (hi[2] - lo[2]) * l * 0.85;
  }
  g.putImageData(d, 0, 0); return (photoCache[key] = c.toDataURL("image/jpeg", 0.92));
}

// ---------- Cards ----------
async function cardData() {
  const design = STUDIO_DESIGNS.find((d) => d.id === S.design), size = SIZES[S.size];
  const sel = allPhotos().find((p) => p.id === S.photoId);
  let photo = null;
  if (sel) { try { photo = { url: await processPhoto(sel.url, design.photo, tintFor(design)), credit: sel.credit, player: sel.player }; } catch (e) { photo = null; } }
  const f = S.fields; await ensureFonts(design);
  const off = S.style.off[design.id] || {};
  return { design, data: { w: size.w, h: size.h, rows: S.rows.filter((r) => r.on), hero: f.hero, title: f.title, subtitle: f.subtitle, footer: f.footer, kicker: f.kicker, note: STUDIO_NOTE, photo, logo: await rasterLogo(LOGO_DARK), logoLight: await rasterLogo(LOGO_LIGHT),
    style: { hero: S.style.hero / 100, title: S.style.title / 100, rows: S.style.rows / 100, showLogo: off.showLogo !== true, showSub: off.showSub !== true, showPips: off.showPips !== true, showKicker: off.showKicker !== true } } };
}
const tintFor = (design) => { const t = tokensFor(design); return [hexRgb(t.bg), hexRgb(t.accent)]; };
function fitInto(el, host, w, h) { const k = host.clientWidth / w; host.style.height = Math.round(h * k) + "px"; el.style.transform = `scale(${k})`; }
let renderToken = 0;
async function renderAll() {
  if (!S.source) return; const token = ++renderToken;
  const { design, data } = await cardData(); if (token !== renderToken) return;
  data.rows = data.rows.slice(0, design.capacity(data, data));
  const host = $("stPv"); host.innerHTML = `<div class="st-scale" id="stScale">${themed(design, design.render(data), data)}</div>`; fitInto($("stScale"), host, data.w, data.h);
  $("stScale").style.position = "absolute";
  $("stMeta").textContent = `${data.w} × ${data.h} · ${data.rows.length} rows (this design fits ${design.capacity(data, data)} at this size) · data for ${dateLabel(S.slate.date)}`;
  renderThumbs();
}
async function renderThumbs() {
  const size = SIZES[S.size];
  for (const d of STUDIO_DESIGNS) {
    const box = document.querySelector(`[data-thumb="${d.id}"]`); if (!box) continue;
    const { data } = await cardData(); const dd = { ...data }; dd.photo = data.photo && (d.photo === "duotone" ? data.photo : data.photo);
    const sel = allPhotos().find((p) => p.id === S.photoId); if (sel) { try { dd.photo = { url: await processPhoto(sel.url, d.photo, tintFor(d)), credit: sel.credit, player: sel.player }; } catch (e) { /* none */ } }
    dd.rows = dd.rows.slice(0, d.capacity(dd, dd)); box.innerHTML = `<div class="st-scale">${themed(d, d.render(dd), dd)}</div>`;
    const k = box.clientWidth / size.w; box.style.height = Math.round(size.h * k) + "px"; box.firstChild.style.transform = `scale(${k})`;
  }
}
async function exportPng(share) {
  const btn = $(share ? "stShare" : "stDownload"); btn.disabled = true; const old = btn.textContent; btn.textContent = "Drawing…";
  try {
    const { design, data } = await cardData(); data.rows = data.rows.slice(0, design.capacity(data, data));
    const stage = document.createElement("div"); stage.style.cssText = `position:fixed;left:-20000px;top:0;width:${data.w}px;height:${data.h}px`; stage.innerHTML = themed(design, design.render(data), data); document.body.appendChild(stage);
    const [h2c] = await Promise.all([loadHtml2Canvas(), document.fonts ? document.fonts.ready : null]);
    await Promise.all([...stage.querySelectorAll("img")].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })));
    const canvas = await h2c(stage.firstElementChild, { width: data.w, height: data.h, scale: 1, useCORS: true, backgroundColor: null, logging: false });
    stage.remove();
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    const name = `linehunter-${slug(S.fields.title)}-${S.size}.png`;
    const file = new File([blob], name, { type: "image/png" });
    if (share && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: S.fields.title });
    else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  } catch (e) { console.error(e); alert("Couldn't draw the image: " + e.message); }
  btn.disabled = false; btn.textContent = old;
}

// ---------- Controls ----------
function chip(label, on, attrs) { return `<button type="button" class="st-chip${on ? " on" : ""}" ${attrs}>${esc(label)}</button>`; }
function renderControls() {
  $("stSources").innerHTML = S.groups.map((g) => `<div class="st-lbl">${esc(g.label)}</div><div class="st-chips">${g.items.map((i) => chip(i.label, S.source && S.source.id === i.id, `data-src="${i.id}"`)).join("")}</div>`).join("");
  $("stRows").innerHTML = S.rows.map((r, i) => `<div class="st-row"><input type="checkbox" data-row="${i}" ${r.on ? "checked" : ""}><span class="nm">${esc(r.n)} · ${esc(r.stat)}</span><span class="rec">${esc(r.rec)}</span><button class="st-mv" data-up="${i}" title="Move up">▲</button><button class="st-mv" data-down="${i}" title="Move down">▼</button></div>`).join("");
  $("stRowsCount").textContent = S.rows.filter((r) => r.on).length + " of " + S.rows.length + " shown";
  $("stSizes").innerHTML = Object.entries(SIZES).map(([k, v]) => `<button type="button" class="${S.size === k ? "on" : ""}" data-size="${k}">${v.label}</button>`).join("");
  $("stDesigns").innerHTML = STUDIO_DESIGNS.map((d) => `<button type="button" class="st-th${S.design === d.id ? " on" : ""}" data-design="${d.id}"><div class="st-tw" data-thumb="${d.id}"></div>${esc(d.name)}</button>`).join("");
  const ph = allPhotos();
  $("stPhotos").innerHTML = `<button type="button" class="st-ph${S.photoId === "none" ? " on" : ""}" data-photo="none"><span style="padding:30px 5px;text-align:center">No photo</span></button>` +
    ph.map((p) => `<button type="button" class="st-ph${S.photoId === p.id ? " on" : ""}" data-photo="${esc(p.id)}" title="${esc(p.player)} — ${esc(p.credit)}"><img src="${p.url}" alt=""><span>${esc(p.player)}${p.sa ? " · SA" : ""}${p.mine ? " · mine" : ""}</span></button>`).join("");
  const sel = ph.find((p) => p.id === S.photoId);
  $("stPhotoInfo").innerHTML = sel ? `<b>${esc(sel.player)}</b><br><span style="color:var(--st-mut)">${esc(sel.credit)}${sel.sa ? " · share-alike: the edited image has to carry the same license" : ""}</span>` : `<span style="color:var(--st-mut)">No photo on the card.</span>`;
  $("stDelPhoto").hidden = !(sel && sel.mine);
  ["hero", "title", "subtitle", "footer"].forEach((k) => { if ($("stF_" + k) !== document.activeElement) $("stF_" + k).value = S.fields[k] || ""; });
  syncStyleUi();
}
function syncStyleUi() {
  const design = STUDIO_DESIGNS.find((d) => d.id === S.design), st = S.style, t = tokensFor(design);
  const fill = (id, list, cur, def) => { const el = $(id); if (!el.options.length) el.innerHTML = `<option value="">${def} (design)</option>` + list.map((f) => `<option>${f}</option>`).join(""); el.value = cur || ""; };
  fill("stS_fontHead", HEAD_FONTS, st.fontHead, "Clash Display"); fill("stS_fontBody", BODY_FONTS, st.fontBody, "Satoshi");
  ["hero", "title", "rows"].forEach((k) => { $("stS_" + k).value = st[k]; $("stO_" + k).textContent = st[k] + "%"; });
  ["bg", "ink", "accent", "good"].forEach((k) => { if ($("stC_" + k) !== document.activeElement) $("stC_" + k).value = t[k] || t.accent; });
  const hasGood = !!design.tokens.good; $("stC_good").hidden = !hasGood; $("stC_goodLbl").hidden = !hasGood;
  const off = st.off[design.id] || {};
  $("stToggles").innerHTML = Object.entries(design.toggles || {}).map(([k, label]) => `<label class="st-chip${off[k] ? "" : " on"}" style="cursor:pointer"><input type="checkbox" data-tog="${k}" ${off[k] ? "" : "checked"} hidden>${esc(label)}</label>`).join("");
}
let styleRaf = 0;
function styleChanged() { saveStyle(); cancelAnimationFrame(styleRaf); styleRaf = requestAnimationFrame(() => { syncStyleUi(); renderAll(); }); }
function bind() {
  $("stUnlock").onclick = unlock; $("stPass").onkeydown = (e) => { if (e.key === "Enter") unlock(); };
  $("stGen").onclick = generatePass; $("stLockBtn").onclick = () => { try { localStorage.removeItem("lh-studio-ok"); } catch (e) { /* ok */ } setLocked(true); };
  $("stCopyPass").onclick = () => navigator.clipboard && navigator.clipboard.writeText($("stNewPass").textContent);
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-src],[data-row],[data-up],[data-down],[data-size],[data-design],[data-photo]"); if (!t) return;
    if (t.dataset.src) { chooseSource(S.groups.flatMap((g) => g.items).find((i) => i.id === t.dataset.src)); return; }
    if (t.dataset.up != null || t.dataset.down != null) { const i = +(t.dataset.up ?? t.dataset.down), j = t.dataset.up != null ? i - 1 : i + 1; if (j < 0 || j >= S.rows.length) return; [S.rows[i], S.rows[j]] = [S.rows[j], S.rows[i]]; renderControls(); renderAll(); return; }
    if (t.dataset.size) S.size = t.dataset.size;
    if (t.dataset.design) S.design = t.dataset.design;
    if (t.dataset.photo) S.photoId = t.dataset.photo;
    renderControls(); renderAll();
  });
  document.addEventListener("change", (e) => { if (e.target.dataset && e.target.dataset.row != null) { S.rows[+e.target.dataset.row].on = e.target.checked; autoPhotoIfNone(); renderControls(); renderAll(); } });
  ["hero", "title", "subtitle", "footer"].forEach((k) => $("stF_" + k).addEventListener("input", (e) => { S.fields[k] = e.target.value; renderAll(); }));
  $("stS_fontHead").onchange = (e) => { S.style.fontHead = e.target.value; styleChanged(); };
  $("stS_fontBody").onchange = (e) => { S.style.fontBody = e.target.value; styleChanged(); };
  ["hero", "title", "rows"].forEach((k) => $("stS_" + k).addEventListener("input", (e) => { S.style[k] = +e.target.value; styleChanged(); }));
  ["bg", "ink", "accent", "good"].forEach((k) => $("stC_" + k).addEventListener("input", (e) => { (S.style.colors[S.design] = S.style.colors[S.design] || {})[k] = e.target.value; styleChanged(); }));
  $("stToggles").addEventListener("change", (e) => { const k = e.target.dataset.tog; if (!k) return; (S.style.off[S.design] = S.style.off[S.design] || {})[k] = !e.target.checked; styleChanged(); });
  $("stStyleReset").onclick = () => { S.style = { fontHead: "", fontBody: "", hero: 100, title: 100, rows: 100, colors: {}, off: {} }; styleChanged(); };
  $("stDownload").onclick = () => exportPng(false); $("stShare").onclick = () => exportPng(true);
  $("stUpSave").onclick = saveUpload;
  $("stDelPhoto").onclick = async () => { if (S.photoId.startsWith("up:") && confirm("Delete this uploaded photo from this device?")) { await idbDelete(S.photoId.slice(3)); S.uploads = await idbAll(); S.photoId = "none"; renderControls(); renderAll(); } };
  addEventListener("resize", () => renderAll());
}
function autoPhotoIfNone() { if (S.photoId === "none" || S.photoId.startsWith("lib:")) autoPhoto(); }

// ---------- Start ----------
function onSlate(event) {
  const slate = event.detail && event.detail.slate;
  if (!slate) { $("stStatus").textContent = (event.detail && event.detail.message ? "No slate yet. " : "") + "Waiting for tonight's games…"; return; }
  S.slate = slate; S.groups = buildSources(slate);
  if (!S.groups.length) { $("stStatus").textContent = "No cards have enough qualifying props for this slate yet."; return; }
  $("stStatus").hidden = true; $("stApp").hidden = false;
  const keep = S.source && S.groups.flatMap((g) => g.items).find((i) => i.id === S.source.id);
  if (!keep) chooseSource(S.groups[0].items[0]); else { renderControls(); renderAll(); }
}
let started = false;
async function startStudio() {
  if (started) return; started = true; bind2();
  await loadPhotos();
  document.addEventListener("lh-top-slate", onSlate);
  if (window.__lhPendingSlate) onSlate(window.__lhPendingSlate);
}
function bind2() { /* controls are bound once at load */ }
document.addEventListener("lh-top-slate", (e) => { window.__lhPendingSlate = e; });
addEventListener("DOMContentLoaded", async () => {
  loadStyle(); bind();
  let ok = false; try { ok = localStorage.getItem("lh-studio-ok") === window.STUDIO_PASS_HASH; } catch (e) { /* ok */ }
  if (ok) { setLocked(false); startStudio(); } else setLocked(true);
});
