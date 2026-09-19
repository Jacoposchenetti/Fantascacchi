import { el, toast, confirmDialog, modal, copy, fmtPts } from "../ui.js";

/** Come confirmDialog ma chiede di scrivere qualcosa. null = annullato. */
function promptDialog(title, text) {
  return new Promise((resolve) => {
    let risposto = false;
    modal((close) => {
      const form = el("form.stack", {
        onsubmit: (e) => {
          e.preventDefault();
          risposto = true;
          const v = new FormData(form).get("v");
          close();
          resolve(String(v ?? ""));
        },
      },
        el("h2", title),
        text && el("p.muted.small", { style: "margin:0" }, text),
        el("input", { type: "text", name: "v", autofocus: true, autocomplete: "off" }),
        el("div.row", { style: "justify-content:flex-end" },
          el("button.btn.btn-ghost", { type: "button",
            onclick: () => { risposto = true; close(); resolve(null); } }, "Annulla"),
          el("button.btn.btn-danger", { type: "submit" }, "Conferma"),
        ),
      );
      return form;
    });
    const dlg = document.querySelector("#modal");
    const onClose = () => {
      dlg.removeEventListener("close", onClose);
      if (!risposto) resolve(null);
    };
    dlg.addEventListener("close", onClose);
  });
}
import { regole } from "../scoring.js";
import { daBroadcast, parole } from "../fonte.js";
import { AUCTION_MODES, DEFAULTS } from "../config.js";
import { campiModo, applicaCampiModo, notaModo } from "./modeparams.js";
import { members, memberName, ownedCount, inviteLink } from "../league.js";
import { fetchProfile } from "../chesscom.js";
import { showInvite } from "./invite.js";

