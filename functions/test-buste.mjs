/**
 * Prova la chiusura d'ufficio dei giri di buste chiuse contro l'emulatore
 * Firestore.
 *
 *     firebase emulators:start --only firestore
 *     node functions/test-buste.mjs
 *
 * Perche' contro l'emulatore e non a tavolino: qui in mezzo c'e' una
 * transazione, e proprio la transazione e' quello che deve impedire a due
 * risolutori di assegnare lo stesso giocatore due volte. Simularla non
 * proverebbe la cosa che conta.
 */

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ||= "fantascacchi-cdcca";

// index.js fa gia' initializeApp() al caricamento: va importato per primo,
// altrimenti si litiga su quale app e' quella predefinita.
const { risolviBusteScadute } = await import("./index.js");
const { getFirestore } = await import("firebase-admin/firestore");
const db = getFirestore();

let ko = 0;
const ok = (nome, cond, extra = "") => {
  console.log(`${cond ? "  ok  " : "  KO  "} ${nome}${cond ? "" : "  <- " + extra}`);
  if (!cond) ko++;
};

const M = (uid, name, t) => ({ uid, name, joinedAt: t });

async function semina(id, patch = {}, buste = {}) {
  const ref = db.collection("leagues").doc(id);
  await db.recursiveDelete(ref).catch(() => {});
  await ref.set({
    id, name: "Fantascacchi", adminUid: "u1",
    budget: 500, rosterSize: 3, lineupSize: 2,
    sealedSkipLimit: 2, sealedHours: 24,
    phase: "auction", auctionMode: "sealed",
    members: {
      u1: M("u1", "Jacopo", 1),
      u2: M("u2", "MangioCarloLaCapra", 2),
    },
    memberUids: ["u1", "u2"],
    roster: {}, customPlayers: {},
    season: { startsAt: 0, matchdays: 10 },
    sealed: { giro: 1, scadenza: Date.now() - 60_000, saltati: {},
              hannoOfferto: [], ultimoRisultato: [], risoltoIl: 0 },
    ...patch,
  });
  for (const [uid, doc] of Object.entries(buste)) {
    await ref.collection("bids").doc(uid).set(doc);
  }
  return ref;
}

const leggi = async (ref) => (await ref.get()).data();
const rosaDi = (lg, uid) =>
  Object.values(lg.roster || {}).filter((r) => r.ownerUid === uid);

/* ------------------- 1. un giro scaduto si chiude da solo ---------------- */
{
  const ref = await semina("t1", {}, {
    u1: { uid: "u1", at: Date.now(), bids: { hikaru: { amount: 90, at: Date.now() } } },
    u2: { uid: "u2", at: Date.now(), bids: { mishanick: { amount: 80, at: Date.now() } } },
  });
  const chiuso = await risolviBusteScadute(db, await leggi(ref), "t1", Date.now());
  const lg = await leggi(ref);
  ok("chiude il giro scaduto senza che nessuno apra l'app", chiuso === true);
  ok("assegna a chi ha offerto",
    rosaDi(lg, "u1").length === 1 && rosaDi(lg, "u2").length === 1,
    JSON.stringify(lg.roster));
  ok("al prezzo offerto", lg.roster?.hikaru?.price === 90, JSON.stringify(lg.roster?.hikaru));
  ok("apre il giro successivo", (lg.sealed?.giro || 0) === 2, String(lg.sealed?.giro));
  ok("con una scadenza nuova nel futuro", lg.sealed.scadenza > Date.now());
}

/* ------------------- 2. un giro non scaduto non si tocca ---------------- */
{
  const ref = await semina("t2", { sealed: {
    giro: 1, scadenza: Date.now() + 3600_000, saltati: {}, hannoOfferto: [],
    ultimoRisultato: [], risoltoIl: 0 } });
  const chiuso = await risolviBusteScadute(db, await leggi(ref), "t2", Date.now());
  ok("non chiude un giro ancora aperto", chiuso === false);
}

/* ------------------- 3. due risolutori insieme: uno solo vince ---------- */
{
  const ref = await semina("t3", {}, {
    u1: { uid: "u1", at: Date.now(), bids: { hikaru: { amount: 50, at: Date.now() } } },
  });
  const lg = await leggi(ref);
  const esiti = await Promise.all([
    risolviBusteScadute(db, lg, "t3", Date.now()),
    risolviBusteScadute(db, lg, "t3", Date.now()),
  ]);
  const dopo = await leggi(ref);
  ok("due risoluzioni insieme: una sola passa",
    esiti.filter(Boolean).length === 1, JSON.stringify(esiti));
  ok("il giro avanza di uno solo", (dopo.sealed?.giro || 0) === 2, String(dopo.sealed?.giro));
  ok("il giocatore non e' pagato due volte",
    Object.keys(dopo.roster || {}).length === 1, JSON.stringify(dopo.roster));
}

/* ------- 4. le buste di un giro passato non contano come presenza -------- */
{
  const vecchio = 1000;
  const ref = await semina("t4", {
    sealed: { giro: 2, scadenza: Date.now() - 60_000, saltati: {},
              hannoOfferto: [], ultimoRisultato: [], risoltoIl: Date.now() - 30_000 },
  }, {
    u1: { uid: "u1", at: Date.now(), bids: { hikaru: { amount: 40, at: Date.now() } } },
    // Rimasta da un giro precedente: non deve valere ne' come offerta ne'
    // come partecipazione, altrimenti il contatore dei salti non sale.
    u2: { uid: "u2", at: vecchio, bids: { mishanick: { amount: 99, at: vecchio } } },
  });
  await risolviBusteScadute(db, await leggi(ref), "t4", Date.now());
  const lg = await leggi(ref);
  ok("la busta vecchia non assegna niente",
    rosaDi(lg, "u2").length === 0, JSON.stringify(lg.roster));
  ok("e conta come giro saltato",
    (lg.sealed?.saltati?.u2 || 0) === 1, JSON.stringify(lg.sealed?.saltati));
}

/* ------- 5. due giri saltati: rosa d'ufficio e stagione che parte -------- */
{
  const ref = await semina("t5", {}, {
    u1: { uid: "u1", at: Date.now(), bids: { hikaru: { amount: 30, at: Date.now() } } },
  });
  // Tre giri: u1 offre sempre, u2 mai. Al secondo salto scatta l'ufficio.
  for (let i = 0; i < 3; i++) {
    const lg = await leggi(ref);
    if (lg.phase !== "auction") break;
    await ref.update({ "sealed.scadenza": Date.now() - 1000 });
    const fresco = await leggi(ref);
    await ref.collection("bids").doc("u1").set({
      uid: "u1", at: Date.now(),
      bids: { [`riempitivo${i}`]: { amount: 5, at: Date.now() } },
    });
    await risolviBusteScadute(db, fresco, "t5", Date.now());
  }
  const lg = await leggi(ref);
  ok("chi salta due giri si vede riempire la rosa",
    rosaDi(lg, "u2").length === lg.rosterSize,
    `${rosaDi(lg, "u2").length}/${lg.rosterSize}`);
  ok("i giocatori d'ufficio costano 1 credito",
    rosaDi(lg, "u2").every((r) => r.price === 1),
    JSON.stringify(rosaDi(lg, "u2").map((r) => r.price)));
  ok("e la stagione parte", lg.phase === "season", lg.phase);
}

console.log(ko ? `\n${ko} PROVE FALLITE` : "\nTutte le prove passate.");
process.exit(ko ? 1 : 0);
