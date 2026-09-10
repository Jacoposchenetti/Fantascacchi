/* ---------------------------------------------------------------
   Spedizione delle notifiche.

   Web Push puro, con la coppia di chiavi VAPID: la privata sta come
   secret di Cloud Functions, la pubblica e' in js/config.js lato client.

   Due accortezze che sembrano dettagli e non lo sono:

   1. Un'iscrizione morta risponde 404 o 410. Va cancellata subito,
      altrimenti resta li' per sempre e ogni notifica futura paga il suo
      tentativo fallito. Un utente che cambia telefono ne lascia una.

   2. Il payload sta sotto i 4 KB (limite del protocollo) e non deve MAI
      contenere dati sensibili: passa da un servizio di terze parti,
      cifrato ma comunque fuori casa nostra. Titolo, riga di testo e un
      link bastano.
   --------------------------------------------------------------- */

import { getFirestore } from "firebase-admin/firestore";
import webpush from "web-push";

const PUBBLICA =
  "BAq5k944D6itfH_4m1zEOzHxBWQ5yBFGO2i2g6wigYHpZPTJ15eZQuumJNDkwAWjsz6nmoVYIhasmFsHwNSK8yU";

let configurato = false;

function configura(privata) {
  if (configurato) return;
  webpush.setVapidDetails("mailto:jschenetti@gmail.com", PUBBLICA, privata);
  configurato = true;
}

/**
 * Manda un messaggio a un gruppo di persone, su tutti i loro dispositivi.
 *
 * @param uids     destinatari (i doppioni e i null si ignorano)
 * @param msg      { titolo, corpo, tag, url }
 * @param privata  la chiave VAPID privata
 */
export async function invia(uids, msg, privata) {
  const destinatari = [...new Set(uids.filter(Boolean))];
  if (!destinatari.length) return 0;

  configura(privata);
  const db = getFirestore();

  const dispositivi = [];
  await Promise.all(destinatari.map(async (uid) => {
    const snap = await db.collection("pushSubs").doc(uid).collection("devices").get();
    snap.forEach((d) => dispositivi.push({ ref: d.ref, ...d.data() }));
  }));
  if (!dispositivi.length) return 0;

  const payload = JSON.stringify({
    titolo: msg.titolo,
    corpo: msg.corpo,
    tag: msg.tag || "fantascacchi",
    url: msg.url || "#/",
  });

  let inviate = 0;
  await Promise.all(dispositivi.map(async (d) => {
    try {
      await webpush.sendNotification(
        { endpoint: d.endpoint, keys: d.keys },
        payload,
        // Un'ora di validita': un promemoria d'asta consegnato domani
        // sarebbe solo fastidio. `urgency` alta sveglia i telefoni assopiti.
        { TTL: 3600, urgency: "high" },
      );
      inviate++;
    } catch (e) {
      const codice = e?.statusCode;
      if (codice === 404 || codice === 410) {
        await d.ref.delete().catch(() => {});
      } else {
        console.error("push non riuscita", codice, e?.body || e?.message);
      }
    }
  }));

  console.log(`push: ${inviate}/${dispositivi.length} — ${msg.titolo}: ${msg.corpo}`);
  return inviate;
}