export default function settingsView(ctx) {
  const { league, store, uid } = ctx;
  const auctionStarted = Object.keys(league.roster || {}).length > 0;

  return el("div.stack", { style: "gap:1.5rem" },

    /* ------------------------------ invito ----------------------------- */
    el("section",
      el("div.section-head", el("h2", "Invito")),
      el("div.card.stack-s",
        el("div.copyfield",
          el("input", { type: "text", readonly: true, value: inviteLink(league.id),
            onclick: (e) => e.target.select() }),
          el("button.btn.btn-sm", { onclick: () => copy(inviteLink(league.id)) }, "Copia")),
        el("button.btn.btn-sm.btn-ghost", { onclick: () => showInvite(league) }, "Altre opzioni"),
      ),
    ),

    /* --------------------------- partecipanti -------------------------- */
    el("section",
      el("div.section-head", el("h2", "Partecipanti"),
        el("span.small.muted", `${members(league).length}`)),
      el("div.plist", members(league).map((m) => el("div.pcard",
        el("div.pav", { style: "display:grid;place-items:center" }, m.name[0]?.toUpperCase() || "?"),
        el("div.pmain",
          el("div.pname", el("span", m.name),
            m.uid === league.adminUid && el("span.badge.badge-gold", "Admin"),
            m.uid === uid && el("span.badge", "Tu")),
          el("div.pmeta", el("span", `${ownedCount(league, m.uid)}/${league.rosterSize} in rosa`))),
        ctx.isAdmin && m.uid !== league.adminUid && el("button.btn.btn-sm.btn-danger", {
          onclick: () => removeMember(ctx, m),
        }, "Rimuovi"),
      ))),
    ),

    /* --------------------------- regolamento --------------------------- */
    el("section",
      el("div.section-head", el("h2", "Come si fanno i punti")),
      el("div.card",
        el("dl.kv", ...vociPunteggio(league)),
        el("p.small.mute-2", { style: "margin:.8rem 0 0" },
          "I bonus piazzamento non si sommano: vale solo il più alto. ",
          "Il capitano raddoppia solo se gioca davvero. ",
          "Lo scontro diretto scatta quando due scacchisti schierati da "
          + "partecipanti diversi si incontrano al tavolo: se sono entrambi tuoi "
          + "non conta niente. L'impresa scatta contro chiunque nel torneo: "
          + "ogni partita vinta contro un avversario molto più forte vale il "
          + "primo scaglione che scatta, fino al tetto di giornata."),
      ),
    ),

    /* ------------------------- impostazioni lega ----------------------- */
    ctx.isAdmin && el("section",
      el("div.section-head", el("h2", "Impostazioni")),
      el("div.card", leagueForm(ctx, auctionStarted)),
    ),

    /* ----------------------- giocatori fuori listone ------------------- */
    ctx.isAdmin && el("section",
      el("div.section-head", el("h2", "Aggiungi un giocatore")),
      el("div.card.stack-s",
        el("p.muted.small", { style: "margin:0" },
          "Serve qualcuno che non è nel listone? Aggiungilo col suo username chess.com."),
        el("button.btn.btn-sm", { onclick: () => addPlayer(ctx) }, "Cerca su chess.com"),
        Object.keys(league.customPlayers || {}).length > 0 && el("div.small.muted",
          "Aggiunti: ",
          Object.values(league.customPlayers).map((p) => p.name).join(", ")),
      ),
    ),

    /* ----------------------------- account ----------------------------- */
    store.needsAuth && el("section",
      el("div.section-head", el("h2", "Account")),
      el("div.card.stack-s",
        el("div.spread",
          el("div",
            el("strong", store.me.name),
            store.me.email && el("div.small.mute-2", store.me.email),
            store.me.anonymous && el("div.small", { style: "color:var(--red)" },
              "Accesso anonimo: se svuoti il browser perdi la rosa.")),
          store.me.photo && el("img.pav", { src: store.me.photo, alt: "" })),
        el("button.btn.btn-sm.btn-ghost", {
          onclick: async () => {
            if (await confirmDialog("Uscire dall'account?",
              "Potrai rientrare con lo stesso account e ritrovare le tue leghe.", "Esci")) {
              await store.signOut();
              ctx.go("#/");
            }
          },
        }, "Esci"),
      ),
    ),

    /* -------------------------- zona pericolosa ------------------------ */
    ctx.isAdmin && el("section",
      el("div.section-head", el("h2", "Zona pericolosa")),
      el("div.card.stack-s", { style: "border-color:var(--red)" },
        el("p.muted.small", { style: "margin:0" },
          "Riporta tutti in sala d'attesa e svuota le rose, come se l'asta "
          + "non fosse mai iniziata. I crediti tornano pieni. "
          + "Giornate e punteggi già calcolati non vengono toccati."),
        el("button.btn.btn-sm.btn-danger", { onclick: () => restartAuction(ctx) },
          "Ricomincia l'asta da capo"),

        el("hr", { style: "border:0;border-top:1px solid var(--line);margin:.3rem 0" }),

        el("p.muted.small", { style: "margin:0" },
          "Cancella la lega per tutti: rose, formazioni, giornate e "
          + "classifica spariscono e non tornano. Gli altri partecipanti "
          + "se la ritrovano sparita."),
        el("button.btn.btn-sm.btn-danger", { onclick: () => deleteLeague(ctx) },
          "Elimina la lega"),
      ),
    ),

    /* ------------------------------ dati ------------------------------- */
    el("section",
      el("div.section-head", el("h2", "Dati")),
      el("div.card.stack-s",
        el("p.muted.small", { style: "margin:0" },
          `Modalità: ${store.mode === "firebase" ? "online (Firebase)" : "locale (solo questo browser)"}.`),
        el("div.row",
          el("button.btn.btn-sm", { onclick: () => exportLeague(ctx) }, "Esporta backup"),
          ctx.isAdmin && el("button.btn.btn-sm.btn-ghost", { onclick: () => importLeague(ctx) }, "Importa backup"),
        ),
      ),
    ),
  );
}

