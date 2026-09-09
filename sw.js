/* ---------------------------------------------------------------
   Service worker.

   Strategia: RETE PER PRIMA, cache come rete di scorta.

   La tentazione sarebbe servire dalla cache per velocita', ma qui sarebbe
   un danno: l'app si aggiorna a ogni push su GitHub Pages, e i risultati
   dei tornei arrivano ogni mercoledi'. Con la cache per prima la gente
   resterebbe su una versione vecchia senza capire perche', e i punteggi
   sembrerebbero fermi.

   Cosi' invece: se c'e' rete si prende sempre l'ultima versione, e se non
   c'e' si apre lo stesso con quello che si era gia' visto.
   --------------------------------------------------------------- */

const VERSIONE = "fantascacchi-v1";

// Il minimo per far comparire qualcosa anche offline.
const GUSCIO = [
  "./",
  "./index.html",
  "./css/style.css",
  "./manifest.webmanifest",
  "./data/listone.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSIONE)
      // Se un file manca non deve far fallire tutta l'installazione.
      .then((c) => Promise.allSettled(GUSCIO.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((chiavi) => Promise.all(
        chiavi.filter((k) => k !== VERSIONE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Solo il nostro sito: chess.com, Firebase e i font li gestisce il browser.
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(VERSIONE).then((c) => c.put(req, copia));
        }
        return res;
      })
      .catch(async () => {
        const salvato = await caches.match(req);
        if (salvato) return salvato;
        // Navigazione senza rete: si apre comunque l'app.
        if (req.mode === "navigate") {
          const home = await caches.match("./index.html");
          if (home) return home;
        }
        return new Response("Offline", { status: 503, statusText: "Offline" });
      }),
  );
});
