/* ---------------------------------------------------------------
   La telecronaca di chess.com, mentre il Titled Tuesday e' in corso.

   Non e' una registrazione: quelle non esistono in forma utilizzabile.
   L'API di chess.com non pubblica niente sui video, le telecronache
   stanno su Twitch e i VOD dei partner scadono dopo sessanta giorni —
   cioe' prima della fine di una stagione. E soprattutto un flusso di
   quattro ore non ha un indice dei momenti, quindi non si potrebbe
   comunque agganciare a una partita: per quello c'e' la scacchiera.

   La diretta invece si puo': si mostra solo dentro la finestra del
   torneo, e solo se qualcuno la chiede.

   Il riquadro NON carica l'iframe da solo. Un player di terze parti che
   parte all'apertura della pagina significa qualche mega di video e un
   pezzo di Twitch che ti guarda, a chi magari era passato solo per
   controllare i punti.
   --------------------------------------------------------------- */

import { el, render } from "../ui.js";

const CANALE = "chess";

/**
 * Twitch accetta di essere incorporato solo se `parent` combacia con il
 * dominio che ospita la pagina: vale per localhost in sviluppo e per
 * github.io in produzione, senza doverlo scrivere da nessuna parte.
 */
function urlPlayer() {
  const p = new URLSearchParams({
    channel: CANALE,
    parent: location.hostname,
    autoplay: "true",
    muted: "false",
  });
  return `https://player.twitch.tv/?${p}`;
}

export default function telecronaca() {
  const posto = el("div.stack-s");

  const invito = () => el("div.stack-s",
    el("div.spread",
      el("div",
        el("strong", "Telecronaca in diretta"),
        el("div.small.mute-2",
          "Il torneo si sta giocando adesso e chess.com lo commenta su Twitch.")),
      el("button.btn.btn-sm.btn-primary", { onclick: apri }, "Guarda")),
    el("p.small.mute-2", { style: "margin:0" },
      "Si apre solo se lo chiedi: è video, e pesa."),
  );

  function apri() {
    render(posto,
      el("div.spread",
        el("strong", "Telecronaca in diretta"),
        el("button.btn.btn-sm.btn-ghost", { onclick: chiudi }, "Chiudi")),
      el("div.videowrap",
        el("iframe", {
          src: urlPlayer(),
          title: "Telecronaca di chess.com su Twitch",
          allowfullscreen: true,
          // Niente scritture di terze parti se non servono: il player
          // funziona lo stesso e la scheda resta piu' pulita.
          allow: "autoplay; fullscreen; picture-in-picture",
          referrerpolicy: "no-referrer-when-downgrade",
          loading: "lazy",
        })),
      el("p.small.mute-2", { style: "margin:0" },
        "Se non si vede nessuno, la diretta non è ancora partita. ",
        el("a", {
          href: `https://www.twitch.tv/${CANALE}`,
          target: "_blank", rel: "noopener noreferrer",
        }, "Aprila su Twitch ↗")),
    );
  }

  function chiudi() { render(posto, invito()); }

  render(posto, invito());
  return el("div.card.stack-s", posto);
}
