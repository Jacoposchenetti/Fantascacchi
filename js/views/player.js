/* ---------------------------------------------------------------
   Scheda giocatore in sovrimpressione.

   Due grafici, entrambi costruiti dallo storico dei Titled Tuesday che
   il generatore salva nel listone:

   - il rendimento torneo per torneo, con le ASSENZE visibili come
     tacche vuote. Un grafico che mostrasse solo i tornei giocati
     nasconderebbe esattamente la variabile piu' importante.
   - il rating blitz nel tempo, ricavato dai rating letti nelle partite
     dei tornei: chess.com non pubblica lo storico dei rating, ma dentro
     ogni torneo il rating del momento c'e'.

   Le statistiche per formato (bullet/blitz/rapid) arrivano invece live
   da chess.com, in una sola richiesta messa in cache.
   --------------------------------------------------------------- */

import { el, modal, flag, spinner, presenceClass } from "../ui.js";
import { fetchStats } from "../chesscom.js";
import { ownerOf, memberName } from "../league.js";

const SVGNS = "http://www.w3.org/2000/svg";

/** Apre la scheda. `extra` puo' aggiungere azioni contestuali (es. chiamare all'asta). */
export function showPlayer(ctx, player, extra = null) {
  if (!player) return;

  modal((close) => {
    const statsBox = el("div.pc-stats", spinner());

    fetchStats(player.id)
      .then((s) => statsBox.replaceChildren(formatGrid(s), profileLink(s)))
      .catch(() => statsBox.replaceChildren(
        el("p.small.mute-2", { style: "margin:0" },
          "Statistiche live non raggiungibili in questo momento.")));

    return el("div.pc",
      header(ctx, player, close),
      el("div.pc-body",
        fantasyRow(ctx, player),
        statsBox,
        player.history?.length
          ? el("div.stack",
              chartBlock("Rendimento nei Titled Tuesday",
                `${player.events} tornei giocati su ${player.window}`,
                pointsChart(player, ctx.catalog.meta)),
              chartBlock("Rating blitz nel tempo",
                "rilevato dentro i tornei, uno a settimana",
                ratingChart(player)),
            )
          : el("p.small.mute-2",
              "Nessuno storico: questo giocatore è stato aggiunto a mano e non "
              + "è passato dall'aggregazione dei tornei."),
        extra,
      ),
    );
  }, { wide: true });
}

/* -------------------------------- testata ------------------------------ */

function header(ctx, p, close) {
  return el("div.pc-head",
    p.avatar
      ? el("img.pc-av", { src: p.avatar, alt: "", loading: "lazy" })
      : el("div.pc-av", { style: "display:grid;place-items:center;font-size:1.6rem" }, "♟"),
    el("div", { style: "min-width:0" },
      el("div.pc-name",
        p.title && el("span.title-tag", { class: p.title.toLowerCase() }, p.title),
        el("span", p.name)),
      el("div.pc-sub",
        flag(p.country), " ", el("span.mono", p.username)),
    ),
    el("button.pc-close", {
      type: "button", onclick: close, "aria-label": "Chiudi la scheda",
      title: "Chiudi",
    }, "✕"),
  );
}

/* ------------------------------ dati da lega --------------------------- */

function fantasyRow(ctx, p) {
  const owner = ctx.league ? ownerOf(ctx.league, p.id) : null;
  const paid = owner ? ctx.league.roster[p.id].price : null;

  return el("div.pc-facts",
    fact("Valutazione", `${p.price}`, "crediti"),
    p.avgPoints !== undefined && fact("Quando gioca", `${p.avgPoints}`, "su 11"),
    p.window && fact("Presenze", `${p.events}/${p.window}`,
      `${Math.round(p.presence * 100)}%`, presenceClass(p)),
    p.expected !== undefined && fact("Atteso", `${p.expected}`, "a giornata"),
    p.bestPlacement && p.bestPlacement < 9999
      && fact("Miglior piazz.", `${p.bestPlacement}°`, "in 6 mesi"),
    owner && fact("In rosa a", memberName(ctx.league, owner), `pagato ${paid}`),
  );
}

function fact(label, value, note, cls = "") {
  return el("div.pc-fact",
    el("span.pc-fact-l", label),
    el("span.pc-fact-v", { class: cls }, value),
    note && el("span.pc-fact-n", note),
  );
}

/* --------------------------- statistiche live -------------------------- */

const FORMAT_LABELS = { bullet: "Bullet", blitz: "Blitz", rapid: "Rapid", daily: "Daily" };

function formatGrid(s) {
  const cards = Object.entries(s.formats)
    .filter(([, v]) => v)
    .map(([k, v]) => el("div.pc-fmt",
      el("span.pc-fmt-l", FORMAT_LABELS[k] || k),
      el("span.pc-fmt-r", String(v.rating)),
      v.best && el("span.pc-fmt-b", `max ${v.best}`),
      el("div.pc-wdl",
        el("i.wdl-w", { style: `flex:${v.win || 0}` }),
        el("i.wdl-d", { style: `flex:${v.draw || 0}` }),
        el("i.wdl-l", { style: `flex:${v.loss || 0}` })),
      el("span.pc-fmt-n",
        v.winRate !== null ? `${v.winRate}% vinte su ${v.played.toLocaleString("it-IT")}` : ""),
    ));

  if (!cards.length) {
    return el("p.small.mute-2", { style: "margin:0" }, "Nessuna statistica pubblica.");
  }
  return el("div", el("h4.pc-h", "Rating attuali"), el("div.pc-fmts", cards));
}

