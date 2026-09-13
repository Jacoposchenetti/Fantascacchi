/**
 * Simula migliaia di leghe intere e scrive un CSV: una riga per rosa, con
 * le sue caratteristiche e i punti che ha fatto.
 *
 *     node tools/analisi/simula.mjs --leghe 4000 --out rose.csv
 *
 * Perche' simulare invece di imparare da dati veri: dati veri non ce ne
 * sono. Nessuna lega ha ancora finito una stagione, quindi non esiste
 * nessun "questa rosa ha vinto" da cui imparare. Quello che esiste sono i
 * risultati VERI dei Titled Tuesday archiviati, e il motore di punteggio
 * vero dell'app. Con quei due si possono far giocare stagioni finte a
 * rose vere, e su quelle poi si cerca cosa conta.
 *
 * Tre scelte che tengono in piedi il realismo:
 *
 * 1. I punti li calcola `js/scoring.js`, non una mia riscrittura. Se il
 *    regolamento cambia, cambia anche la simulazione.
 *
 * 2. Una giornata simulata e' UN TORNEO VERO pescato dall'archivio, intero.
 *    Non si campionano i singoli giocatori: chi si e' presentato quella
 *    sera si e' presentato insieme, e gli scontri diretti sono quelli
 *    successi davvero. Le assenze sono correlate, e quella correlazione e'
 *    mezza partita.
 *
 * 3. Le rose non sono indipendenti: dentro una lega ogni scacchista e' di
 *    uno solo, e i crediti sono 500 per tutti. Chi punta tutto su un
 *    fuoriclasse lascia gli avanzi agli altri, ed e' proprio il compromesso
 *    che si vuole misurare.
 *
 * Limite da tenere presente: i tornei distinti in archivio sono 13, quindi
 * una stagione da 10 giornate ne ripesca qualcuno. La presenza di ciascun
 * giocatore e' esattamente quella storica, non una stima.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreMatchday } from "../../js/scoring.js";

const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/* ------------------------------ argomenti ------------------------------- */

const arg = (nome, pre) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 ? process.argv[i + 1] : pre;
};
const LEGHE = Number(arg("leghe", 4000));
const MANAGER = Number(arg("manager", 8));
const GIORNATE = Number(arg("giornate", 10));
const BUDGET = Number(arg("budget", 500));
const ROSA = Number(arg("rosa", 8));
const TITOLARI = Number(arg("titolari", 5));
const OUT = arg("out", join(RADICE, "tools", "analisi", "rose.csv"));
const SEME = Number(arg("seme", 12345));

/* ------------------------------- casualita' ----------------------------- */

