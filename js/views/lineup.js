/* ---------------------------------------------------------------
   Formazione della giornata aperta.

   Titolari + panchina ORDINATA: se un titolare non gioca il torneo,
   entra il primo panchinaro che invece l'ha giocato. Il capitano
   raddoppia, ma solo se scende davvero in campo.
   --------------------------------------------------------------- */

import { el, toast, empty, flag, spinner } from "../ui.js";
import { rosterOf } from "../league.js";

const drafts = new Map();   // mdId -> {starters, bench, captain}
let selectedMd = null;

export default function lineupView(ctx) {
  const { league, catalog, matchdays, uid } = ctx;
  if (!catalog) return el("div.card", "Carico il listone…");

  const mine = rosterOf(league, catalog, uid);
  if (!mine.length) {
    return el("div.card.stack",
      el("h2", "Prima serve una rosa"),
      el("p.muted", { style: "margin:0" }, "Non hai ancora giocatori: passa dall'asta."),
      el("button.btn.btn-primary", { onclick: () => ctx.go(`#/l/${league.id}/asta`) }, "Vai all'asta"),
    );
  }

  const open = matchdays.filter((m) => m.status === "open");
  if (!open.length) {
    return el("div.stack",
      el("div.card.stack",
        el("h2", "Nessuna giornata aperta"),
        el("p.muted", { style: "margin:0" },
          ctx.isAdmin
            ? "Crea la prossima giornata scegliendo un Titled Tuesday."
            : "Aspetta che chi gestisce la lega apra la prossima giornata."),
        ctx.isAdmin && el("button.btn.btn-primary", {
          onclick: () => ctx.go(`#/l/${league.id}/giornate`),
        }, "Vai alle giornate"),
      ),
      lastLineup(ctx, mine),
    );
  }

  const md = open.find((m) => m.id === selectedMd) || open[0];
  selectedMd = md.id;

  const saved = md.lineups?.[uid] || null;
  // Ereditata dalla giornata precedente: vale come rete di sicurezza, ma
  // finche' non la confermi va segnalata come da rivedere.
  const inherited = Boolean(saved?.inherited);
  const draft = drafts.get(md.id) || normalize(saved, mine, league.lineupSize);
  drafts.set(md.id, draft);

  const byId = new Map(mine.map((r) => [r.playerId, r.player]));
  const starters = draft.starters.filter((id) => byId.has(id));
  const bench = draft.bench.filter((id) => byId.has(id));
  const need = league.lineupSize - starters.length;

  const setDraft = (next) => { drafts.set(md.id, next); ctx.refresh(); };

  function toggle(pid) {
    const inStarters = starters.includes(pid);
    if (inStarters) {
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
      await ctx.store.setLineup(league.id, md.id, uid, {
        starters, bench, captain: draft.captain,
      });
      toast("Formazione salvata", "ok");
    } catch (err) {
      toast(err.message || "Salvataggio non riuscito", "err");
    }
  }

  const changed = !saved
    || saved.captain !== draft.captain
    || saved.starters.join() !== starters.join()
    || saved.bench.join() !== bench.join();
  // Anche invariata, una formazione ereditata resta da confermare.
  const dirty = changed || inherited;

  return el("div.stack", { style: "gap:1.4rem" },
    open.length > 1 && el("div.row",
      el("span.small.muted", "Giornata:"),
      el("select", {
        style: "width:auto",
        onchange: (e) => { selectedMd = e.target.value; ctx.refresh(); },
      }, open.map((m) => el("option", { value: m.id, selected: m.id === md.id }, m.label || m.id))),
    ),

    el("div.card.card-hi.stack-s",
      el("div.spread",
        el("div",
          el("h2", md.label || "Giornata"),
          el("div.small.muted", "Titled Tuesday · schieramenti aperti")),
        inherited ? el("span.badge.badge-gold", "Ereditata")
          : saved ? el("span.badge.badge-green", "Salvata")
          : el("span.badge.badge-red", "Da salvare"),
      ),
      inherited && el("div.notice",
        "Questa è la formazione della giornata precedente",
        saved.inheritedFrom ? ` (${saved.inheritedFrom})` : "",
        ". Vale così com'è se non tocchi niente — controlla solo che ti convinca ancora, poi confermala."),

      el("div.small.muted",
        need > 0 ? `Mancano ${need} titolari.`
        : need < 0 ? `Hai ${-need} titolari di troppo.`
        : draft.captain ? "Formazione completa." : "Manca il capitano.",
      ),
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
        style: "flex:1", disabled: !dirty || starters.length !== league.lineupSize || !draft.captain,
        onclick: save,
      }, inherited && !changed ? "Conferma formazione"
         : dirty ? "Salva formazione" : "Formazione salvata"),
      saved && changed && el("button.btn.btn-ghost", {
        onclick: () => { drafts.delete(md.id); ctx.refresh(); },
      }, "Annulla modifiche"),
    ),
  );
}

/* -------------------------------- pezzi -------------------------------- */

function section(title, body) {
  return el("section", el("div.section-head", el("h2", title)), body);
}

function row(ctx, p, o) {
  if (!p) return null;
  return el("div.pcard", { class: o.picked ? "is-picked" : "" },
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
        o.benchIndex !== undefined && el("span", `${o.benchIndex + 1}ª riserva`)),
    ),
    el("div.row", { style: "gap:.25rem;flex-wrap:nowrap" },
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

/** Formazione di partenza: quella salvata, o i piu' costosi come titolari. */
function normalize(saved, mine, lineupSize) {
  const ids = mine.map((r) => r.playerId);
  if (saved) {
    const starters = (saved.starters || []).filter((id) => ids.includes(id));
    const bench = (saved.bench || []).filter((id) => ids.includes(id) && !starters.includes(id));
    const rest = ids.filter((id) => !starters.includes(id) && !bench.includes(id));
    return { starters, bench: [...bench, ...rest], captain: saved.captain || null };
  }
  const starters = ids.slice(0, lineupSize);
  return { starters, bench: ids.slice(lineupSize), captain: starters[0] || null };
}

/** Riepilogo dell'ultima formazione salvata, quando non c'e' nulla di aperto. */
function lastLineup(ctx, mine) {
  const md = ctx.matchdays.find((m) => m.lineups?.[ctx.uid]);
  if (!md) return null;
  const lu = md.lineups[ctx.uid];
  const byId = new Map(mine.map((r) => [r.playerId, r.player]));
  return el("section",
    el("div.section-head", el("h2", "Ultima formazione"), el("span.small.muted", md.label || "")),
    el("div.plist", (lu.starters || []).map((pid) => {
      const p = byId.get(pid);
      return p && el("div.pcard",
        el("div.pav", { style: "display:grid;place-items:center" }, "♟"),
        el("div.pmain", el("div.pname",
          el("span", p.name),
          lu.captain === pid && el("span.badge.badge-gold", "C"))),
        el("div.pright.small.mute-2", `${p.rating}`),
      );
    })),
  );
}
