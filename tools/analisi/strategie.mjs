/**
 * Sei modi di fare l'asta, allo stesso tavolo, per migliaia di stagioni.
 *
 *     node tools/analisi/strategie.mjs --leghe 3000
 *
 * L'analisi sulle correlazioni dice cosa si accompagna a un punteggio
 * alto, ma non dice chi vince: le rose li' erano generate da parametri a
 * caso, e molti di quei manager finti lasciavano mezzo budget in tasca.
 * Nessuno gioca cosi'.
 *
 * Qui invece ogni strategia ha un nome, un piano di spesa che consuma
 * tutti i 500 crediti, e siede allo stesso tavolo delle altre. Si
 * contendono gli stessi giocatori: se due vogliono lo stesso fuoriclasse,
 * uno resta a mani vuote, ed e' esattamente il vincolo che decide.
 *
 * Il posto a tavola cambia a ogni lega, perche' nella serpentina scegliere
 * per primi e' un vantaggio e non deve regalarlo sempre allo stesso.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreMatchday } from "../../js/scoring.js";

const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const arg = (n, pre) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : pre;
};
const LEGHE = Number(arg("leghe", 3000));
const GIORNATE = Number(arg("giornate", 10));
const BUDGET = Number(arg("budget", 500));
const ROSA = Number(arg("rosa", 8));
const TITOLARI = Number(arg("titolari", 5));

function generatore(seme) {
  let s = seme >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const rnd = generatore(Number(arg("seme", 777)));
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
  return { standings, imprese, h2h: ev.h2h || [],
           total: ev.total || standings.size, rounds: ev.rounds || 11 };
}).filter((t) => t.standings.size);

/* ------------------------------ le strategie ---------------------------- */

/**
 * `quote` = come spartire i 500 crediti fra gli otto acquisti, dal primo
 * all'ultimo. `valore` = con che occhio si guarda un giocatore.
 *
 * Tutte spendono tutto: la differenza sta in COME, non in QUANTO.
 */
const STRATEGIE = [
  {
    nome: "Stelle e scarti",
    nota: "tutto su due fuoriclasse, il resto a un credito",
    quote: [0.34, 0.26, 0.16, 0.10, 0.06, 0.03, 0.03, 0.02],
    valore: (p) => p.expected,
  },
  {
    nome: "Un solo fenomeno",
    nota: "un unico nome grosso, poi onesti mestieranti",
    quote: [0.40, 0.14, 0.12, 0.10, 0.09, 0.06, 0.05, 0.04],
    valore: (p) => p.expected,
  },
  {
    nome: "Equilibrata",
    nota: "otto giocatori dello stesso livello",
    quote: [0.125, 0.125, 0.125, 0.125, 0.125, 0.125, 0.125, 0.125],
    valore: (p) => p.expected,
  },
  {
    nome: "Presenzialisti",
    nota: "chi non salta mai un martedi', costi quel che costi",
    quote: [0.20, 0.18, 0.16, 0.14, 0.12, 0.08, 0.07, 0.05],
    valore: (p) => p.presence,
  },
  {
    nome: "Solo rating",
    nota: "i piu' forti sulla carta, presenza ignorata",
    quote: [0.30, 0.22, 0.16, 0.12, 0.09, 0.05, 0.04, 0.02],
    valore: (p) => p.rating,
  },
  {
    nome: "Massimo atteso",
    nota: "il rendimento atteso piu' alto possibile, senza piano di spesa",
    // Nessuna quota: prende sempre il miglior atteso che puo' permettersi
    // tenendo da parte il minimo per riempire le caselle che restano.
    avido: true,
    quote: [0.2, 0.2, 0.15, 0.15, 0.1, 0.08, 0.07, 0.05],
    valore: (p) => p.expected,
  },
  {
    nome: "Cinque e basta",
    nota: "tutto sui cinque titolari, panchina a un credito",
    // Solo cinque giocatori fanno punti: gli altri tre servono a coprire
    // le assenze. Questa strategia porta l'idea alle estreme conseguenze.
    quote: [0.26, 0.23, 0.20, 0.16, 0.13, 0.007, 0.007, 0.006],
    valore: (p) => p.expected,
  },
  {
    nome: "Affaristi",
    nota: "il miglior rendimento per credito speso",
    quote: [0.20, 0.18, 0.16, 0.14, 0.12, 0.08, 0.07, 0.05],
    valore: (p) => (p.expected || 0) / Math.max(1, p.price),
  },
];

/* --------------------------------- l'asta -------------------------------- */

