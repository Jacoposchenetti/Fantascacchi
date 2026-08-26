/* Helper DOM minimi: niente framework, niente build step. */

/**
 * Crea un elemento.
 *   el('div.card', {onclick: f}, 'testo', el('b', 'altro'))
 * Il tag accetta la sintassi CSS: 'button.btn.btn-primary'
 */
export function el(spec, ...rest) {
  const [tag, ...classes] = String(spec).split(".");
  const node = document.createElement(tag || "div");
  if (classes.length) node.className = classes.join(" ");

  let children = rest;
  const first = rest[0];
  const isProps = first && typeof first === "object"
    && !(first instanceof Node) && !Array.isArray(first);
  if (isProps) {
    children = rest.slice(1);
    for (const [k, v] of Object.entries(first)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className += " " + v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k in node && k !== "list" && k !== "type") {
        node[k] = v;
      } else {
        node.setAttribute(k, v === true ? "" : v);
      }
    }
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === "") continue;
    if (Array.isArray(c)) append(node, c);
    else node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

/** Svuota un nodo e ci mette dentro i figli passati. */
export function render(root, ...children) {
  root.replaceChildren();
  append(root, children);
  return root;
}

export function toast(msg, kind = "") {
  const box = $("#toasts");
  const t = el("div.toast" + (kind ? "." + kind : ""), msg);
  box.append(t);
  setTimeout(() => {
    t.style.transition = "opacity .25s";
    t.style.opacity = "0";
    setTimeout(() => t.remove(), 250);
  }, kind === "err" ? 5200 : 3000);
}

/** Modale. `build(close)` restituisce il contenuto. */
export function modal(build) {
  const dlg = $("#modal");
  const body = $("#modal-body");
  const close = () => dlg.close();
  render(body, build(close));
  dlg.showModal();
  return close;
}

export function confirmDialog(title, text, okLabel = "Conferma") {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { answered = true; resolve(v); };
    const dlg = $("#modal");
    const onClose = () => {
      dlg.removeEventListener("close", onClose);
      if (!answered) resolve(false);
    };
    dlg.addEventListener("close", onClose);
    modal((close) => el("div.stack",
      el("h2", title),
      text && el("p.muted.small", text),
      el("div.row", { style: "justify-content:flex-end" },
        el("button.btn.btn-ghost", { onclick: () => { done(false); close(); } }, "Annulla"),
        el("button.btn.btn-primary", { onclick: () => { done(true); close(); } }, okLabel),
      ),
    ));
  });
}

export function spinner() { return el("div.spinner", { role: "status", "aria-label": "Caricamento" }); }

export function empty(icon, text, extra) {
  return el("div.empty", el("span.big", icon), el("div", text), extra);
}

/**
 * Bandierina dal codice paese di chess.com.
 * Attenzione: chess.com usa anche pseudo-codici che iniziano per X
 * (XX internazionale, XE Inghilterra, XS Scozia, XW Galles, XO altro):
 * passati alla formula dei regional indicator darebbero bandiere inesistenti.
 */
const PSEUDO = { XE: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", XS: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", XW: "🏴󠁧󠁢󠁷󠁬󠁳󠁿", XX: "🌍", XO: "🌍", XB: "🌍", XK: "🌍" };

export function flag(code) {
  if (!code || code.length !== 2) return "";
  const up = code.toUpperCase();
  if (up in PSEUDO) return PSEUDO[up];
  if (up[0] === "X") return "🌍";
  return String.fromCodePoint(
    ...[...up].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

export const fmtPts = (n) =>
  (n > 0 ? "+" : "") + (Math.round(n * 10) / 10).toString();

export function ptsClass(n) {
  return n > 0 ? "pts-pos" : n < 0 ? "pts-neg" : "muted";
}

/** Copia negli appunti con fallback per i browser senza permesso. */
export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copiato negli appunti", "ok");
  } catch {
    const ta = el("textarea", { value: text, style: "position:fixed;opacity:0" });
    document.body.append(ta);
    ta.select();
    try { document.execCommand("copy"); toast("Copiato", "ok"); }
    catch { toast("Copia manualmente: " + text, "err"); }
    ta.remove();
  }
}

/** Id breve leggibile, senza caratteri ambigui. */
export function shortId(len = 6) {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const buf = crypto.getRandomValues(new Uint8Array(len));
  return [...buf].map((b) => abc[b % abc.length]).join("");
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
