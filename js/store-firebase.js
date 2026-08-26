/* ---------------------------------------------------------------
   Adapter Firestore. Stessa interfaccia dell'adapter locale.

   Struttura:
     leagues/{id}                    config + membri + rose + stato asta
     leagues/{id}/matchdays/{mdId}   giornata, risultati e formazioni

   Le formazioni stanno dentro il documento della giornata sotto
   lineups.{uid}: Firestore aggiorna il singolo campo in modo atomico,
   quindi due amici che salvano insieme non si pestano i piedi.
   --------------------------------------------------------------- */

import { FIREBASE_CONFIG } from "./config.js";
import { newLeague } from "./store.js";

const V = "10.12.2";

export async function firebaseAdapter() {
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);

  const { getAuth, signInAnonymously, onAuthStateChanged } = authMod;
  const {
    getFirestore, doc, collection, getDoc, setDoc, updateDoc, deleteDoc,
    onSnapshot, runTransaction,
  } = fsMod;

  const app = initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(app);
  const db = getFirestore(app);

  const user = await new Promise((resolve, reject) => {
    const off = onAuthStateChanged(auth, (u) => { if (u) { off(); resolve(u); } });
    signInAnonymously(auth).catch((e) => {
      off();
      reject(new Error(
        "Accesso anonimo rifiutato. Attivalo in Firebase: Authentication > "
        + "Sign-in method > Anonimo. (" + e.code + ")"
      ));
    });
  });

  let me = { uid: user.uid, name: localStorage.getItem("fsc:name") || "" };

  const leagueRef = (id) => doc(db, "leagues", id);
  const mdsRef = (id) => collection(db, "leagues", id, "matchdays");
  const mdRef = (id, mdId) => doc(db, "leagues", id, "matchdays", mdId);

  return {
    mode: "firebase",
    get me() { return me; },

    async init() { return me; },

    async setName(name) {
      me = { ...me, name };
      try { localStorage.setItem("fsc:name", name); } catch { /* ignora */ }
    },

    async createLeague(cfg) {
      const lg = newLeague({ ...cfg, uid: me.uid, userName: me.name });
      await setDoc(leagueRef(lg.id), lg);
      return lg.id;
    },

    async getLeague(id) {
      const snap = await getDoc(leagueRef(id));
      return snap.exists() ? snap.data() : null;
    },

    watchLeague(id, cb) {
      return onSnapshot(
        leagueRef(id),
        (snap) => cb(snap.exists() ? snap.data() : null),
        (err) => { console.error("watchLeague", err); cb(null); },
      );
    },

    async updateLeague(id, mutator) {
      return runTransaction(db, async (tx) => {
        const snap = await tx.get(leagueRef(id));
        if (!snap.exists()) throw new Error("Lega non trovata");
        const next = mutator(snap.data());
        if (!next) return snap.data();
        tx.set(leagueRef(id), next);
        return next;
      });
    },

    watchMatchdays(id, cb) {
      return onSnapshot(
        mdsRef(id),
        (snap) => cb(snap.docs.map((d) => d.data())),
        (err) => { console.error("watchMatchdays", err); cb([]); },
      );
    },

    async setMatchday(id, md) {
      await setDoc(mdRef(id, md.id), md, { merge: true });
    },

    async deleteMatchday(id, mdId) {
      await deleteDoc(mdRef(id, mdId));
    },

    watchLineups(id, mdId, cb) {
      return onSnapshot(
        mdRef(id, mdId),
        (snap) => cb(snap.exists() ? (snap.data().lineups || {}) : {}),
        (err) => { console.error("watchLineups", err); cb({}); },
      );
    },

    async setLineup(id, mdId, uid, lineup) {
      await updateDoc(mdRef(id, mdId), {
        [`lineups.${uid}`]: { ...lineup, savedAt: Date.now() },
      });
    },

    async exportLeague(id) {
      const lg = await this.getLeague(id);
      const mds = await new Promise((res) => {
        const off = onSnapshot(mdsRef(id), (s) => {
          off();
          res(Object.fromEntries(s.docs.map((d) => [d.id, d.data()])));
        });
      });
      return { league: lg, matchdays: mds };
    },

    async importLeague(dump) {
      if (!dump?.league?.id) throw new Error("File non valido");
      await setDoc(leagueRef(dump.league.id), dump.league);
      for (const md of Object.values(dump.matchdays || {})) {
        await setDoc(mdRef(dump.league.id, md.id), md);
      }
      return dump.league.id;
    },

    listLocalLeagues() { return []; },
  };
}
