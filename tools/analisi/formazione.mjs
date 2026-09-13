/**
 * A parita' di rosa, quanto conta COME la schieri?
 *
 *     node tools/analisi/formazione.mjs --rose 3000
 *
 * L'asta si fa una volta, la formazione ogni martedi'. Quindi anche un
 * vantaggio piccolo qui vale piu' di uno grosso li', perche' si ripete
 * dieci volte a stagione.
 *
 * Il confronto e' pulito: la STESSA rosa gioca la STESSA stagione con
 * criteri diversi di scelta. Tutto quello che cambia e' chi va in campo e
 * chi porta la fascia, quindi ogni differenza nei punti viene da li'.
 *
 * Le due domande:
 *  - i cinque titolari: i piu' pagati (predefinito dell'app) o quelli con
 *    il rendimento atteso piu' alto?
 *  - il capitano, che raddoppia ma solo se gioca davvero: il piu' pagato,
 *    il piu' presente, o il miglior atteso?
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreLineup } from "../../js/scoring.js";

const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (n, pre) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : pre;
};
const ROSE = Number(arg("rose", 3000));
const GIORNATE = Number(arg("giornate", 10));
const BUDGET = Number(arg("budget", 500));
const N_ROSA = Number(arg("rosa", 8));
const N_TIT = Number(arg("titolari", 5));

function generatore(seme) {
  let s = seme >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296; };
}
const rnd = generatore(Number(arg("seme", 4242)));
const scegli = (a) => a[Math.floor(rnd() * a.length)];

/* --------------------------------- dati --------------------------------- */

const listone = JSON.parse(readFileSync(join(RADICE, "data", "listone.json"), "utf8"));
const indice = JSON.parse(readFileSync(join(RADICE, "data", "tt", "index.json"), "utf8"));
const GIOCATORI = listone.players.filter((p) => p.price > 0);

const TORNEI = (indice.events || []).map((e) => {
  const ev = JSON.parse(readFileSync(join(RADICE, "data", "tt", `${e.id}.json`), "utf8"));
  const standings = new Map(Object.entries(ev.standings || {})
    .map(([u, [p, r]]) => [u, { points: p, rank: r }]));
  const imprese = new Map();
  for (const [u, gap] of ev.upsets || []) {
    if (!imprese.has(u)) imprese.set(u, []);
    imprese.get(u).push(gap);
  }
  return { standings, imprese, total: ev.total || standings.size, rounds: ev.rounds || 11 };
}).filter((t) => t.standings.size);

/* ------------------------ una rosa plausibile a caso --------------------- */

/**
 * Rose costruite come le costruirebbe qualcuno che gioca sul serio: si
 * spende quasi tutto, con una concentrazione variabile fra "spalmata" e
 * "due fuoriclasse e via". Cosi' il confronto fra criteri di schieramento
 * non vale solo per un tipo di rosa.
 */
function rosaACaso() {
  const conc = 0.6 + rnd() * 1.9;              // quanto e' sbilanciata
  const grezze = Array.from({ length: N_ROSA }, (_, i) => (N_ROSA - i) ** conc);
  const somma = grezze.reduce((a, b) => a + b, 0);
  const quote = grezze.map((q) => q / somma);

  const rosa = [];
  const presi = new Set();
  let speso = 0;
  for (let i = 0; i < N_ROSA; i++) {
    const restano = N_ROSA - i;
    const tetto = BUDGET - speso - (restano - 1);
    const obiettivo = Math.min(tetto, Math.max(1, Math.round(BUDGET * quote[i])));
    const dentro = GIOCATORI.filter((p) => !presi.has(p.id) && p.price <= obiettivo);
    const pool = dentro.length
      ? dentro
      : GIOCATORI.filter((p) => !presi.has(p.id))
          .sort((a, b) => a.price - b.price).slice(0, 5);
    if (!pool.length) return null;
    // Fra quelli nel budget, uno dei migliori per atteso, con un po' di caso.
    const cima = [...pool].sort((a, b) => (b.expected || 0) - (a.expected || 0))
      .slice(0, 6);
    const p = scegli(cima);
    const pagato = Math.max(1, Math.min(tetto, Math.round((p.price || 1) * 0.85)));
    presi.add(p.id);
    rosa.push({ id: p.id, pagato, p });
    speso += pagato;
  }
  return rosa;
}

