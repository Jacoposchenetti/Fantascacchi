/* ---------------------------------------------------------------
   La scacchiera per rivedere una partita.

   Le mosse arrivano in SAN ("Nbd2", "exd6", "O-O"), che sembra semplice
   e non lo e': la notazione omette il pezzo di partenza quando una sola
   mossa e' legale, quindi per ricostruirla bisogna sapere quali pezzi
   sono inchiodati. Scriverselo a mano vuol dire sbagliare in silenzio
   proprio nelle partite piu' interessanti, quindi qui si usa chess.js —
   caricata solo su questa pagina, non all'avvio dell'app.

   I pezzi sono glifi Unicode pieni per entrambi i colori, distinti dal
   colore del testo invece che dalla forma: i glifi "vuoti" del bianco
   (♔) su fondo scuro si leggono male, e su alcuni telefoni non si
   leggono affatto.
   --------------------------------------------------------------- */

import { el, modal } from "../ui.js";
import { partiteDelTurno } from "../chesscom.js";
import { valuta, spegni, quotaBianco, etichetta } from "../motore.js";

const CHESS_JS = "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm";

const GLIFI = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const COLONNE = "abcdefgh";

let Chess = null;

async function motore() {
  if (!Chess) ({ Chess } = await import(CHESS_JS));
  return Chess;
}

/**
 * Apre la partita in sovrimpressione.
 *
 * @param riga     una voce dell'indice: { w, b, wr, br, e, t, g, id, eco }
 * @param evento   l'id del torneo su chess.com
 * @param mio      username del giocatore in rosa (la scacchiera si gira
 *                 dalla sua parte: si segue meglio la partita di chi tifi)
 */
export function mostraPartita(riga, evento, mio = null) {
  modal((close) => {
    const corpo = el("div.stack", el("p.center.muted", { style: "margin:0" },
      "Carico la partita…"));

    (async () => {
      try {
        const [Motore, gruppo] = await Promise.all([
          motore(),
          partiteDelTurno(evento, riga.t, riga.g),
        ]);
        const partita = gruppo.get(riga.id);
        if (!partita?.pgn) throw new Error("Partita non trovata su chess.com");

        const g = new Motore();
        g.loadPgn(partita.pgn);

        // Le posizioni si calcolano una volta sola, rigiocando la partita:
        // navigare avanti e indietro diventa istantaneo.
        const mosse = g.history({ verbose: true });
        const replay = new Motore();
        const posizioni = [replay.fen()];
        for (const m of mosse) { replay.move(m.san); posizioni.push(replay.fen()); }

        corpo.replaceChildren(
          ...vista(riga, mosse, posizioni, mio, partita.url, close).childNodes,
        );
      } catch (err) {
        corpo.replaceChildren(el("div.stack",
          el("p.muted", { style: "margin:0" },
            err?.message || "Non sono riuscito a caricare la partita."),
          el("a.btn.btn-sm", {
            href: `https://www.chess.com/game/live/${riga.id}`,
            target: "_blank", rel: "noopener noreferrer",
          }, "Aprila su chess.com ↗"),
          el("div.row", { style: "justify-content:flex-end" },
            el("button.btn.btn-ghost", { onclick: close }, "Chiudi")),
        ));
      }
    })();

    return corpo;
  }, { wide: true });
}

/* -------------------------------- la vista ------------------------------ */