/**
 * Le voci del regolamento, che cambiano con la fonte.
 *
 * Una lega su un torneo classico non ha "ogni punto nel torneo ×3": ha una
 * partita sola per giornata, che finisce in tre modi. Mostrare la tabella
 * dei Titled Tuesday a chi gioca i Candidati vorrebbe dire spiegargli un
 * regolamento che non e' il suo.
 */
function vociPunteggio(league) {
  const r = regole(league);
  const p = parole(league);

  if (r.modo === "turno") {
    return [
      kv("Vittoria", fmtPts(r.win)),
      kv("Patta", fmtPts(r.draw)),
      kv("Sconfitta", fmtPts(r.loss)),
      kv("Vittoria col nero", fmtPts(r.neroBonus)),
      kv("In testa al torneo", fmtPts(r.leader)),
      kv("Fra i primi tre", fmtPts(r.podio)),
      kv("Capitano", `×${r.captainMultiplier}`),
      kv("Non gioca il turno", "entra la panchina"),
      kv("Batte un avversario di lega", fmtPts(r.duelWin)),
      kv("Perde contro un avversario di lega", fmtPts(r.duelLoss)),
      kv("Patta fra i due", fmtPts(r.duelDraw)),
      ...r.upset.map((t) => kv(`Batte uno +${t.gap} di rating`, fmtPts(t.bonus))),
    ];
  }

  const alta = r.strongRatio != null
    ? `Almeno il ${Math.round(r.strongRatio * 100)}% dei punti`
    : `Almeno ${r.strongScoreMin} punti`;
  const bassa = r.weakRatio != null
    ? `Sotto il ${Math.round(r.weakRatio * 100)}% dei punti`
    : `Sotto ${r.weakScoreMax} punti`;

  return [
    kv("Ogni punto nel torneo", `×${r.perPoint}`),
    ...r.placement.map((t) => kv(
      t.max === 1 ? "Vittoria del torneo"
        : t.max <= 3 ? `${t.max}° posto`
        : `Top ${t.max}`,
      fmtPts(t.bonus))),
    kv("En plein", fmtPts(r.perfectScore)),
    kv(alta, fmtPts(r.strongScore)),
    kv(bassa, fmtPts(r.weakScore)),
    kv("Capitano", `×${r.captainMultiplier}`),
    kv("Non ha giocato", "entra la panchina"),
    kv("Batte un avversario di lega", fmtPts(r.duelWin)),
    kv("Perde contro un avversario di lega", fmtPts(r.duelLoss)),
    kv("Patta fra i due", fmtPts(r.duelDraw)),
    ...r.upset.map((t) => kv(`Batte uno +${t.gap} di rating`, fmtPts(t.bonus))),
    kv(`Tetto imprese per ${p.giornata}`, fmtPts(r.upsetCap)),
  ];
}

const kv = (k, v) => [el("dt", k), el("dd", v)];

/* ------------------------------- form lega ----------------------------- */

let modoScelto = null;
let modoSceltoLega = null;

