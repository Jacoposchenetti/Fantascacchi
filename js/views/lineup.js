/* ---------------------------------------------------------------
   Formazione della prossima giornata.

   Non c'e' piu' niente da aprire o chiudere a mano: la giornata aperta e'
   quella che il calendario indica come prossima, e gli schieramenti si
   bloccano da soli quando il torneo comincia (martedi' alle 15:00 UTC).

   Se non salvi niente resta valida l'ultima formazione che hai messo:
   meglio giocare con quella della settimana prima che prendere zero.
   --------------------------------------------------------------- */

import { el, toast, flag, presenceClass } from "../ui.js";
import { rosterOf } from "../league.js";
import { showPlayer } from "./player.js";
import { effectiveLineup, lineupsFor, slotDocId, dataLunga, quando } from "../season.js";

const drafts = new Map();   // n giornata -> {starters, bench, captain}

export default function lineupView(ctx) {
  const { league, catalog, plan, uid } = ctx;
  if (!catalog) return el("div.card", "Carico il listone…");

  const mine = rosterOf(league, catalog, uid);
  if (!mine.length) {
    return el("div.card.stack",
      el("h2", "Prima serve una rosa"),
      el("p.muted", { style: "margin:0" }, "Non hai ancora giocatori: passa dall'asta."),
      el("button.btn.btn-primary", { onclick: () => ctx.go(`#/l/${league.id}/asta`) },
        "Vai all'asta"),
    );
  }

  if (!plan) return el("div.card", "Carico il calendario…");

  const slot = plan.slots.find((s) => s.status === "open");
  if (!slot) return chiusa(ctx, plan, mine);

  // Salvata per QUESTA giornata, oppure ereditata dall'ultima messa.
  const own = lineupsFor(ctx.matchdays, slot.n)[uid] || null;
  const eff = own || effectiveLineup(ctx.matchdays, slot.n, uid);
  const inherited = !own && Boolean(eff);

  const draft = drafts.get(slot.n) || normalize(eff, mine, league.lineupSize);
  drafts.set(slot.n, draft);

  const byId = new Map(mine.map((r) => [r.playerId, r.player]));
  const starters = draft.starters.filter((id) => byId.has(id));
  const bench = draft.bench.filter((id) => byId.has(id));
  const need = league.lineupSize - starters.length;

  const setDraft = (next) => { drafts.set(slot.n, next); ctx.refresh(); };

  function toggle(pid) {
    if (starters.includes(pid)) {
      setDraft({
        starters: starters.filter((x) => x !== pid),
        bench: [...bench, pid],
        captain: draft.captain === pid ? null : draft.captain,
      });
    } else {
      if (starters.length >= league.lineupSize) {
        toast(`Puoi schierare solo ${league.lineupSize} titolari`, "err");
        return;
      }
      setDraft({
        starters: [...starters, pid],
        bench: bench.filter((x) => x !== pid),
        captain: draft.captain,
      });
    }
  }

  function moveBench(pid, dir) {
    const i = bench.indexOf(pid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= bench.length) return;
    const next = [...bench];
    [next[i], next[j]] = [next[j], next[i]];
    setDraft({ ...draft, starters, bench: next });
  }

  async function save() {
    if (starters.length !== league.lineupSize) {
      toast(`Servono esattamente ${league.lineupSize} titolari`, "err");
      return;
    }
    if (!draft.captain) { toast("Scegli il capitano", "err"); return; }
    try {
      await ctx.store.setLineup(league.id, slotDocId(slot.n), uid,
        { starters, bench, captain: draft.captain });
      toast("Formazione salvata", "ok");
    } catch (err) {
      toast(err.message || "Salvataggio non riuscito", "err");
    }
  }

  const changed = !eff
    || eff.captain !== draft.captain
    || (eff.starters || []).join() !== starters.join()
    || (eff.bench || []).join() !== bench.join();
  const dirty = changed || inherited;

  return el("div.stack", { style: "gap:1.4rem" },

    el("div.card.card-hi.stack-s",
      el("div.spread",
        el("div",
          el("h2", `Giornata ${slot.n} di ${plan.total}`),
          el("div.small.muted",
            `Titled Tuesday del ${dataLunga(slot.date)} · si gioca ${quando(slot.start)}`)),
        own ? el("span.badge.badge-green", "Salvata")
          : inherited ? el("span.badge.badge-gold", "Ereditata")
          : el("span.badge.badge-red", "Da mettere")),

      el("div.small.mute-2",
        "Gli schieramenti si chiudono da soli all'inizio del torneo, ",
        el("span.mono", oraLocale(slot.start)), "."),

      inherited && el("div.notice",
        `Questa è la formazione della giornata ${eff.inheritedFrom || slot.n - 1}. `
        + "Vale così com'è anche se non tocchi niente: confermala o cambiala."),

      el("div.small.muted",
        need > 0 ? `Mancano ${need} titolari.`
        : need < 0 ? `Hai ${-need} titolari di troppo.`
        : draft.captain ? "Formazione completa." : "Manca il capitano."),
    ),

    section(`Titolari (${starters.length}/${league.lineupSize})`,
      starters.length
        ? el("div.plist", starters.map((pid) => row(ctx, byId.get(pid), {
            picked: true,
            captain: draft.captain === pid,
            onToggle: () => toggle(pid),
            onCaptain: () => setDraft({ ...draft, starters, bench, captain: pid }),
          })))
        : el("div.card.card-tight.center.mute-2.small", "Scegli i titolari dalla panchina"),
    ),

    section(`Panchina (${bench.length}) — in ordine di ingresso`,
      bench.length
        ? el("div.plist", bench.map((pid, i) => row(ctx, byId.get(pid), {
            picked: false,
            benchIndex: i,
            onToggle: () => toggle(pid),
            onUp: i > 0 ? () => moveBench(pid, -1) : null,
            onDown: i < bench.length - 1 ? () => moveBench(pid, +1) : null,
          })))
        : el("div.card.card-tight.center.mute-2.small", "Nessuno in panchina"),
    ),

    el("div.card.card-tight.row", { style: "position:sticky;bottom:.6rem;z-index:5" },
      el("button.btn.btn-primary", {
        style: "flex:1",
        disabled: !dirty || starters.length !== league.lineupSize || !draft.captain,
        onclick: save,
      }, inherited && !changed ? "Conferma formazione"
         : dirty ? "Salva formazione" : "Formazione salvata"),
      changed && eff && el("button.btn.btn-ghost", {
        onclick: () => { drafts.delete(slot.n); ctx.refresh(); },
      }, "Annulla modifiche"),
    ),
  );
}