/** Ripetibile: due esecuzioni con lo stesso seme danno lo stesso CSV. */
function generatore(seme) {
  let s = seme >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const rnd = generatore(SEME);
const fra = (a, b) => a + rnd() * (b - a);
const scegli = (arr) => arr[Math.floor(rnd() * arr.length)];

/* --------------------------------- dati --------------------------------- */

const listone = JSON.parse(
  readFileSync(join(RADICE, "data", "listone.json"), "utf8"));
const indice = JSON.parse(
  readFileSync(join(RADICE, "data", "tt", "index.json"), "utf8"));

const GIOCATORI = listone.players.filter((p) => p.price > 0);
const PER_ID = new Map(GIOCATORI.map((p) => [p.id, p]));

const TORNEI = (indice.events || []).map((e) => {
  const ev = JSON.parse(
    readFileSync(join(RADICE, "data", "tt", `${e.id}.json`), "utf8"));
  const standings = new Map(
    Object.entries(ev.standings || {}).map(([u, [p, r]]) => [u, { points: p, rank: r }]));
  const imprese = new Map();
  for (const [u, gap] of ev.upsets || []) {
    if (!imprese.has(u)) imprese.set(u, []);
    imprese.get(u).push(gap);
  }
  return { date: ev.date, standings, imprese, h2h: ev.h2h || [],
           total: ev.total || standings.size, rounds: ev.rounds || 11 };
}).filter((t) => t.standings.size);

/* ------------------------- normalizzazioni utili ------------------------ */

const maxDi = (f) => Math.max(...GIOCATORI.map(f));
const MAX_RATING = maxDi((p) => p.rating || 0);
const MIN_RATING = Math.min(...GIOCATORI.map((p) => p.rating || 0));
const MAX_EXP = maxDi((p) => p.expected || 0);
const MAX_PREZZO = maxDi((p) => p.price || 0);

const norm = (v, min, max) => (max > min ? (v - min) / (max - min) : 0);

/* ------------------------------- l'asta --------------------------------- */

/**
 * Un modo di giocare, in quattro numeri. Ogni manager simulato ne pesca uno
 * a caso: e' cosi' che lo spazio delle strategie viene coperto invece di
 * essere deciso da me in anticipo.
 */
function strategia() {
  return {
    pesoRating: fra(0, 1),        // quanto guarda la forza pura
    pesoAtteso: fra(0, 1),        // quanto guarda il rendimento atteso
    pesoPresenza: fra(0, 1),      // quanto guarda che ci sia
    sensibilePrezzo: fra(0, 2.5), // quanto gli pesa spendere
    disciplina: fra(0.3, 6),      // alto = prende sempre il suo preferito
  };
}

/** Quanto vale un giocatore per questo manager. */
function utilita(p, s) {
  return s.pesoRating * norm(p.rating || 0, MIN_RATING, MAX_RATING)
    + s.pesoAtteso * ((p.expected || 0) / MAX_EXP)
    + s.pesoPresenza * (p.presence || 0)
    - s.sensibilePrezzo * ((p.price || 0) / MAX_PREZZO);
}

/**
 * A quanto si aggiudicano davvero i giocatori, rispetto al listino.
 *
 * Non al valore pieno: i crediti in circolazione non bastano. Con otto
 * manager servono 64 giocatori, che a listino valgono 5310 crediti, mentre
 * in tutto il tavolo ce ne sono 4000. Il mercato deve quindi chiudere
 * attorno al 75%, ed e' anche quello che si vede in un'asta vera: sui
 * fuoriclasse si paga pieno o piu', su chi non interessa a nessuno si
 * prende per pochi spiccioli.
 *
 * Al valore pieno la simulazione si inceppava: nessuno arrivava a otto
 * giocatori e restavano rose monche.
 */
const SCONTO_MIN = 0.45;
const SCONTO_MAX = 1.05;

/**
 * L'asta, come allocazione a serpentina con budget ed esclusivita'.
 *
 * Non riproduce i rilanci uno per uno: riproduce il vincolo che conta,
 * cioe' che i giocatori sono contesi e i crediti finiscono. Il prezzo
 * pagato oscilla attorno alla valutazione del listone, perche' su un
 * giocatore conteso si finisce sempre per pagare qualcosa in piu'.
 */
function asta(strategie) {
  const rose = strategie.map(() => []);
  const speso = strategie.map(() => 0);
  const presi = new Set();

  for (let giro = 1; giro <= ROSA; giro++) {
    const ordine = giro % 2 === 1
      ? strategie.map((_, i) => i)
      : strategie.map((_, i) => i).reverse();

    for (const m of ordine) {
      const restano = ROSA - rose[m].length;
      // Un credito va tenuto per ogni casella ancora vuota, come nell'app:
      // cosi' il tetto non scende mai sotto 1 e la rosa arriva sempre a otto.
      const tetto = BUDGET - speso[m] - (restano - 1);
      // Si considera chi si potrebbe pagare anche nel caso piu' fortunato.
      let liberi = GIOCATORI.filter(
        (p) => !presi.has(p.id) && p.price * SCONTO_MIN <= tetto);

      // Al verde ci si accontenta: nell'app si puo' sempre offrire 1 credito,
      // e a fine asta chi ha speso tutto si porta a casa gli avanzi. E'
      // proprio questo che rende costoso strafare sui primi giocatori.
      if (!liberi.length) {
        liberi = GIOCATORI.filter((p) => !presi.has(p.id))
          .sort((a, b) => (a.price || 0) - (b.price || 0))
          .slice(0, 6);
      }
      if (!liberi.length) continue;

      const s = strategie[m];
      const punteggi = liberi.map((p) => ({ p, u: utilita(p, s) }));
      punteggi.sort((a, b) => b.u - a.u);

      // Softmax sui primi: la disciplina decide quanto spesso prende
      // davvero il preferito invece di uno li' vicino.
      const cima = punteggi.slice(0, 12);
      const pesi = cima.map((c) => Math.exp(c.u * s.disciplina));
      const somma = pesi.reduce((a, b) => a + b, 0);
      let soglia = rnd() * somma;
      let sceltoIdx = 0;
      for (let i = 0; i < pesi.length; i++) {
        soglia -= pesi[i];
        if (soglia <= 0) { sceltoIdx = i; break; }
      }
      const scelto = cima[sceltoIdx].p;

      const pagato = Math.max(1, Math.min(tetto,
        Math.round((scelto.price || 1) * fra(SCONTO_MIN, SCONTO_MAX))));

      presi.add(scelto.id);
      rose[m].push({ id: scelto.id, pagato, p: scelto });
      speso[m] += pagato;
    }
  }
  return { rose, speso };
}

/* ------------------------------ la stagione ----------------------------- */

/**
 * Formazione: i cinque piu' pagati in campo, il piu' pagato capitano.
 * E' la predefinita dell'app, quindi e' quello che fara' la maggioranza.
 */
function formazione(rosa) {
  const ordinata = [...rosa].sort((a, b) => b.pagato - a.pagato);
  const ids = ordinata.map((r) => r.id);
  return {
    starters: ids.slice(0, TITOLARI),
    bench: ids.slice(TITOLARI),
    captain: ids[0],
  };
}

/**
 * Gemello di `resultsMap` in views/matchdays.js, che qui non si puo'
 * importare perche' quel file tira dentro il DOM. Chi non compare nella
 * classifica non ha giocato: e' il caso che fa entrare la panchina.
 */
function risultatiPerRosa(torneo, posseduti) {
  const out = new Map();
  for (const pid of posseduti) {
    const s = torneo.standings.get(pid);
    out.set(pid, s
      ? { played: true, points: s.points, rank: s.rank, total: torneo.total,
          upsets: torneo.imprese.get(pid) || [] }
      : { played: false, points: 0, rank: null, total: torneo.total });
  }
  return out;
}

function giocaStagione(rose) {
  const totali = rose.map(() => 0);
  const lineups = new Map();
  rose.forEach((r, i) => lineups.set(String(i), formazione(r)));
  const posseduti = rose.flat().map((r) => r.id);

  for (let g = 0; g < GIORNATE; g++) {
    const torneo = scegli(TORNEI);
    const esiti = scoreMatchday(
      lineups, risultatiPerRosa(torneo, posseduti), torneo.h2h,
      undefined, torneo.rounds);
    rose.forEach((_, i) => { totali[i] += esiti.get(String(i))?.total || 0; });
  }
  return totali;
}

/* ----------------------------- le colonne ------------------------------- */

const media = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

/** Le caratteristiche della rosa, quelle su cui poi si cerca cosa conta. */
function caratteristiche(rosa, speso) {
  const ordinata = [...rosa].sort((a, b) => b.pagato - a.pagato);
  const tit = ordinata.slice(0, TITOLARI);
  const pan = ordinata.slice(TITOLARI);
  const prezzi = ordinata.map((r) => r.pagato);
  const pres = ordinata.map((r) => r.p.presence || 0);

  // Concentrazione della spesa: 1 = tutto su uno, 1/8 = spalmato uguale.
  const hhi = prezzi.reduce((s, v) => s + (v / speso) ** 2, 0);

  return {
    speso,
    avanzati: BUDGET - speso,
    quota_top1: prezzi[0] / speso,
    quota_top2: (prezzi[0] + prezzi[1]) / speso,
    concentrazione_hhi: hhi,
    prezzo_max: prezzi[0],
    prezzo_min: prezzi[prezzi.length - 1],
    n_sopra_100: prezzi.filter((v) => v >= 100).length,
    n_sotto_40: prezzi.filter((v) => v < 40).length,

    rating_medio: media(ordinata.map((r) => r.p.rating || 0)),
    rating_titolari: media(tit.map((r) => r.p.rating || 0)),

    presenza_media: media(pres),
    presenza_titolari: media(tit.map((r) => r.p.presence || 0)),
    presenza_panchina: media(pan.map((r) => r.p.presence || 0)),
    presenza_minima: Math.min(...pres),
    n_presenza_alta: pres.filter((v) => v >= 0.7).length,
    n_presenza_bassa: pres.filter((v) => v < 0.4).length,

    atteso_medio: media(ordinata.map((r) => r.p.expected || 0)),
    atteso_titolari: media(tit.map((r) => r.p.expected || 0)),
    atteso_totale: ordinata.reduce((s, r) => s + (r.p.expected || 0), 0),
    media_quando_gioca: media(ordinata.map((r) => r.p.avgPoints || 0)),

    presenza_capitano: ordinata[0].p.presence || 0,
    atteso_capitano: ordinata[0].p.expected || 0,
    // Quanto rende ogni credito speso, secondo il listone.
    atteso_per_credito: ordinata.reduce((s, r) => s + (r.p.expected || 0), 0) / speso,
  };
}

/* -------------------------------- il giro ------------------------------- */

console.log(`Simulo ${LEGHE} leghe da ${MANAGER} manager, `
  + `${GIORNATE} giornate, su ${TORNEI.length} tornei veri...`);

const righe = [];
for (let l = 0; l < LEGHE; l++) {
  const strategie = Array.from({ length: MANAGER }, strategia);
  const { rose, speso } = asta(strategie);
  if (rose.some((r) => r.length < ROSA)) continue;   // asta degenerata

  const totali = giocaStagione(rose);
  const ordine = totali.map((t, i) => ({ t, i })).sort((a, b) => b.t - a.t);
  const posizione = new Map(ordine.map((o, k) => [o.i, k + 1]));

  rose.forEach((r, i) => {
    righe.push({
      lega: l,
      ...caratteristiche(r, speso[i]),
      punti: Math.round(totali[i] * 10) / 10,
      posizione: posizione.get(i),
      vinta: posizione.get(i) === 1 ? 1 : 0,
    });
  });

  if ((l + 1) % 500 === 0) console.log(`  ${l + 1}/${LEGHE}`);
}

const colonne = Object.keys(righe[0]);
const csv = [colonne.join(",")]
  .concat(righe.map((r) => colonne.map((c) => r[c]).join(",")))
  .join("\n");
writeFileSync(OUT, csv, "utf8");

console.log(`\nScritte ${righe.length} rose in ${OUT}`);
console.log(`Punti: min ${Math.min(...righe.map((r) => r.punti))}, `
  + `max ${Math.max(...righe.map((r) => r.punti))}, `
  + `media ${media(righe.map((r) => r.punti)).toFixed(1)}`);