function leagueForm(ctx, auctionStarted) {
  const { league } = ctx;
  // Riparti dalla modalità vera quando cambi lega o quando l'asta è partita.
  if (modoScelto === null || modoSceltoLega !== league.id || auctionStarted) {
    modoScelto = league.auctionMode || "live";
    modoSceltoLega = league.id;
  }
  const form = el("form.stack", {
    onsubmit: async (ev) => {
      ev.preventDefault();
      const f = new FormData(form);
      const roster = Number(f.get("roster"));
      const lineup = Number(f.get("lineup"));
      if (lineup >= roster) { toast("I titolari devono essere meno dei giocatori in rosa", "err"); return; }
      await ctx.mutate((lg) => {
        lg.name = String(f.get("name")).trim() || lg.name;
        lg.budget = Number(f.get("budget"));
        lg.rosterSize = roster;
        lg.lineupSize = lineup;
        lg.season = { ...(lg.season || {}), matchdays: Number(f.get("giornate")) };
        if (!auctionStarted && f.get("modo")) lg.auctionMode = String(f.get("modo"));
        applicaCampiModo(lg, f);
        return lg;
      });
      toast("Impostazioni salvate", "ok");
    },
  },
    el("label.field", "Nome della lega",
      el("input", { type: "text", name: "name", value: league.name, maxlength: 40 })),

    el("div.row",
      el("div", { style: "flex:1;min-width:110px" }, el("label.field", "Crediti",
        el("input", { type: "number", name: "budget", value: league.budget, min: 100, max: 2000, step: 10 }))),
      el("div", { style: "flex:1;min-width:90px" }, el("label.field", "Rosa",
        el("input", { type: "number", name: "roster", value: league.rosterSize, min: 3, max: 20 }))),
      el("div", { style: "flex:1;min-width:90px" }, el("label.field", "Titolari",
        el("input", { type: "number", name: "lineup", value: league.lineupSize, min: 1, max: 15 }))),
    ),

    el("div.row",
      el("div", { style: "flex:1;min-width:150px" },
        el("label.field", "Durata della stagione, in giornate",
          el("input", { type: "number", name: "giornate",
            value: league.season?.matchdays || 10, min: 1, max: 52 }))),
      el("div", { style: "flex:1;min-width:150px" },
        el("label.field", "Modalità" + (auctionStarted ? " (bloccata: asta iniziata)" : ""),
          el("select", {
            name: "modo", disabled: auctionStarted,
            onchange: (e) => { modoScelto = e.target.value; ctx.refresh(); },
          }, AUCTION_MODES.map((m) => el("option", {
            value: m.id, selected: m.id === modoScelto,
          }, m.nome))))),
    ),

    // Solo i parametri della modalità scelta.
    campiModo(modoScelto, modoScelto === (league.auctionMode || "live") ? league : {}),

    el("p.small.mute-2", { style: "margin:0" },
      (daBroadcast(league)
        ? "La stagione è il calendario del torneo: dura quanto lui. "
        : "La stagione sono i primi N Titled Tuesday dopo la chiusura "
          + "dell'asta (dieci ≈ due mesi e mezzo). ")
      + notaModo(modoScelto)),

    auctionStarted && el("div.notice.warn",
      "L'asta è già iniziata: abbassare i crediti o la rosa può mandare qualcuno in negativo. "
      + "Le rose già assegnate non vengono toccate."),

    el("button.btn.btn-primary", { type: "submit" }, "Salva"),
  );
  return form;
}

/* ------------------------------- azioni -------------------------------- */

async function removeMember(ctx, m) {
  const owned = ownedCount(ctx.league, m.uid);
  const ok = await confirmDialog(
    `Rimuovere ${m.name}?`,
    owned ? `I suoi ${owned} giocatori tornano liberi.` : "Non ha giocatori in rosa.",
    "Rimuovi",
  );
  if (!ok) return;
  await ctx.mutate((lg) => {
    delete lg.members[m.uid];
    for (const [pid, r] of Object.entries(lg.roster || {})) {
      if (r.ownerUid === m.uid) delete lg.roster[pid];
    }
    if (lg.auction?.bidderUid === m.uid) {
      lg.auction = { ...lg.auction, status: "idle", playerId: null, bid: 0, bidderUid: null, endsAt: 0 };
    }
    return lg;
  });
  toast(`${m.name} rimosso`);
}