function asta(seduti) {
  const rose = seduti.map(() => []);
  const speso = seduti.map(() => 0);
  const presi = new Set();

  for (let giro = 0; giro < ROSA; giro++) {
    const ordine = giro % 2 === 0
      ? seduti.map((_, i) => i)
      : seduti.map((_, i) => i).reverse();

    for (const m of ordine) {
      const s = seduti[m];
      const restano = ROSA - rose[m].length;
      const tetto = BUDGET - speso[m] - (restano - 1);

      // Quanto mettere su QUESTO acquisto: la quota del piano, ma calcolata
      // sui crediti ANCORA IN MANO invece che sui 500 iniziali.
      //
      // La differenza non e' un dettaglio: con la quota fissa, chi non
      // trovava un giocatore abbastanza caro per il suo scaglione si
      // portava dietro l'avanzo fino alla fine e chiudeva l'asta con mezzo
      // budget intatto. Cosi' invece ogni credito risparmiato torna
      // disponibile per gli acquisti dopo, e tutte le strategie arrivano a
      // spendere quello che hanno. Altrimenti il confronto misura chi
      // spende, non come.
      const liberi = GIOCATORI.filter((p) => !presi.has(p.id));
      if (!liberi.length) continue;

      let previsto;
      if (s.avido) {
        // Spende il massimo possibile lasciando da parte solo quanto basta
        // a riempire le caselle vuote coi piu' economici rimasti.
        const economici = [...liberi].sort((a, b) => (a.price || 0) - (b.price || 0));
        const riserva = economici.slice(0, restano - 1)
          .reduce((t, p) => t + Math.round((p.price || 1) * 0.85), 0);
        previsto = Math.max(1, Math.min(tetto, BUDGET - speso[m] - riserva));
      } else {
        const quoteRestanti = s.quote.slice(giro).reduce((a, b) => a + b, 0);
        previsto = Math.min(tetto, Math.max(1,
          Math.round((BUDGET - speso[m]) * (s.quote[giro] / quoteRestanti))));
      }

      // Il migliore secondo il suo criterio, fra quelli che rientrano nel
      // budget del giro. Se non ce ne sono, il piu' economico rimasto.
      const dentro = liberi.filter((p) => p.price <= previsto);
      const scelto = (dentro.length ? dentro : liberi)
        .reduce((a, b) => {
          if (!dentro.length) return (a.price || 0) <= (b.price || 0) ? a : b;
          return (s.valore(a) || 0) >= (s.valore(b) || 0) ? a : b;
        });

      const pagato = Math.max(1, Math.min(tetto, Math.round((scelto.price || 1) * 0.85)));
      presi.add(scelto.id);
      rose[m].push({ id: scelto.id, pagato, p: scelto });
      speso[m] += pagato;
    }
  }
  return { rose, speso };
}

/* ------------------------------- la stagione ----------------------------- */

function formazione(rosa) {
  const ord = [...rosa].sort((a, b) => b.pagato - a.pagato);
  const ids = ord.map((r) => r.id);
  return { starters: ids.slice(0, TITOLARI), bench: ids.slice(TITOLARI), captain: ids[0] };
}

function risultatiPerRosa(t, posseduti) {
  const out = new Map();
  for (const pid of posseduti) {
    const s = t.standings.get(pid);
    out.set(pid, s
      ? { played: true, points: s.points, rank: s.rank, total: t.total,
          upsets: t.imprese.get(pid) || [] }
      : { played: false, points: 0, rank: null, total: t.total });
  }
  return out;
}

/* --------------------------------- il giro ------------------------------- */

const stat = STRATEGIE.map((s) => ({
  nome: s.nome, nota: s.nota, punti: [], vittorie: 0, posizioni: [], spesa: [],
}));

console.log(`${LEGHE} leghe, ${STRATEGIE.length} strategie allo stesso tavolo, `
  + `${GIORNATE} giornate su ${TORNEI.length} tornei veri.\n`);

for (let l = 0; l < LEGHE; l++) {
  // Posti a sedere rimescolati: nella serpentina il primo ha un vantaggio.
  const posti = STRATEGIE.map((s, i) => ({ s, i }));
  for (let k = posti.length - 1; k > 0; k--) {
    const j = Math.floor(rnd() * (k + 1));
    [posti[k], posti[j]] = [posti[j], posti[k]];
  }

  const { rose, speso } = asta(posti.map((p) => p.s));
  const lineups = new Map();
  rose.forEach((r, i) => lineups.set(String(i), formazione(r)));
  const posseduti = rose.flat().map((r) => r.id);

  const totali = rose.map(() => 0);
  for (let g = 0; g < GIORNATE; g++) {
    const t = scegli(TORNEI);
    const esiti = scoreMatchday(lineups, risultatiPerRosa(t, posseduti), t.h2h,
      undefined, t.rounds);
    rose.forEach((_, i) => { totali[i] += esiti.get(String(i))?.total || 0; });
  }

  const classifica = totali.map((t, i) => ({ t, i })).sort((a, b) => b.t - a.t);
  classifica.forEach((c, pos) => {
    const orig = posti[c.i].i;
    stat[orig].punti.push(c.t);
    stat[orig].posizioni.push(pos + 1);
    stat[orig].spesa.push(speso[c.i]);
    if (pos === 0) stat[orig].vittorie++;
  });
}

/* -------------------------------- risultati ------------------------------ */

const media = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const dev = (a) => {
  const m = media(a);
  return Math.sqrt(media(a.map((v) => (v - m) ** 2)));
};

stat.sort((a, b) => b.vittorie - a.vittorie);
const largh = Math.max(...stat.map((s) => s.nome.length));

console.log(`${"strategia".padEnd(largh)}  ${"vittorie".padStart(9)}  `
  + `${"punti".padStart(7)}  ${"±".padStart(5)}  ${"pos.media".padStart(9)}  spesa`);
console.log("-".repeat(largh + 48));
for (const s of stat) {
  const perc = (s.vittorie / LEGHE * 100).toFixed(1);
  console.log(
    `${s.nome.padEnd(largh)}  ${(perc + "%").padStart(9)}  `
    + `${media(s.punti).toFixed(0).padStart(7)}  ${dev(s.punti).toFixed(0).padStart(5)}  `
    + `${media(s.posizioni).toFixed(2).padStart(9)}  ${media(s.spesa).toFixed(0)}`);
}
console.log(`\n(a caso sarebbe ${(100 / STRATEGIE.length).toFixed(1)}% di vittorie `
  + `e posizione media ${((STRATEGIE.length + 1) / 2).toFixed(2)})`);
console.log("\nCosa guarda ciascuna:");
for (const s of stat) console.log(`  ${s.nome.padEnd(largh)}  ${s.nota}`);
