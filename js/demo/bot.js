/* ---------------------------------------------------------------
   I due avversari del tutorial.

   Non sono un'intelligenza artificiale e non devono esserlo: devono
   essere prevedibili quanto basta perche' chi guarda capisca le regole,
   e imprevedibili quanto basta perche' l'asta sembri un'asta.

   Ognuno si fa un'idea di quanto vale un giocatore e non la supera mai.
   E' questo che fa chiudere i lotti: due bot che rilanciano all'infinito
   terrebbero il cronometro sempre pieno e il tutorial non finirebbe piu'.

   I tempi di reazione sono lenti apposta (uno-tre secondi). Un bot che
   rilancia in dieci millesimi vince sempre, e chi sta imparando non
   capisce nemmeno cos'e' successo.
   --------------------------------------------------------------- */

import { maxBid, ownedCount, nominator, allOwnedPlayerIds } from "../league.js";
import { closeLot } from "../views/auction.js";
import { BOT } from "./finto.js";

const PAUSA_RILANCIO = [1100, 2600];      // quanto ci mette un bot a rispondere
const PAUSA_CHIAMATA = [1400, 2800];      // quanto ci mette a scegliere chi chiamare

export function creaMotore(store, catalog) {
  let timer = null;
  const valutazioni = new Map();          // "uid:playerId" -> crediti
  const quando = new Map();               // chi agisce e a partire da quando
  let occupato = false;

  const ctxFinto = { mutate: (fn) => store.updateLeague("demo", fn) };

  async function giro() {
    if (occupato) return;                 // una mutazione alla volta
    occupato = true;
    try { await passo(); } catch { /* nel tutorial un errore non fa danni */ }
    occupato = false;
  }

  async function passo() {
    const lg = store.leggi();
    if (!lg || lg.phase !== "auction") return;
    const a = lg.auction || {};
    const ora = Date.now();

    // Il lotto scaduto lo chiude il motore, non solo la vista: se chi guarda
    // ha cambiato scheda l'asta deve andare avanti lo stesso.
    if (a.status === "running" && ora > (a.endsAt || 0)) {
      await closeLot(ctxFinto);
      return;
    }

    if (a.status === "running") return rilanci(lg, a, ora);
    return chiamata(lg, a, ora);
  }

  /* ------------------------------ rilanci ------------------------------ */

  async function rilanci(lg, a, ora) {
    for (const bot of BOT) {
      if (a.bidderUid === bot.uid) continue;                  // gia' al comando
      if (ownedCount(lg, bot.uid) >= lg.rosterSize) continue; // rosa piena

      const chiave = `rilancio:${bot.uid}:${a.playerId}`;
      if (!quando.has(chiave)) {
        quando.set(chiave, ora + fra(PAUSA_RILANCIO));
        continue;
      }
      if (ora < quando.get(chiave)) continue;

      const tetto = Math.min(valuta(bot, a.playerId), maxBid(lg, bot.uid));
      if (tetto <= a.bid) continue;                           // per lui vale meno

      const offerta = Math.min(tetto, a.bid + 1 + Math.floor(Math.random() * 4));
      await store.updateLeague("demo", (l) => {
        const c = l.auction || {};
        if (c.status !== "running" || c.playerId !== a.playerId) return null;
        if (c.bidderUid === bot.uid || offerta <= c.bid) return null;
        if (offerta > maxBid(l, bot.uid)) return null;
        l.auction = {
          ...c, bid: offerta, bidderUid: bot.uid,
          endsAt: Date.now() + (l.bidSeconds || 8) * 1000,
        };
        return l;
      });
      // Si riparte da capo: al prossimo rilancio ci mettera' di nuovo un po'.
      quando.set(chiave, Date.now() + fra(PAUSA_RILANCIO));
      return;                                                 // uno per volta
    }
  }

  /* ------------------------------ chiamata ----------------------------- */

  async function chiamata(lg, a, ora) {
    const tocca = nominator(lg);
    const bot = BOT.find((b) => b.uid === tocca);
    if (!bot) return;                                         // tocca a chi guarda

    const chiave = `chiamata:${a.turnIdx || 0}`;
    if (!quando.has(chiave)) { quando.set(chiave, ora + fra(PAUSA_CHIAMATA)); return; }
    if (ora < quando.get(chiave)) return;

    const scelto = daChiamare(lg, bot);

    // Un bot che non puo' chiamare niente DEVE passare la mano, altrimenti
    // il turno resta suo e l'asta non finisce piu'. Nell'app vera ci pensa
    // la scadenza del turno, ma qui e' larghissima apposta per non mettere
    // fretta a chi sta imparando: il rimedio automatico non arriverebbe mai.
    if (!scelto) {
      await store.updateLeague("demo", (l) => {
        if (l.auction?.status === "running" || nominator(l) !== bot.uid) return null;
        l.auction = { ...l.auction, turnIdx: (l.auction?.turnIdx || 0) + 1, turnEndsAt: 0 };
        return l;
      });
      return;
    }

    await store.updateLeague("demo", (l) => {
      if (l.auction?.status === "running") return null;
      if (nominator(l) !== bot.uid) return null;
      if (l.roster?.[scelto.id]) return null;
      l.auction = {
        status: "running", playerId: scelto.id, bid: 1, bidderUid: bot.uid,
        endsAt: Date.now() + (l.bidSeconds || 8) * 1000,
        turnIdx: l.auction?.turnIdx || 0,
        turnEndsAt: 0,
      };
      return l;
    });
  }

  /**
   * Chi chiamare: uno a caso fra i piu' forti che puo' ancora permettersi.
   * Non il migliore in assoluto, altrimenti due tutorial di fila sarebbero
   * identici e l'asta sembrerebbe una scaletta scritta.
   */
  function daChiamare(lg, bot) {
    const tetto = maxBid(lg, bot.uid);
    if (tetto < 1) return null;                     // al verde: passa la mano

    const presi = new Set(allOwnedPlayerIds(lg));
    const liberi = (catalog.meta?.players || []).filter((p) => !presi.has(p.id));
    if (!liberi.length) return null;

    // Di norma punta ai piu' cari che puo' ancora permettersi. Se non se ne
    // permette nessuno prende comunque il piu' economico rimasto: si parte
    // da 1 credito, quindi chiamare e' sempre possibile, ed e' meglio di un
    // turno passato a vuoto.
    const abbordabili = liberi
      .filter((p) => (p.price || 10) <= tetto * 1.5)
      .sort((x, y) => (y.price || 0) - (x.price || 0))
      .slice(0, 12);
    if (abbordabili.length) {
      return abbordabili[Math.floor(Math.random() * abbordabili.length)];
    }
    return liberi.sort((x, y) => (x.price || 0) - (y.price || 0))[0];
  }

  /**
   * Quanto vale un giocatore per questo bot. Si decide una volta sola e
   * non cambia piu': un avversario che cambia idea a meta' lotto sembra
   * rotto, non umano.
   */
  function valuta(bot, playerId) {
    const chiave = `${bot.uid}:${playerId}`;
    if (!valutazioni.has(chiave)) {
      const prezzo = catalog.map.get(playerId)?.price || 10;
      // Bea si innamora e paga sopra prezzo; Cico cerca solo l'affare.
      const f = bot.indole === "tifosa"
        ? 1.0 + Math.random() * 0.5
        : 0.5 + Math.random() * 0.45;
      valutazioni.set(chiave, Math.max(2, Math.round(prezzo * f)));
    }
    return valutazioni.get(chiave);
  }

  /* -------------------------------- avvio ------------------------------ */

  return {
    avvia() {
      if (timer) return;
      timer = setInterval(giro, 450);
    },
    ferma() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

const fra = ([min, max]) => min + Math.random() * (max - min);