function addPlayer(ctx) {
  modal((close) => {
    const form = el("form.stack", { onsubmit: submit },
      el("h2", "Aggiungi un giocatore"),
      el("label.field", "Username chess.com",
        el("input", { type: "text", name: "u", required: true, autofocus: true,
          placeholder: "es. magnuscarlsen", autocapitalize: "off", spellcheck: false })),
      el("div.row", { style: "justify-content:flex-end" },
        el("button.btn.btn-ghost", { type: "button", onclick: close }, "Annulla"),
        el("button.btn.btn-primary", { type: "submit" }, "Cerca")),
    );

    async function submit(ev) {
      ev.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true; btn.textContent = "Cerco…";
      try {
        const p = await fetchProfile(String(new FormData(form).get("u")));
        // Prezzo indicativo dal rating, in linea con la scala del listone.
        p.price = Math.max(6, Math.min(150, Math.round((p.rating - 2400) / 6)));
        await ctx.mutate((lg) => {
          lg.customPlayers = { ...(lg.customPlayers || {}), [p.id]: p };
          return lg;
        });
        close();
        toast(`${p.name} aggiunto al listone (${p.price} cr)`, "ok");
      } catch (err) {
        toast(err.message, "err");
        btn.disabled = false; btn.textContent = "Cerca";
      }
    }
    return form;
  });
}

async function deleteLeague(ctx) {
  const nome = ctx.league.name;
  const parti = Object.keys(ctx.league.members || {}).length;

  const ok = await confirmDialog(
    `Eliminare "${nome}"?`,
    `Tutto quello che c'è dentro sparisce per ${parti === 1 ? "te" : `tutti e ${parti}`}, `
    + "e non si può recuperare. Se ti serve una copia, scarica prima il backup.",
    "Elimina per sempre",
  );
  if (!ok) return;

  // Seconda conferma a prova di clic distratto: si scrive il nome.
  const conferma = await promptDialog(
    "Ultima conferma",
    `Scrivi "${nome}" per confermare.`,
  );
  if (conferma == null) return;
  if (conferma.trim() !== nome) {
    toast("Il nome non corrisponde: eliminazione annullata", "err");
    return;
  }

  try {
    const id = ctx.league.id;
    await ctx.store.deleteLeague(id);
    toast("Lega eliminata", "ok");
    ctx.go("#/");
  } catch (err) {
    toast(err.message || "Non sono riuscito a eliminarla", "err");
  }
}

async function restartAuction(ctx) {
  const n = Object.keys(ctx.league.roster || {}).length;
  const ok = await confirmDialog(
    "Ricominciare l'asta da capo?",
    n ? `I ${n} giocatori già assegnati tornano liberi e tutte le rose si svuotano. `
        + "Non si può annullare."
      : "Si torna in sala d'attesa.",
    "Ricomincia",
  );
  if (!ok) return;
  await ctx.mutate((lg) => {
    lg.phase = "lobby";
    lg.roster = {};
    lg.auction = {
      status: "idle", playerId: null, bid: 0, bidderUid: null,
      endsAt: 0, turnIdx: 0, turnEndsAt: 0,
      pausedBy: null, pausedAt: 0, releasedPlayer: null,
    };
    return lg;
  });
  toast("Asta azzerata: siete tornati in sala d'attesa", "ok");
}

async function exportLeague(ctx) {
  const dump = await ctx.store.exportLeague(ctx.league.id);
  const blob = new Blob([JSON.stringify(dump, null, 1)], { type: "application/json" });
  const a = el("a", {
    href: URL.createObjectURL(blob),
    download: `fantascacchi-${ctx.league.id}-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("Backup scaricato", "ok");
}

function importLeague(ctx) {
  const input = el("input", { type: "file", accept: "application/json,.json" });
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const dump = JSON.parse(await file.text());
      const ok = await confirmDialog("Sovrascrivere la lega?",
        `Il backup di "${dump.league?.name}" sostituirà i dati attuali.`, "Importa");
      if (!ok) return;
      const id = await ctx.store.importLeague(dump);
      toast("Backup importato", "ok");
      ctx.go(`#/l/${id}/asta`);
    } catch (err) {
      toast("File non valido: " + err.message, "err");
    }
  };
  input.click();
}
