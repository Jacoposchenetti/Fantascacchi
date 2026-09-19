/**
 * Prova che il server peschi dal listone GIUSTO.
 *
 *     python tools/devserver.py 8100          (in un terminale)
 *     firebase emulators:start --only firestore
 *     node functions/test-fonti.mjs
 *
 * Perche' esiste
 * --------------
 * Le buste chiuse le risolve anche il server, e quando nessuno offre
 * riempie le rose d'ufficio. Finche' i listoni erano uno solo la cosa era
 * innocua; con le leghe sui tornei classici diventa il guasto peggiore che
 * ci sia — una lega sui Candidati che si ritrova in rosa un giocatore di
 * chess.com che ai Candidati non esiste, e da quel momento prende zero
 * ogni giornata senza che si capisca perche'.
 *
 * Qui si verifica che una lega su un torneo classico riceva d'ufficio solo
 * giocatori di quel torneo.
 */

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ||= "fantascacchi-cdcca";
process.env.FANTASCACCHI_SITO ||= "http://127.0.0.1:8100";

const { risolviBusteScadute } = await import("./index.js");
const { getFirestore } = await import("firebase-admin/firestore");
const db = getFirestore();

let ko = 0;
const ok = (nome, cond, extra = "") => {
  console.log(`${cond ? "  ok  " : "  KO  "} ${nome}${cond ? "" : "  <- " + extra}`);
  if (!cond) ko++;
};

const TORNEO = "vSyxclHS";        // FIDE Grand Swiss 2025, 116 giocatori

/** Una lega a buste chiuse col giro gia' scaduto e nessuna offerta. */
function lega(id, fonte) {
  return {
    id,
    name: "prova",
    adminUid: "a",
    phase: "auction",
    auctionMode: "sealed",
    budget: 500,
    rosterSize: 2,
    lineupSize: 1,
    members: {
      a: { uid: "a", name: "Ana", joinedAt: 1, isAdmin: true },
      b: { uid: "b", name: "Bea", joinedAt: 2, isAdmin: false },
    },
    memberUids: ["a", "b"],
    roster: {},
    customPlayers: {},
    sealedHours: 12,
    // Due giri gia' saltati da entrambi: il prossimo riempie d'ufficio.
    sealed: { giro: 3, scadenza: Date.now() - 1000, ultimoRisultato: [], risoltoIl: 0,
              saltati: { a: 2, b: 2 } },
    season: { startsAt: 0, matchdays: 10 },
    ...(fonte ? { fonte } : {}),
  };
}

async function prova(nome, fonte, verifica) {
  const id = `fonti-${nome}`;
  const lg = lega(id, fonte);
  await db.collection("leagues").doc(id).set(lg);
  await risolviBusteScadute(db, lg, id, Date.now());
  const dopo = (await db.collection("leagues").doc(id).get()).data();
  await verifica(dopo);
  await db.collection("leagues").doc(id).delete();
}

/* --------------------------------- prove -------------------------------- */

const idsTorneo = new Set(
  (await (await fetch(`${process.env.FANTASCACCHI_SITO}/data/bc/${TORNEO}/index.json`))
    .json()).players.map((p) => p.id));

console.log(`\nIl torneo di prova ha ${idsTorneo.size} giocatori.\n`);

await prova("torneo", { tipo: "torneo", tour: TORNEO }, (dopo) => {
  const assegnati = Object.values(dopo.roster || {}).map((r) => r.playerId);
  ok("la rosa si riempie d'ufficio", assegnati.length > 0,
    "nessun giocatore assegnato");
  ok("e solo con giocatori di quel torneo",
    assegnati.length > 0 && assegnati.every((p) => idsTorneo.has(p)),
    assegnati.filter((p) => !idsTorneo.has(p)).join(", "));
  ok("che hanno la forma di un id FIDE",
    assegnati.every((p) => /^(fide|nome):/.test(p)), assegnati.join(", "));
});

await prova("tt", null, (dopo) => {
  const assegnati = Object.values(dopo.roster || {}).map((r) => r.playerId);
  ok("una lega senza fonte resta sui Titled Tuesday", assegnati.length > 0
    && assegnati.every((p) => !/^(fide|nome):/.test(p)), assegnati.join(", "));
});

console.log(ko ? `\n${ko} prove fallite.\n` : "\nTutte le prove passate.\n");
process.exit(ko ? 1 : 0);
