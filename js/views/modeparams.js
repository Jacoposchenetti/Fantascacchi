/* ---------------------------------------------------------------
   I parametri di una modalità d'asta, come campi di form.

   Le quattro modalità sono mutuamente esclusive, quindi qui si mostrano
   solo i campi di QUELLA scelta. Usato sia dal form di creazione (home)
   sia dalle impostazioni della lega.
   --------------------------------------------------------------- */

import { el } from "../ui.js";
import { ORE_GIRO } from "../sealed.js";
import { DEFAULTS } from "../config.js";

const num = (name, label, value, min, max) =>
  el("div", { style: "flex:1;min-width:130px" },
    el("label.field", label,
      el("input", { type: "number", name, value, min, max })));

const sel = (name, label, opzioni, scelto) =>
  el("div", { style: "flex:1;min-width:130px" },
    el("label.field", label,
      el("select", { name },
        opzioni.map(([v, testo]) => el("option", {
          value: String(v), selected: String(v) === String(scelto),
        }, testo)))));

/**
 * @param modo  "live" | "sealed" | "draft" | "salary"
 * @param lg    la lega (per i valori attuali) o {} per i default
 * @returns un <div.row> coi soli campi della modalità
 */
export function campiModo(modo, lg = {}) {
  const oreOpts = ORE_GIRO.map((h) => [h, `${h} ${h === 1 ? "ora" : "ore"}`]);
  const giorniOpts = [1, 2, 3, 7].map((g) => [g, `${g} ${g === 1 ? "giorno" : "giorni"}`]);

  let campi;
  if (modo === "sealed") {
    campi = [sel("sealedhours", "Durata di ogni giro", oreOpts,
      lg.sealedHours || DEFAULTS.sealedHours)];
  } else if (modo === "salary") {
    campi = [sel("salarydays", "Durata della finestra", giorniOpts,
      lg.salaryDays || DEFAULTS.salaryDays)];
  } else if (modo === "draft") {
    campi = [num("draftsecs", "Secondi per scelta",
      lg.draftSeconds || DEFAULTS.draftSeconds, 15, 300)];
  } else {
    campi = [
      num("secs", "Secondi per rilancio", lg.bidSeconds || DEFAULTS.bidSeconds, 5, 120),
      num("turnsecs", "Secondi per chiamare", lg.turnSeconds || DEFAULTS.turnSeconds, 10, 300),
    ];
  }
  return el("div.row", { style: "gap:.6rem" }, campi);
}

/** Nel salvataggio: applica alla lega solo i parametri della sua modalità. */
export function applicaCampiModo(lg, f) {
  const modo = lg.auctionMode || "live";
  if (modo === "sealed") {
    lg.sealedHours = Number(f.get("sealedhours")) || DEFAULTS.sealedHours;
  } else if (modo === "salary") {
    lg.salaryDays = Number(f.get("salarydays")) || DEFAULTS.salaryDays;
  } else if (modo === "draft") {
    lg.draftSeconds = Number(f.get("draftsecs")) || DEFAULTS.draftSeconds;
  } else {
    if (f.get("secs") != null) lg.bidSeconds = Number(f.get("secs"));
    if (f.get("turnsecs") != null) lg.turnSeconds = Number(f.get("turnsecs"));
  }
}

/** Una riga di aiuto per la modalità scelta. */
export function notaModo(modo) {
  if (modo === "sealed") {
    return "Buste chiuse: giri a scadenza, ognuno manda le offerte quando può.";
  }
  if (modo === "salary") {
    return "Salary cap: prezzo fisso per giocatore, rose non esclusive, si compone entro una finestra.";
  }
  if (modo === "draft") {
    return "Draft: si sceglie a turno, l'ordine si inverte a ogni giro. Allo scadere dei secondi sceglie l'app.";
  }
  return "Asta live: «rilancio» è quanto dura un lotto e riparte a ogni offerta; "
    + "«chiamare» è il tempo per nominare quando tocca a te.";
}