function vista(riga, mosse, posizioni, mio, url, close) {
  let ply = posizioni.length - 1;           // si apre sulla posizione finale
  const giraLaScacchiera = mio && riga.b === mio;

  const scacchiera = el("div.board");
  const elencoMosse = el("div.moves");
  const etichettaMossa = el("span.small.mute-2");

  // Barra del vantaggio: spenta finche' non la si chiede, perche' accenderla
  // scarica 328 KB di motore che a chi vuole solo rivedere le mosse non
  // servono.
  let barraAccesa = false;
  const riempimento = el("i");
  const valoreBarra = el("span.evalnum", "—");
  // Il riempimento parte sempre dal basso e rappresenta CHI STA SOTTO alla
  // scacchiera: col nero in basso dev'essere scuro, altrimenti una barra
  // quasi tutta chiara racconterebbe che sta vincendo il bianco proprio
  // mentre il nero e' avanti di nove.
  const barra = el("div.evalbar", {
    hidden: true, class: giraLaScacchiera ? "eval-nero" : "",
  }, riempimento, valoreBarra);

  async function aggiornaBarra() {
    if (!barraAccesa) return;
    valoreBarra.textContent = "…";
    try {
      const v = await valuta(posizioni[ply]);
      if (!barraAccesa) return;
      const quota = quotaBianco(v);
      // La barra cresce dal basso per chi sta sotto la scacchiera: se e'
      // girata, in basso c'e' il nero.
      const daSotto = giraLaScacchiera ? 1 - quota : quota;
      riempimento.style.height = `${(daSotto * 100).toFixed(1)}%`;
      valoreBarra.textContent = etichetta(v);
    } catch {
      valoreBarra.textContent = "—";
    }
  }

  function disegna() {
    scacchiera.replaceChildren(...caselle(posizioni[ply], giraLaScacchiera,
      ply > 0 ? mosse[ply - 1] : null));
    etichettaMossa.textContent = ply === 0
      ? "posizione iniziale"
      : `${Math.ceil(ply / 2)}${ply % 2 ? "." : "..."} ${mosse[ply - 1].san}`;
    elencoMosse.querySelectorAll("button").forEach((b, i) => {
      b.classList.toggle("is-now", i + 1 === ply);
    });
    const attiva = elencoMosse.querySelector(".is-now");
    if (attiva) attiva.scrollIntoView({ block: "nearest" });
  }

  const vai = (n) => {
    ply = Math.max(0, Math.min(posizioni.length - 1, n));
    disegna();
    aggiornaBarra();
  };

  elencoMosse.replaceChildren(...mosse.map((m, i) => el("button.move", {
    type: "button", onclick: () => vai(i + 1),
  }, i % 2 === 0 ? el("span.num", `${i / 2 + 1}.`) : null, m.san)));

  // Le frecce sono il modo naturale di scorrere una partita; si ascoltano
  // sul documento perche' il fuoco puo' stare ovunque nella finestra.
  const tasti = (e) => {
    const dove = { ArrowLeft: ply - 1, ArrowRight: ply + 1,
                   Home: 0, End: posizioni.length - 1 }[e.key];
    if (dove === undefined) return;
    e.preventDefault();
    vai(dove);
  };
  document.addEventListener("keydown", tasti);
  const dlg = document.querySelector("#modal");
  dlg?.addEventListener("close", () => {
    document.removeEventListener("keydown", tasti);
    // Il motore non deve restare acceso a consumare dopo la chiusura.
    spegni();
  }, { once: true });

  disegna();

  const esito = riga.e === "d" ? "½–½" : riga.e === "w" ? "1–0" : "0–1";

  return el("div.stack",
    el("div.spread", { style: "gap:.6rem;align-items:flex-start" },
      el("div", { style: "min-width:0" },
        el("div.pname",
          el("strong", riga.w), el("span.muted", ` ${riga.wr || ""} `),
          el("span.badge", esito),
          el("span.muted", ` ${riga.br || ""} `), el("strong", riga.b)),
        el("div.small.mute-2", `Turno ${riga.t}${riga.eco ? ` · ${riga.eco}` : ""}`)),
      el("button.pc-close", { type: "button", onclick: close, "aria-label": "Chiudi" }, "✕"),
    ),

    // I comandi stanno sotto la scacchiera e PRIMA dell'elenco mosse: su
    // telefono l'elenco e' lungo, e mettendoli in fondo finivano fuori
    // schermo proprio mentre servivano.
    el("div.boardwrap",
      el("div.boardcol",
        el("div.boardrow", barra, scacchiera),
        el("div.row", { style: "gap:.3rem;align-items:center" },
          el("button.btn.btn-sm.btn-ghost", { onclick: () => vai(0), "aria-label": "Inizio" }, "⏮"),
          el("button.btn.btn-sm.btn-ghost", { onclick: () => vai(ply - 1), "aria-label": "Indietro" }, "◀"),
          el("button.btn.btn-sm.btn-ghost", { onclick: () => vai(ply + 1), "aria-label": "Avanti" }, "▶"),
          el("button.btn.btn-sm.btn-ghost", { onclick: () => vai(posizioni.length - 1), "aria-label": "Fine" }, "⏭"),
          etichettaMossa,
          el("button.btn.btn-sm.btn-ghost", {
            style: "margin-left:auto",
            onclick: (e) => {
              barraAccesa = !barraAccesa;
              barra.hidden = !barraAccesa;
              e.currentTarget.textContent = barraAccesa ? "Nascondi valutazione" : "Valutazione";
              if (barraAccesa) aggiornaBarra();
            },
          }, "Valutazione"),
        ),
      ),
      elencoMosse,
    ),

    el("div.row",
      el("a.btn.btn-sm.btn-ghost", {
        href: url || `https://www.chess.com/game/live/${riga.id}`,
        target: "_blank", rel: "noopener noreferrer",
      }, "Su chess.com ↗"),
    ),
  );
}

/** Le 64 caselle a partire da una FEN, con l'ultima mossa evidenziata. */
function caselle(fen, girata, ultima) {
  const righe = fen.split(" ")[0].split("/");
  const out = [];
  const ordineRighe = girata ? [...righe].reverse() : righe;

  for (let r = 0; r < 8; r++) {
    const pezzi = [];
    for (const c of ordineRighe[r]) {
      if (/\d/.test(c)) { for (let i = 0; i < Number(c); i++) pezzi.push(null); }
      else pezzi.push(c);
    }
    const ordineColonne = girata ? pezzi.reverse() : pezzi;
    for (let c = 0; c < 8; c++) {
      const p = ordineColonne[c];
      const fila = girata ? r + 1 : 8 - r;
      const col = girata ? COLONNE[7 - c] : COLONNE[c];
      const nome = `${col}${fila}`;
      const chiara = (r + c) % 2 === 0;
      const toccata = ultima && (ultima.from === nome || ultima.to === nome);
      out.push(el("div.sq", {
        class: `${chiara ? "sq-l" : "sq-d"}${toccata ? " sq-hit" : ""}`,
      }, p ? el("span", {
        class: p === p.toUpperCase() ? "pc pc-w" : "pc pc-b",
      }, GLIFI[p.toLowerCase()]) : null));
    }
  }
  return out;
}
