/**
 * Prova la partenza dell'asta live programmata, contro l'emulatore.
 *
 *     firebase emulators:start --only firestore
 *     node functions/test-avvio.mjs
 *
 * Contro l'emulatore e non a tavolino perche' in mezzo c'e' una
 * transazione: due che fanno partire la stessa asta nello stesso istante
 * (il browser di chi guarda e la funzione) devono produrne una sola.
 */

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ||= "fantascacchi-cdcca";

const { getFirestore } = await import("firebase-admin/firestore");
const { initializeApp } = await import("firebase-admin/app");
initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = getFirestore();

const { avviaAstaLive } = await import("./condiviso/league.js");

let ko = 0;
const ok = (n, c, e = "") => {
  console.log(`${c ? "  ok  " : "  KO  "} ${n}${c ? "" : "  <- " + e}`);
  if (!c) ko++;
};

const M = (uid, name, t) => ({ uid, name, joinedAt: t });

async function semina(id, patch = {}) {
  const ref = db.collection("leagues").doc(id);
  await db.recursiveDelete(ref).catch(() => {});
  await ref.set({
    id, name: "Fantascacchi", adminUid: "u1",
    budget: 500, rosterSize: 8, lineupSize: 5,
    bidSeconds: 20, turnSeconds: 60,
    phase: "lobby", auctionMode: "live",
    members: { u1: M("u1", "Jacopo", 1), u2: M("u2", "Bea", 2) },
    memberUids: ["u1", "u2"],
    roster: {}, customPlayers: {},
    auction: { status: "idle", playerId: null, bid: 0, bidderUid: null,
               endsAt: 0, turnIdx: 0, turnEndsAt: 0 },
    season: { startsAt: 0, matchdays: 10 },
    scheduledStart: 0,
    ...patch,
  });
  return ref;
}

const leggi = async (ref) => (await ref.get()).data();

/** La stessa transazione della Cloud Function, isolata per la prova. */
async function facciaPartire(ref) {
  let partita = false;
  await db.runTransaction(async (tx) => {
    partita = false;
    const fresco = (await tx.get(ref)).data();
    if (!fresco?.scheduledStart || Date.now() < fresco.scheduledStart) return;
    const next = avviaAstaLive(fresco);
    if (!next) return;
    tx.set(ref, next);
    partita = true;
  });
  return partita;
}

/* ---------------- 1. l'appuntamento scaduto fa partire l'asta ----------- */
{
  const ref = await semina("a1", { scheduledStart: Date.now() - 5000 });
  const partita = await facciaPartire(ref);
  const lg = await leggi(ref);
  ok("l'orario e' passato: l'asta parte", partita === true);
  ok("la fase diventa asta", lg.phase === "auction", lg.phase);
  ok("il primo turno ha una scadenza", lg.auction.turnEndsAt > Date.now(),
    String(lg.auction.turnEndsAt));
  ok("l'appuntamento si consuma", lg.scheduledStart === 0, String(lg.scheduledStart));
}

/* ---------------- 2. prima dell'ora non succede niente ------------------ */
{
  const ref = await semina("a2", { scheduledStart: Date.now() + 3600_000 });
  const partita = await facciaPartire(ref);
  const lg = await leggi(ref);
  ok("prima dell'ora non parte", partita === false);
  ok("e resta in sala d'attesa", lg.phase === "lobby", lg.phase);
}

/* ------------- 3. due partenze insieme: una sola deve passare ----------- */
{
  const ref = await semina("a3", { scheduledStart: Date.now() - 1000 });
  const esiti = await Promise.all([facciaPartire(ref), facciaPartire(ref)]);
  const lg = await leggi(ref);
  ok("due partenze insieme: una sola passa",
    esiti.filter(Boolean).length === 1, JSON.stringify(esiti));
  ok("il turno non viene azzerato due volte", lg.auction.turnIdx === 0,
    String(lg.auction.turnIdx));
}

/* ------------- 4. asta gia' partita: l'appuntamento non la tocca -------- */
{
  const ref = await semina("a4", {
    scheduledStart: Date.now() - 1000, phase: "auction",
    auction: { status: "running", playerId: "hikaru", bid: 40, bidderUid: "u2",
               endsAt: Date.now() + 15000, turnIdx: 3, turnEndsAt: 0 },
  });
  const partita = await facciaPartire(ref);
  const lg = await leggi(ref);
  ok("asta gia' in corso: non la si fa ripartire", partita === false);
  ok("il lotto in corso resta intatto",
    lg.auction.bid === 40 && lg.auction.turnIdx === 3, JSON.stringify(lg.auction));
}

console.log(ko ? `\n${ko} PROVE FALLITE` : "\nTutte le prove passate.");
process.exit(ko ? 1 : 0);