/* -------------------------------- pezzi -------------------------------- */

function chiusa(ctx, plan, mine) {
  const inCorso = plan.slots.find((s) => s.status === "pending");
  const finita = plan.done >= plan.total;

  return el("div.stack",
    el("div.card.stack",
      el("h2", finita ? "Stagione conclusa"
        : inCorso ? `Giornata ${inCorso.n} in corso`
        : "Nessuna giornata aperta"),
      el("p.muted", { style: "margin:0" },
        finita
          ? `Le ${plan.total} giornate sono finite. La classifica è definitiva.`
          : inCorso
            ? "Gli schieramenti si sono chiusi all'inizio del torneo. "
              + "La prossima giornata si apre appena arrivano i risultati."
            : "Si riapre in vista del prossimo martedì."),
      el("button.btn.btn-primary", {
        onclick: () => ctx.go(`#/l/${ctx.league.id}/giornate`),
      }, "Vedi il calendario"),
    ),
    ultimaFormazione(ctx, mine, plan),
  );
}

function ultimaFormazione(ctx, mine, plan) {
  for (let n = plan.total; n >= 1; n--) {
    const lu = effectiveLineup(ctx.matchdays, n, ctx.uid);
    if (!lu) continue;
    const byId = new Map(mine.map((r) => [r.playerId, r.player]));
    return el("section",
      el("div.section-head", el("h2", "La tua ultima formazione")),
      el("div.plist", (lu.starters || []).map((pid) => {
        const p = byId.get(pid);
        return p && el("div.pcard",
          el("div.pav", { style: "display:grid;place-items:center" }, "♟"),
          el("div.pmain", el("div.pname",
            el("span", p.name),
            lu.captain === pid && el("span.badge.badge-gold", "C"))),
          el("div.pright.small.mute-2", String(p.rating)),
        );
      })),
    );
  }
  return null;
}

function section(title, body) {
  return el("section", el("div.section-head", el("h2", title)), body);
}

function row(ctx, p, o) {
  if (!p) return null;
  return el("div.pcard.pcard-split", { class: o.picked ? "is-picked" : "" },
    el("button.pcard-main", { type: "button", onclick: () => showPlayer(ctx, p) },
      p.avatar
        ? el("img.pav", { src: p.avatar, alt: "", loading: "lazy" })
        : el("div.pav", { style: "display:grid;place-items:center" }, "♟"),
      el("div.pmain",
        el("div.pname",
          p.title && el("span.title-tag", { class: p.title.toLowerCase() }, p.title),
          el("span", p.name),
          o.captain && el("span.badge.badge-gold", "C")),
        el("div.pmeta",
          flag(p.country) && el("span", flag(p.country)),
          el("span", `${p.rating} blitz`),
          p.window ? el("span", { class: presenceClass(p) },
            `presente ${p.events}/${p.window}`) : null,
          o.benchIndex !== undefined && el("span", `${o.benchIndex + 1}ª riserva`)),
      ),
    ),
    el("div.row.pcard-side", { style: "gap:.25rem;flex-wrap:nowrap" },
      o.onUp !== undefined && el("div.stack-s", { style: "gap:.15rem" },
        el("button.btn.btn-sm.btn-ghost", {
          type: "button", disabled: !o.onUp, onclick: o.onUp,
          "aria-label": "Sposta su", style: "padding:.15rem .4rem",
        }, "▲"),
        el("button.btn.btn-sm.btn-ghost", {
          type: "button", disabled: !o.onDown, onclick: o.onDown,
          "aria-label": "Sposta giù", style: "padding:.15rem .4rem",
        }, "▼"),
      ),
      o.picked && el("button.btn.btn-sm", {
        type: "button", onclick: o.onCaptain, disabled: o.captain,
        "aria-label": "Nomina capitano",
      }, o.captain ? "Capitano" : "C"),
      el("button.btn.btn-sm", {
        type: "button", onclick: o.onToggle,
      }, o.picked ? "Panchina" : "Schiera"),
    ),
  );
}

/** Formazione di partenza: quella valida, o i più costosi come titolari. */
function normalize(saved, mine, lineupSize) {
  const ids = mine.map((r) => r.playerId);
  if (saved?.starters?.length) {
    const starters = saved.starters.filter((id) => ids.includes(id));
    const bench = (saved.bench || []).filter((id) => ids.includes(id) && !starters.includes(id));
    const rest = ids.filter((id) => !starters.includes(id) && !bench.includes(id));
    return { starters, bench: [...bench, ...rest], captain: saved.captain || null };
  }
  const starters = ids.slice(0, lineupSize);
  return { starters, bench: ids.slice(lineupSize), captain: starters[0] || null };
}

function oraLocale(ms) {
  return new Date(ms).toLocaleString("it-IT", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}