/* ------------------------------ i criteri -------------------------------- */

const ORDINA = {
  "piu pagati": (r) => [...r].sort((a, b) => b.pagato - a.pagato),
  "miglior atteso": (r) => [...r].sort((a, b) => (b.p.expected || 0) - (a.p.expected || 0)),
};

const CAPITANO = {
  "piu pagato": (tit) => tit.reduce((a, b) => (a.pagato >= b.pagato ? a : b)),
  "piu presente": (tit) => tit.reduce((a, b) =>
    ((a.p.presence || 0) >= (b.p.presence || 0) ? a : b)),
  "miglior atteso": (tit) => tit.reduce((a, b) =>
    ((a.p.expected || 0) >= (b.p.expected || 0) ? a : b)),
};

const COMBINAZIONI = [];
for (const [nt, ordina] of Object.entries(ORDINA)) {
  for (const [nc, cap] of Object.entries(CAPITANO)) {
    COMBINAZIONI.push({ nome: `titolari: ${nt}  ·  capitano: ${nc}`, ordina, cap });
  }
}

function risultati(t, ids) {
  const out = new Map();
  for (const pid of ids) {
    const s = t.standings.get(pid);
    out.set(pid, s
      ? { played: true, points: s.points, rank: s.rank, total: t.total,
          upsets: t.imprese.get(pid) || [] }
      : { played: false, points: 0, rank: null, total: t.total });
  }
  return out;
}

/* --------------------------------- il giro ------------------------------- */

console.log(`${ROSE} rose, ognuna gioca la stessa stagione da ${GIORNATE} `
  + `giornate con ${COMBINAZIONI.length} criteri diversi.\n`);

const totali = COMBINAZIONI.map(() => []);

for (let n = 0; n < ROSE; n++) {
  const rosa = rosaACaso();
  if (!rosa) continue;
  const ids = rosa.map((r) => r.id);

  // La stessa sequenza di tornei per tutti i criteri: l'unica differenza
  // deve essere la formazione, non la fortuna del sorteggio.
  const stagione = Array.from({ length: GIORNATE }, () => scegli(TORNEI));

  COMBINAZIONI.forEach((c, k) => {
    const ord = c.ordina(rosa);
    const tit = ord.slice(0, N_TIT);
    const lu = {
      starters: tit.map((r) => r.id),
      bench: ord.slice(N_TIT).map((r) => r.id),
      captain: c.cap(tit).id,
    };
    let tot = 0;
    for (const t of stagione) {
      tot += scoreLineup(lu, risultati(t, ids), undefined, t.rounds).total;
    }
    totali[k].push(tot);
  });

  if ((n + 1) % 1000 === 0) console.log(`  ${n + 1}/${ROSE}`);
}

const media = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const base = media(totali[0]);   // il predefinito dell'app

const out = COMBINAZIONI.map((c, k) => ({
  nome: c.nome, m: media(totali[k]), diff: media(totali[k]) - base,
})).sort((a, b) => b.m - a.m);

const largh = Math.max(...out.map((o) => o.nome.length));
console.log(`\n${"criterio".padEnd(largh)}  ${"punti".padStart(7)}  scarto dal predefinito`);
console.log("-".repeat(largh + 34));
for (const o of out) {
  const seg = o.diff === 0 ? "  (predefinito dell'app)" : `${o.diff >= 0 ? "+" : ""}${o.diff.toFixed(0)}`;
  console.log(`${o.nome.padEnd(largh)}  ${o.m.toFixed(0).padStart(7)}  ${seg}`);
}
