/* ---------------------------------------------------------------
   Stockfish, per la barra del vantaggio.

   Gira in un Web Worker: una valutazione dura qualche centinaio di
   millisecondi e sul filo principale bloccherebbe tutto, comprese le
   frecce con cui si scorre la partita.

   Non si carica all'avvio. Sono 328 KB compressi che servono soltanto a
   chi accende la barra, e chi apre una partita per rivederla in genere
   non li chiede.

   Nota sul worker: `new Worker(url)` verso un'altra origine e' vietato,
   quindi si crea un blob locale che fa `importScripts` del CDN — quello
   invece cross-origin e' consentito.
   --------------------------------------------------------------- */

const SORGENTE = "https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js";

/** Quanto pensare per posizione: ~400 ms danno profondita' 11, che per
 *  dire chi sta meglio basta e avanza. Depth 14 ne vorrebbe 22 mila. */
const PENSA_MS = 300;

let worker = null;
let avvio = null;

function accendi() {
  if (avvio) return avvio;
  avvio = new Promise((risolvi, rifiuta) => {
    try {
      const blob = new Blob([`importScripts(${JSON.stringify(SORGENTE)});`],
        { type: "text/javascript" });
      const w = new Worker(URL.createObjectURL(blob));
      const pronto = (e) => {
        if (!String(e.data).includes("uciok")) return;
        w.removeEventListener("message", pronto);
        worker = w;
        risolvi(w);
      };
      w.addEventListener("message", pronto);
      w.addEventListener("error", (e) => rifiuta(new Error(e.message || "motore")));
      w.postMessage("uci");
    } catch (e) {
      rifiuta(e);
    }
  });
  avvio.catch(() => { avvio = null; });     // si potra' riprovare
  return avvio;
}

let inCorso = null;

/**
 * Valuta una posizione. Chiamarla di nuovo annulla la precedente: chi
 * tiene premuta la freccia destra non deve accodare venti analisi.
 *
 * Il punteggio UCI e' dal punto di vista di CHI MUOVE; qui si restituisce
 * sempre dal punto di vista del bianco, altrimenti la barra si ribalta a
 * ogni mossa.
 *
 * @returns {Promise<{cp:number|null, matto:number|null, profondita:number}>}
 */
export async function valuta(fen) {
  const w = await accendi();
  const tocca = (fen.split(" ")[1] || "w") === "w" ? 1 : -1;

  if (inCorso) { inCorso.annullata = true; w.postMessage("stop"); }
  const mia = { annullata: false };
  inCorso = mia;

  return new Promise((risolvi) => {
    let ultimo = { cp: null, matto: null, profondita: 0 };

    const ascolta = (e) => {
      const riga = String(e.data);

      const m = riga.match(/depth (\d+).*score (cp|mate) (-?\d+)/);
      if (m) {
        ultimo = {
          cp: m[2] === "cp" ? Number(m[3]) * tocca : null,
          matto: m[2] === "mate" ? Number(m[3]) * tocca : null,
          profondita: Number(m[1]),
        };
      }

      if (riga.startsWith("bestmove")) {
        w.removeEventListener("message", ascolta);
        if (inCorso === mia) inCorso = null;
        // Una valutazione annullata non deve sovrascrivere quella nuova.
        if (!mia.annullata) risolvi(ultimo);
      }
    };

    w.addEventListener("message", ascolta);
    w.postMessage("position fen " + fen);
    w.postMessage(`go movetime ${PENSA_MS}`);
  });
}

/** Spegne il motore: serve quando si chiude la partita. */
export function spegni() {
  if (worker) { try { worker.terminate(); } catch { /* gia' morto */ } }
  worker = null;
  avvio = null;
  inCorso = null;
}

/**
 * Da centesimi di pedone alla quota di barra del bianco (0..1).
 *
 * Non e' lineare: fra +0.2 e +0.5 cambia tutto, fra +8 e +9 non cambia
 * niente perche' e' gia' vinta. La sigmoide e' la stessa curva che usano
 * i siti di scacchi, e ha il pregio di non arrivare mai a zero o a uno —
 * la barra non sparisce del tutto nemmeno in posizioni disperate.
 */
export function quotaBianco({ cp, matto }) {
  if (matto != null) return matto > 0 ? 1 : 0;
  if (cp == null) return 0.5;
  return 1 / (1 + Math.exp(-0.00368208 * cp));
}

/** L'etichetta da mostrare: "+1.4", "-0.6", "M3". */
export function etichetta({ cp, matto }) {
  if (matto != null) return (matto > 0 ? "M" : "-M") + Math.abs(matto);
  if (cp == null) return "…";
  const v = cp / 100;
  return (v > 0 ? "+" : "") + v.toFixed(1);
}
