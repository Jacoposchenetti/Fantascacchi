/* ---------------------------------------------------------------
   Adapter Firestore. Stessa interfaccia dell'adapter locale.

   Struttura:
     leagues/{id}                    config + membri + rose + stato asta
     leagues/{id}/matchdays/{mdId}   giornata, risultati e formazioni

   Le formazioni stanno dentro il documento della giornata sotto
   lineups.{uid}: Firestore aggiorna il singolo campo in modo atomico,
   quindi due amici che salvano insieme non si pestano i piedi.

   Autenticazione: l'adapter NON forza il login all'avvio. Si costruisce
   anche senza utente e l'app mostra la schermata di accesso; l'uid di
   Google e' stabile fra dispositivi, quindi la rosa ti segue ovunque.
   --------------------------------------------------------------- */

import { FIREBASE_CONFIG, AUTH } from "./config.js";
import { newLeague } from "./store.js";

const V = "10.12.2";
const LS_NAME = "fsc:name";

export async function firebaseAdapter() {
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);

  const {
    getAuth, onAuthStateChanged, signInAnonymously, signOut,
    GoogleAuthProvider, signInWithPopup,
  } = authMod;
  const {
    getFirestore, doc, collection, getDoc, setDoc, updateDoc, deleteDoc,
    onSnapshot, runTransaction,
  } = fsMod;

  const app = initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(app);
  const db = getFirestore(app);

  let me = null;
  const listeners = new Set();

  const readOverride = () => {
    try { return localStorage.getItem(LS_NAME) || ""; } catch { return ""; }
  };

  function setUser(u) {
    me = u ? {
      uid: u.uid,
      name: readOverride() || u.displayName || (u.email || "").split("@")[0] || "Giocatore",
      photo: u.photoURL || "",
      email: u.email || "",
      anonymous: u.isAnonymous,
    } : null;
    listeners.forEach((cb) => cb(me));
  }

  // Si aspetta il primo verdetto di Firebase (sessione ripristinata o assente)
  // prima di disegnare qualsiasi cosa, per non far lampeggiare il login.
  await new Promise((resolve) => {
    let first = true;
    onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (first) { first = false; resolve(); }
    });
  });

  const leagueRef = (id) => doc(db, "leagues", id);
  const mdsRef = (id) => collection(db, "leagues", id, "matchdays");
  const mdRef = (id, mdId) => doc(db, "leagues", id, "matchdays", mdId);
  // La presenza sta in documenti separati, uno per persona: cosi' i battiti
  // ogni 20 secondi non entrano in conflitto con le transazioni dei rilanci.
  const presRef = (id, uid) => doc(db, "leagues", id, "presence", uid);
  const presColl = (id) => collection(db, "leagues", id, "presence");

  /** Traduce i codici Firebase in qualcosa di leggibile. */
  function authError(e) {
    const code = e?.code || "";
    if (code.includes("popup-blocked")) {
      return new Error("Il browser ha bloccato la finestra di accesso. Consenti i popup e riprova.");
    }
    if (code.includes("popup-closed") || code.includes("cancelled-popup")) {
      return new Error("Accesso annullato.");
    }
    if (code.includes("unauthorized-domain")) {
      return new Error(
        "Questo dominio non e' autorizzato in Firebase. Aggiungilo in "
        + "Authentication > Settings > Domini autorizzati."
      );
    }
    if (code.includes("configuration-not-found") || code.includes("operation-not-allowed")) {
      return new Error(
        "Questo metodo di accesso non e' attivo sul progetto Firebase "
        + "(Authentication > Sign-in method)."
      );
    }
    return new Error(e?.message || "Accesso non riuscito");
  }

  return {
    mode: "firebase",
    needsAuth: true,
    canGoogle: AUTH.google,
    canAnonymous: AUTH.anonymous,

    get me() { return me; },

    async init() { return me; },

    onAuthChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    async signInWithGoogle() {
      const provider = new GoogleAuthProvider();
      // Fa scegliere l'account anche a chi ne ha piu' di uno collegato.
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        throw authError(e);
      }
    },

    async signInAnon() {
      try {
        await signInAnonymously(auth);
      } catch (e) {
        throw authError(e);
      }
    },

    async signOut() {
      try { localStorage.removeItem(LS_NAME); } catch { /* ignora */ }
      await signOut(auth);
    },

    async setName(name) {
      try { localStorage.setItem(LS_NAME, name); } catch { /* ignora */ }
      if (me) {
        me = { ...me, name };
        listeners.forEach((cb) => cb(me));
      }
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

    watchPresence(id, cb) {
      return onSnapshot(
        presColl(id),
        (snap) => {
          const out = {};
          snap.docs.forEach((d) => { out[d.id] = d.data().at || 0; });
          cb(out);
        },
        (err) => { console.error("watchPresence", err); cb({}); },
      );
    },

    async touchPresence(id, uid) {
      await setDoc(presRef(id, uid), { at: Date.now() });
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
