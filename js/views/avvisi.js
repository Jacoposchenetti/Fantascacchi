/* ---------------------------------------------------------------
   Gli inviti che compaiono in cima all'app: installala sulla home,
   accendi le notifiche.

   Regola che vale per tutti e due: si mostra UNO alla volta e mai al
   primo sguardo. Due banner impilati sopra il contenuto sono la
   maniera piu' rapida di farli ignorare entrambi per sempre.

   L'ordine non e' casuale: prima l'installazione, perche' su iPhone
   senza quella le notifiche non esistono proprio.
   --------------------------------------------------------------- */

import { el, modal, toast } from "../ui.js";
import {
  statoNotifiche, attivaNotifiche, disattivaNotifiche, risincronizza,
  giaChiesto, segnaChiesto,
} from "../push.js";
import {
  statoInstallazione, installa, vaProposto, rifiuta, PASSI_IOS, onInstallChange,
} from "../install.js";

// Lo stato delle notifiche si legge con una promise, ma le viste sono
// sincrone: lo si tiene qui, aggiornato agli avvenimenti che contano.
let stato = null;

/**
 * Da chiamare una volta all'avvio. Calcola lo stato, ripassa al server
 * l'iscrizione se e' cambiata sotto banco, e ridisegna.
 */
export async function initAvvisi(ctx) {
  onInstallChange(() => ctx.refresh());
  try {
    stato = await statoNotifiche();
    if (stato === "attive") await risincronizza(ctx.store);
  } catch { stato = "non-supportate"; }
  ctx.refresh();
}

export function statoPush() { return stato; }

/* -------------------------------- lo slot ------------------------------- */

/**
 * Il contenuto della striscia in cima. `null` quando non c'e' niente da
 * dire, che e' il caso piu' frequente e deve restare tale.
 */
export function avvisiSlot(ctx) {
  if (vaProposto()) return bannerInstalla(ctx);
  if (meritaChiedere(ctx)) return bannerNotifiche(ctx);
  return null;
}

/**
 * Le notifiche si propongono solo a chi sta davvero giocando: dentro una
 * lega, online, con il permesso mai chiesto prima. Sulla home sarebbero
 * una richiesta a freddo, e a freddo si risponde no.
 */
function meritaChiedere(ctx) {
  if (ctx.store.mode !== "firebase") return false;   // in locale non arriva niente
  if (!ctx.league) return false;
  if (giaChiesto()) return false;
  return stato === "da-chiedere";
}

/* ------------------------------ installazione --------------------------- */

function bannerInstalla(ctx) {
  const iOS = statoInstallazione() === "istruzioni";

  return el("div.notice.avviso",
    el("div.avviso-testo",
      el("strong", iOS ? "Aggiungi Fantascacchi alla home" : "Installala sul telefono"),
      el("div.small.mute-2", { style: "margin-top:.15rem" },
        iOS
          ? "Si apre a tutto schermo come un'app — ed è l'unico modo, su iPhone, "
            + "per ricevere gli avvisi dell'asta."
          : "Si apre a tutto schermo, parte più in fretta e può avvisarti "
            + "quando tocca a te."),
    ),
    el("div.row", { style: "gap:.4rem;flex:0 0 auto" },
      el("button.btn.btn-sm.btn-primary", {
        onclick: async () => {
          if (iOS) { istruzioniIOS(); return; }
          const fatto = await installa();
          if (fatto) toast("Fantascacchi è sulla tua schermata home", "ok");
          ctx.refresh();
        },
      }, iOS ? "Come si fa" : "Installa"),
      el("button.btn.btn-sm.btn-ghost", {
        title: "Non mostrarlo per un po'",
        onclick: () => { rifiuta(); ctx.refresh(); },
      }, "×"),
    ),
  );
}

/** Su iOS il browser non collabora: si spiega il giro a mano. */
export function istruzioniIOS() {
  modal((close) => el("div.stack",
    el("h2", "Aggiungerla alla home"),
    el("p.muted.small", { style: "margin:0" },
      "Safari non ha un pulsante di installazione: il giro è questo, "
      + "e si fa una volta sola."),
    el("ol.stack-s", { style: "margin:0;padding-left:1.2rem;line-height:1.5" },
      PASSI_IOS.map((p) => el("li", p))),
    el("p.small.mute-2", { style: "margin:0" },
      "Fatto questo, riapri Fantascacchi dall'icona nuova: da lì potrai "
      + "anche accendere le notifiche."),
    el("div.row", { style: "justify-content:flex-end" },
      el("button.btn.btn-primary", { onclick: close }, "Ho capito")),
  ));
}

/* -------------------------------- notifiche ----------------------------- */

function bannerNotifiche(ctx) {
  return el("div.notice.avviso",
    el("div.avviso-testo",
      el("strong", "Ti avviso io quando tocca a te"),
      el("div.small.mute-2", { style: "margin-top:.15rem" },
        "Un colpetto quando parte un giro d'asta, quando devi scegliere "
        + "o quando sta per scadere qualcosa. Nient'altro."),
    ),
    el("div.row", { style: "gap:.4rem;flex:0 0 auto" },
      el("button.btn.btn-sm.btn-primary", {
        onclick: async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          stato = await attivaNotifiche(ctx.store);
          if (stato === "attive") toast("Notifiche attive", "ok");
          else if (stato === "negate") {
            toast("Le hai bloccate: si riaccendono dalle impostazioni del browser", "err");
          }
          ctx.refresh();
        },
      }, "Sì, avvisami"),
      el("button.btn.btn-sm.btn-ghost", {
        onclick: () => { segnaChiesto(); ctx.refresh(); },
      }, "No grazie"),
    ),
  );
}

/* --------------------- il comando fisso, nel profilo -------------------- */

/**
 * Il riquadro che sta nel profilo: da qui si accendono e si spengono
 * sempre, anche dopo aver mandato via il banner.
 */
export function controlloNotifiche(ctx) {
  if (ctx.store.mode !== "firebase") {
    return el("p.small.mute-2", { style: "margin:0" },
      "In modalità locale non ci sono notifiche: i dati non escono da questo browser.");
  }

  const righe = {
    "non-supportate": ["Questo browser non le supporta.", null],
    "serve-installazione": [
      "Su iPhone servono dall'app aggiunta alla schermata home.", "Come si fa"],
    negate: [
      "Le hai bloccate. Si riaccendono dalle impostazioni del sito nel browser, "
      + "non da qui.", null],
    "da-chiedere": ["Spente. Le accendo solo per l'asta e le scadenze.", "Attiva"],
    attive: ["Attive su questo dispositivo.", "Disattiva"],
  };
  const [testo, azione] = righe[stato] || righe["da-chiedere"];

  return el("div.spread", { style: "gap:.8rem;align-items:flex-start" },
    el("div",
      el("strong", "Notifiche"),
      el("div.small.mute-2", { style: "margin-top:.15rem" }, testo)),
    azione && el("button.btn.btn-sm", {
      class: stato === "attive" ? "btn btn-sm btn-ghost" : "btn btn-sm",
      onclick: async (e) => {
        if (stato === "serve-installazione") { istruzioniIOS(); return; }
        const b = e.currentTarget;
        b.disabled = true;
        stato = stato === "attive"
          ? await disattivaNotifiche(ctx.store)
          : await attivaNotifiche(ctx.store);
        toast(stato === "attive" ? "Notifiche attive" : "Notifiche spente",
          stato === "attive" ? "ok" : null);
        ctx.refresh();
      },
    }, azione),
  );
}