function profileLink(s) {
  return el("div.pc-links",
    s.fide && el("span.small.mute-2", `FIDE ${s.fide}`),
    s.tactics && el("span.small.mute-2", `Tattica ${s.tactics}`),
    el("a.small", { href: s.url, target: "_blank", rel: "noopener noreferrer" },
      "Profilo su chess.com ↗"),
  );
}

/* -------------------------------- grafici ------------------------------ */

function chartBlock(title, sub, svg) {
  return el("div.pc-chart",
    el("div.pc-chart-h", el("h4.pc-h", title), el("span.small.mute-2", sub)),
    el("div.pc-chart-b", svg),
  );
}

const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  return n;
};

/**
 * Punti per torneo. Ogni tacca dell'asse e' un Titled Tuesday della finestra:
 * dove non ha giocato resta il posto vuoto, che e' il punto del grafico.
 */
function pointsChart(p, meta) {
  const events = [...(meta.events || [])].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map((p.history || []).map((h) => [h.d, h]));

  const W = 520, H = 138, padL = 28, padR = 8, padT = 10, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = Math.max(events.length, 1);
  const slot = plotW / n;
  const barW = Math.max(3, Math.min(14, slot * 0.62));
  const maxPts = 11;
  const y = (v) => padT + plotH - (v / maxPts) * plotH;

  const root = svg("svg", {
    viewBox: `0 0 ${W} ${H}`, class: "chart",
    role: "img", "aria-label":
      `Punti nei Titled Tuesday: ${p.events} presenze su ${events.length}`,
  });

  // Griglia: 0, 5.5 e 11 bastano a dare la scala senza sporcare.
  for (const v of [0, 5.5, 11]) {
    root.append(svg("line", {
      x1: padL, x2: W - padR, y1: y(v), y2: y(v),
      class: v === 0 ? "grid grid-base" : "grid",
    }));
    const t = svg("text", { x: padL - 6, y: y(v) + 4, class: "axis", "text-anchor": "end" });
    t.textContent = String(v);
    root.append(t);
  }

  const best = Math.max(0, ...(p.history || []).map((h) => h.p));

  events.forEach((ev, i) => {
    const cx = padL + slot * i + slot / 2;
    const h = byDate.get(ev.date);
    if (!h) {
      // Assenza: una tacca vuota sulla base, visibile ma silenziosa.
      root.append(svg("line", {
        x1: cx, x2: cx, y1: y(0), y2: y(0) - 4, class: "absent",
      }));
      return;
    }
    const top = y(h.p);
    const bar = svg("rect", {
      x: cx - barW / 2, y: top, width: barW, height: Math.max(1, y(0) - top),
      rx: 1.5, class: h.p === best ? "bar bar-best" : "bar",
    });
    // append() restituisce undefined: il nodo va costruito prima.
    const tip = svg("title");
    tip.textContent = `${itDate(ev.date)} — ${h.p}/11, ${h.r}° posto`;
    bar.append(tip);
    root.append(bar);
  });

  // Estremi dell'asse temporale, per capire la finestra.
  if (events.length) {
    const a = svg("text", { x: padL, y: H - 5, class: "axis" });
    a.textContent = itDate(events[0].date);
    const b = svg("text", { x: W - padR, y: H - 5, class: "axis", "text-anchor": "end" });
    b.textContent = itDate(events[events.length - 1].date);
    root.append(a, b);
  }
  return root;
}

/** Rating blitz rilevato dentro i tornei, dal piu' vecchio al piu' recente. */
function ratingChart(p) {
  const pts = (p.history || []).filter((h) => h.e);
  const W = 520, H = 116, padL = 40, padR = 8, padT = 12, padB = 18;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const root = svg("svg", {
    viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img",
    "aria-label": "Andamento del rating blitz",
  });

  if (pts.length < 2) {
    const t = svg("text", { x: W / 2, y: H / 2, class: "axis", "text-anchor": "middle" });
    t.textContent = "Dati insufficienti per una curva";
    root.append(t);
    return root;
  }

  const vals = pts.map((h) => h.e);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 40) { const m = (hi + lo) / 2; lo = m - 20; hi = m + 20; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;

  const x = (i) => padL + (i / (pts.length - 1)) * plotW;
  const y = (v) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;

  for (const v of [hi - pad, lo + pad]) {
    root.append(svg("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: "grid" }));
    const t = svg("text", { x: padL - 6, y: y(v) + 4, class: "axis", "text-anchor": "end" });
    t.textContent = String(Math.round(v));
    root.append(t);
  }

  const d = pts.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(h.e).toFixed(1)}`).join(" ");
  root.append(svg("path", {
    d: `${d} L${x(pts.length - 1).toFixed(1)},${padT + plotH} L${padL},${padT + plotH} Z`,
    class: "area",
  }));
  root.append(svg("path", { d, class: "line" }));

  // Solo l'ultimo punto marcato: e' quello che interessa davvero.
  const last = pts[pts.length - 1];
  root.append(svg("circle", { cx: x(pts.length - 1), cy: y(last.e), r: 3.2, class: "dot" }));
  const lab = svg("text", {
    x: x(pts.length - 1) - 6, y: y(last.e) - 7, class: "axis dot-label", "text-anchor": "end",
  });
  lab.textContent = String(last.e);
  root.append(lab);

  return root;
}

function itDate(iso) {
  const [y, m, d] = iso.split("-");
  const mesi = ["gen", "feb", "mar", "apr", "mag", "giu",
    "lug", "ago", "set", "ott", "nov", "dic"];
  return `${Number(d)} ${mesi[Number(m) - 1]}`;
}
