/* ---------------------------------------------------------------
   Scheda profilo, in sovrimpressione.

   Raggiungibile da qualsiasi lega toccando il proprio nome nella barra:
   mostra con che account sei entrato, le altre leghe che hai attive (ci
   clicchi e ci entri), e il pulsante per uscire.
   --------------------------------------------------------------- */

import { el, modal } from "../ui.js";
import myLeaguesSection from "./myleagues.js";
import { controlloNotifiche } from "./avvisi.js";

export function showProfile(ctx, { legaCorrente = null } = {}) {
  const me = ctx.store.me;

  modal((close) => el("div.pc",
    el("div.pc-head",
      me?.photo
        ? el("img.pc-av", { src: me.photo, alt: "", referrerpolicy: "no-referrer" })
        : el("div.pc-av", { style: "display:grid;place-items:center;font-size:1.4rem" },
            (me?.name || "?")[0].toUpperCase()),
      el("div", { style: "min-width:0" },
        el("div.pc-name", el("span", me?.name || "Giocatore")),
        el("div.pc-sub",
          me?.email || (ctx.store.mode === "local" ? "profilo locale" : "accesso anonimo"))),
      el("button.pc-close", {
        type: "button", onclick: close, "aria-label": "Chiudi", title: "Chiudi",
      }, "✕"),
    ),

    el("div.pc-body",
      myLeaguesSection(ctx, { titolo: "Le tue altre leghe", escludi: legaCorrente }),

      el("div.card", controlloNotifiche(ctx)),

      el("div.row", { style: "gap:.6rem" },
        el("a.btn.btn-sm", { href: "#/", onclick: close }, "Home"),
        ctx.store.needsAuth && el("button.btn.btn-sm.btn-ghost", {
          onclick: async () => {
            close();
            await ctx.store.signOut?.();
            ctx.go("#/");
          },
        }, "Esci dall'account"),
      ),
    ),
  ), { wide: true });
}
