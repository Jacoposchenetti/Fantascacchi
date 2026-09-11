# ♞ Fantascacchi

Fanta-lega sugli scacchisti veri. Asta a crediti, formazione settimanale, e i punti
arrivano da soli dalla classifica reale dei **Titled Tuesday** di chess.com.

**Online: <https://jacoposchenetti.github.io/Fantascacchi/>**

Sito completamente statico: nessun server da mantenere, gira su GitHub Pages.

---

## Installarla sul telefono

È una PWA: apri <https://jacoposchenetti.github.io/Fantascacchi/> e usa
*Aggiungi alla schermata Home* (Safari: tasto condividi; Chrome: menu ⋮).
Parte a schermo intero, con la sua icona, e si apre anche senza rete —
mostrando l'ultima versione vista.

Il service worker usa **rete per prima, cache come scorta**. La cache per
prima sarebbe più veloce ma qui farebbe danno: l'app si aggiorna a ogni push
e i risultati arrivano ogni mercoledì, quindi la gente resterebbe indietro
senza capire perché. Le icone si rigenerano con `python tools/build_icons.py`.

Un invito a installarla compare da solo, ma con misura: mai alla prima
visita, mai due banner insieme, e chi lo chiude non lo rivede per due
settimane. Al secondo rifiuto sparisce e resta solo il comando nel profilo.

## Notifiche

Servono perché mezze meccaniche del gioco hanno una scadenza: un giro di
buste chiuse dura ore, il turno del draft scorre, e il martedì la
formazione si blocca alle 15:00 UTC che tu ci sia o no.

Cosa fa arrivare un avviso:

| Quando | A chi |
|---|---|
| Qualcuno entra nella tua lega | a chi l'ha creata |
| L'asta parte, va in pausa o si chiude | a tutti |
| Tocca a te chiamare (live) o scegliere (draft) | solo a te |
| Si apre un nuovo giro di buste chiuse | a chi non ha la rosa piena |
| Manca un'ora alla chiusura del giro e non hai offerto | solo a te |
| La rosa ti è stata riempita d'ufficio | solo a te |
| Il salary cap chiude fra due ore e la rosa è incompleta | solo a te |
| Titled Tuesday fra poche ore e non hai schierato | a chi non ha schierato |

Il permesso non viene chiesto all'avvio: l'invito compare dentro una lega,
dove la richiesta ha un senso visibile, e si accende o si spegne quando si
vuole dal profilo (il proprio nome in alto a destra). Ogni dispositivo fa
storia a sé: spegnerle sul telefono non le spegne sul portatile.

**Su iPhone servono dall'app aggiunta alla schermata home.** Non è una
nostra scelta: in Safari `PushManager` non esiste proprio, e compare solo
quando l'app gira dall'icona. Per questo l'invito a installare viene prima.

### Come sono fatte

Web Push standard con chiavi VAPID, senza SDK di messaggistica lato client:
`pushManager.subscribe()` è API nativa e uguale ovunque, Safari compreso.
L'iscrizione finisce in `pushSubs/{uid}/devices/{id}`, un documento per
dispositivo, leggibile solo dal proprietario — un endpoint push è di fatto
una chiave per far squillare quel telefono, e non va mostrato agli altri
partecipanti.

A spedire sono due Cloud Functions in `functions/` (Node 22, `europe-west1`
perché Firestore sta su `eur3`):

- **`legaCambiata`** — trigger su `leagues/{id}`. Confronta il documento
  prima e dopo e traduce la differenza in avvisi. È il modo giusto per gli
  eventi: arrivano nell'istante esatto e non interrogano niente.
- **`promemoria`** — ogni quarto d'ora, per le **scadenze**, che per
  definizione non generano nessuna scrittura: nessuno tocca la lega nel
  momento in cui mancano sessanta minuti alla chiusura di un giro.

Cosa è già stato mandato si segna in `promemoria/{lega}`, apposta **fuori**
dal documento della lega: scriverlo dentro farebbe ripartire il trigger, e
poi di nuovo, all'infinito.

Le iscrizioni morte (telefono cambiato, app disinstallata) rispondono 404 o
410 e vengono cancellate al primo tentativo fallito, altrimenti resterebbero
lì per sempre a far pagare un errore a ogni notifica.

### Se cambi le chiavi

`node -e` con `crypto.generateKeyPairSync("ec", …)` genera la coppia; la
pubblica va in `VAPID_PUBLIC` dentro `js/config.js`, la privata in un secret:

```bash
firebase functions:secrets:set VAPID_PRIVATE_KEY
```

Rigenerarle invalida tutte le iscrizioni esistenti, ma non è un dramma: il
client se ne accorge da solo, butta la vecchia e si reiscrive.

## Come si svolge

Il gioco ha due tempi con esigenze opposte, come nel fantacalcio vero.

### Quattro modi di comporre le rose

Si sceglie creando la lega, e cambia tutto:

| | **Live** | **Buste chiuse** | **Draft** | **Salary cap** |
|---|---|---|---|---|
| Quando | tutti insieme | ognuno quando può | tutti insieme (o a turni lenti) | ognuno quando può |
| Meccanica | chiamata e rilancio | offerta segreta per giocatore | scelta a turno, ordine a serpentina | prezzo fisso, componi entro budget |
| Soldi | budget, si spende | budget, si spende | nessuno | budget, prezzo = valutazione |
| Rose esclusive | sì | sì | sì | **no**, lo stesso giocatore in più rose |
| Durata | ~mezz'ora | giri da 1–24 ore | dipende dai secondi a scelta (60) | finestra di 1, 2, 3 o 7 giorni |

**Draft** — a turno ognuno prende un giocatore libero; l'ordine si inverte a
ogni giro (1‑2‑3, poi 3‑2‑1). Niente rilanci, niente budget. Allo scadere del
tempo sceglie l'app (il più quotato ancora libero), così non si blocca.

**Salary cap** — modello Fantasy Premier League: ogni giocatore ha il prezzo
del listino, ognuno compone la rosa in autonomia entro il budget, e **le rose
non sono esclusive**. Alla scadenza chi non ha finito viene completato
d'ufficio con i più economici che entrano nel budget.

Nelle **buste chiuse** si manda un'offerta segreta per ogni giocatore che si
vuole. Alla scadenza del giro si risolve tutto in una volta: si assegna dal
prezzo più alto al più basso, chi vince paga esattamente quanto ha offerto, e
a parità vince chi ha più crediti in cassa (poi chi ha offerto prima). Se le
rose non sono piene si apre un altro giro.

Puoi offrire su più giocatori di quanti potresti permetterti — è normale
puntare sapendo di non prenderli tutti — perché il budget viene rispettato
durante l'assegnazione: le offerte che non ci stanno vengono scartate.

### Se qualcuno non offre

Salta il giro: non prende niente e tiene i suoi crediti. Ma se **salta due
giri di fila**, la sua rosa viene riempita d'ufficio con i giocatori liberi
più **economici**, a 1 credito l'uno.

Serve perché altrimenti una sola persona che non apre mai l'app blocca tutto:
gli altri finiscono, i giri continuano a girare a vuoto e la stagione non
comincia mai. Succedeva davvero — verificato con una simulazione che dopo 25
giri era ancora ferma.

Si prendono i più economici di proposito: chi non partecipa non deve
ritrovarsi premiato con i fuoriclasse gratis.

Durante il giro si vede **chi ha già offerto e chi no** (solo il fatto, mai
gli importi), e chi rischia il riempimento d'ufficio viene segnalato, così lo
si può sollecitare prima che sia tardi.

Tutte queste regole sono scritte in chiaro in tre punti: nella sala d'attesa,
nella schermata di ingresso quando si apre un link, e in un riquadro apribile
sopra le offerte durante l'asta. Il testo viene da un unico posto
(`regoleBusteChiuse` in `js/sealed.js`), così è identico ovunque.

### Quanto dura

Dipende da su quanti giocatori puntate a ogni giro, non dal formato. Con rose
da 8 e 500 crediti, simulando la risoluzione vera:

| Offerte per giro | 4 partecipanti | 8 partecipanti |
|---:|---|---|
| 1 | 11 giri | 14 giri |
| 3 | 5 giri | 7 giri |
| **5** | **4 giri** | **5 giri** |
| 8+ | 3–4 giri | 4 giri |

La durata del giro si sceglie creando la lega — **1, 3, 6, 12 o 24 ore** — e si
cambia in Impostazioni. Con giri da 12 ore un'asta da 5 giri dura due giorni e
mezzo; da 3 ore si chiude in una serata; da 24 ore dà tempo a tutti ma allunga. Puntare su un giocatore solo per giro
è il modo peggiore: se lo perdi, quel giro non ti è costato crediti ma tempo.

**Le offerte sono segrete davvero**, non solo nascoste nell'interfaccia: le
regole Firestore impediscono di leggere quelle altrui finché la scadenza non
è passata. Nasconderle solo a schermo non basterebbe, chiunque sa aprire la
console del browser.

Il resto di questa sezione descrive l'asta live.

**L'asta è un evento sincrono.** Serve che siate collegati tutti insieme: i lotti
durano una ventina di secondi. Funziona sia in presenza sia a distanza, ma a una
condizione — **ognuno deve avere il proprio dispositivo**, perché rilanciare è
legato al proprio account. Non ci si passa un portatile.

La configurazione migliore è tutti nella stessa stanza, ognuno col telefono. In
videochiamata è identico. Ordine di grandezza: in 4 con rosa da 8 sono 32 lotti,
cioè **una mezz'ora scarsa**.

**La stagione è asincrona.** Formazioni, giornate e classifica vivono su
settimane: ognuno fa la sua quando gli pare, nessuno aspetta nessuno.

### Il giro completo

1. **Crei la lega** e mandi il link. Chi lo apre entra con Google e finisce in
   **sala d'attesa**: si vede chi è collegato, ma non si può ancora comprare
   niente.
2. **Dai il via all'asta** quando ci siete. A turno si chiama un giocatore —
   `turnSeconds` per scegliere, poi il turno passa da solo al successivo, così
   una persona distratta non congela la serata. Chi chiama parte da 1 credito ed
   è il primo offerente; ogni rilancio rimette il cronometro a `bidSeconds`.
3. **Puoi metterla in pausa quando vuoi** (solo tu). I cronometri si fermano,
   nessuno può chiamare o rilanciare, e alla ripresa la mano resta a chi ce
   l'aveva — con il turno pieno, non con i secondi che gli erano avanzati.
4. **L'asta si chiude da sola** quando tutte le rose sono piene, e da quel
   momento **parte la stagione**.
5. **Poi non tocca più a nessuno.** Le giornate sono i primi N Titled Tuesday
   che arrivano dopo la chiusura dell'asta: nessuno le crea, nessuno carica i
   punti. Si mette la formazione entro il martedì e basta.

### La stagione si gestisce da sola

Prima ogni giornata andava creata a mano e i punti andavano scaricati premendo
un pulsante. Adesso la stagione è definita da due soli numeri sulla lega —
quando è iniziata e quante giornate dura — e tutto il resto si deriva.

Funziona senza un server perché i Titled Tuesday sono regolarissimi: **ogni
martedì alle 15:00 UTC**, poco più di due ore. Quindi:

- le date future si prevedono, e il calendario mostra tutte le giornate fino
  alla scadenza già dal primo giorno;
- **gli schieramenti si chiudono da soli** all'ora d'inizio del torneo;
- i risultati arrivano da file statici (`data/tt/*.json`, circa 6 KB l'uno) che
  la GitHub Action pubblica ogni mercoledì. L'app li legge e calcola i punti.

Nella finestra fra la fine del torneo e il passaggio dell'Action, chi apre
l'app fa scaricare la classifica a chess.com in diretta. Costa di più, ma
nessuno deve aspettare né premere niente.

**La classifica è la somma delle giornate già giocate.** Prima del primo Titled
Tuesday della stagione sono tutti a zero, ed è quello che si vede.

**Se ti dimentichi di schierare** resta valida l'ultima formazione che hai
messo — anche di tre giornate fa. Non serve nessuna scrittura sul database: il
punteggio risale all'indietro fino a trovarne una.

### Perché non ci si ruba i giocatori di notte

Tre protezioni, tutte nate da buchi veri:

- **Sala d'attesa.** Prima la lega nasceva con l'asta già aperta: bastava aprire
  il link mentre gli altri dormivano per portarsi via il migliore a 1 credito.
- **Timer di chiamata.** Prima solo i rilanci avevano un tempo. Se toccava a
  qualcuno che aveva il telefono in tasca, l'asta si bloccava all'infinito.
  Ora il turno scade, e chiunque può comunque passare la mano a mano.
- **Presenza.** Un pallino dice chi è davvero collegato, così sai se ha senso
  aspettare qualcuno.

### Chi comanda, e chi perde la mano

Avviare, mettere in pausa e riprendere sono cose che può fare **solo l'admin**
(chi ha creato la lega). *Salta il turno* invece è di tutti: serve a sbloccare
chi si è distratto, e non richiede di disturbare l'admin.

Il turno avanza solo quando ha senso che avanzi:

| Cosa succede | La mano |
|---|---|
| Chiami un giocatore | resta tua mentre il lotto corre |
| Il lotto viene assegnato | passa al successivo |
| Il turno scade, o qualcuno lo salta | passa al successivo |
| **Il lotto viene annullato** | **resta a chi stava chiamando** |
| **L'asta va in pausa e riprende** | **resta a chi stava chiamando** |

Annullare e mettere in pausa sono ripensamenti, non penalità: lo scacchista torna
libero, nessuno paga, e chi aveva la mano rifà la sua scelta con il cronometro
pieno. Se invece serve azzerare tutto, *Impostazioni → Zona pericolosa →
Ricomincia l'asta da capo* riporta tutti in sala d'attesa e svuota le rose.

E perché 20 secondi passano in fretta, quando si apre un lotto arrivano **suono,
vibrazione e titolo lampeggiante** nella scheda. Si spengono col pulsante
🔔 durante l'asta.

## Come si gioca

### Quanto dura una lega

Prima l'asta: mezz'ora se live, quattro-cinque giorni se a buste chiuse.

Poi la stagione, che è lunga **`matchdays` Titled Tuesday** — di default **10**,
regolabile da 1 a 52 in Impostazioni. I Titled Tuesday sono settimanali, quindi
10 giornate ≈ **due mesi e mezzo**. Il calendario mostra fin dal primo giorno
tutte le date fino alla chiusura; quando è finita, la classifica è definitiva.

### Come si calcola il punteggio, esattamente

Ogni giornata, per ogni tuo titolare che ha giocato il torneo:

1. **Base** — punti fatti nel torneo `× 3`. Otto su undici valgono 24.
2. **Piazzamento** — il primo scaglione che scatta, e **uno solo**:
   1° `+25` · 2° `+18` · 3° `+14` · top 10 `+8` · top 25 `+4` · top 50 `+2`.
3. **Soglia di rendimento** — `11/11` vale `+15`; da `9` in su `+5`; sotto `4` è `−3`.
4. **Imprese** — per **ogni partita** vinta contro un avversario molto più forte:
   `+2` se il divario di rating è almeno 100, `+4` da 200, `+6` da 300. Scatta un
   solo scaglione per partita, e il totale imprese di giornata è **tetto a +12**.
   Vale contro chiunque nel torneo, non solo contro chi è in rosa a qualcuno.
5. **Scontro diretto** — se incontri al tavolo uno scacchista schierato da un
   **altro partecipante**: `+3` se lo batti, `−2` se perdi, `0` in caso di patta.
   Fra due tuoi non conta: è una partita di giro.
6. **Capitano** — la somma di tutto quanto sopra `× 2`, ma **solo se il capitano
   ha giocato davvero**. Se è assente ed entra un panchinaro, il ×2 si perde.

**Se un titolare non ha giocato il torneo**, al suo posto entra — con il suo
punteggio — il primo panchinaro della lista che invece l'ha giocato.

Il totale della giornata è la somma dei cinque titolari effettivi. La classifica
di stagione è la somma delle giornate già disputate.

| Voce | Punti |
|---|---|
| Ogni punto fatto nel torneo | ×3 |
| Vittoria del torneo / 2° / 3° | +25 / +18 / +14 |
| Top 10 / 25 / 50 | +8 / +4 / +2 |
| En plein (11/11) | +15 |
| Almeno 9 punti / sotto 4 | +5 / −3 |
| **Impresa: batte uno +100 / +200 / +300 di rating** | **+2 / +4 / +6** per partita |
| Tetto imprese per giornata | +12 |
| Scontro diretto: vinci / perdi / patta | +3 / −2 / 0 |
| Capitano | ×2 |
| Non ha giocato | entra la panchina |

I bonus piazzamento **non si sommano**: vale solo il più alto. Il capitano raddoppia solo
se scende davvero in campo (se viene sostituito, il bonus si perde).

### Impresa (batte i più forti)

Ogni partita vinta contro un avversario con rating molto più alto vale un bonus,
tanto più grosso quanto più largo il divario: `+2` da 100 punti in su, `+4` da
200, `+6` da 300. Conta il rating registrato **in quella partita** del torneo.
Il totale imprese di una giornata è limitato a `+12`, così una serata d'oro
pesa ma non triplica il punteggio.

A differenza dello scontro diretto, l'impresa vale contro **chiunque** nel
torneo. I dati stanno in `data/tt/<id>.json` sotto `upsets`, estratti dagli
stessi 11 turni già scaricati per gli scontri diretti (una quarantina per
torneo).

### Scontro diretto

Quando due scacchisti **schierati da due partecipanti diversi** si incontrano al
tavolo, chi vince prende +3 e chi perde −2. Se sono entrambi tuoi non conta
niente: è una partita di giro. Vale per chi è effettivamente sceso in campo,
quindi anche per un panchinaro entrato al posto di un assente.

I dati vengono dalle partite di tutti gli 11 turni, non solo dall'ultimo:
`tools/build_results.py` li raccoglie e ne salva solo quelle fra due giocatori
del listone — un'ottantina per torneo, un paio di kilobyte. Nella finestra in
cui l'app legge la classifica in diretta gli scontri non ci sono ancora, quindi
i punteggi sono provvisori finché non arriva il file definitivo.

Le regole stanno in `js/config.js` (`SCORING`) e si possono cambiare a piacere.

---

## Provarlo subito in locale

I moduli ES non funzionano da `file://`, serve un server:

```bash
python tools/devserver.py
```

Poi apri <http://localhost:8100>. È un normale server statico, ma manda
`Cache-Control: no-store`: senza quello il browser tiene in cache i moduli ES e
continui a eseguire il codice di prima dopo ogni modifica.

Con Firebase configurato l'app chiede il login anche in locale. Per provare
l'asta in due schede senza autenticarsi, aggiungi `?local` **prima** dell'hash:

    http://localhost:8100/?local

Si torna alla modalità locale (localStorage + BroadcastChannel), e due schede
dello stesso browser si sincronizzano davvero. Funziona tutto — asta compresa — ma i dati restano
in questo browser: il link d'invito non raggiunge nessun altro. Per giocare davvero
serve il passo qui sotto.

> Curiosità utile per provare: apri due schede dello stesso browser e vedrai l'asta
> sincronizzarsi fra le due (usa `BroadcastChannel`).

---

## Firebase — stato della configurazione

Progetto **`fantascacchi-cdcca`**, collegato via CLI:

- [x] App web registrata, config in [`js/config.js`](js/config.js)
- [x] API Cloud Firestore abilitata
- [x] Database Firestore creato (`(default)`, regione `eur3` — Europa)
- [x] Regole di [`firestore.rules`](firestore.rules) compilate e pubblicate
- [x] Accesso con **Google** attivo
- [x] `jacoposchenetti.github.io` fra i domini autorizzati

### Perché Google e non l'accesso anonimo

Con l'accesso anonimo l'identità vive solo in quel browser: svuotare i dati o
passare dal telefono al portatile **fa perdere la rosa**, perché cambia l'uid.
Con Google l'uid è stabile ovunque, quindi la squadra ti segue. Il prezzo è che
serve un account Google — cosa che praticamente tutti hanno.

Se vuoi riattivare anche l'anonimo: abilitalo in console
(Authentication → Sign-in method → Anonimo) e metti `anonymous: true` nel blocco
`AUTH` di [`js/config.js`](js/config.js). Il pulsante compare da solo.

### Domini autorizzati

Google rifiuta l'accesso da domini non elencati. Al momento sono autorizzati
`localhost`, i due domini Firebase e `jacoposchenetti.github.io`.

Se un giorno metti il sito altrove (dominio tuo, Netlify, Vercel…) ricordati di
aggiungere anche quello: Authentication → Settings → Domini autorizzati.
Senza, il pulsante restituisce `auth/unauthorized-domain` — che l'app traduce
in un messaggio leggibile invece di lasciarti a bocca asciutta.

### Rideployare le regole

```bash
firebase deploy --only firestore:rules
```

### Sulla chiave API

Quella di Firebase è pubblica per progetto, sta in chiaro in ogni app web e non è
un segreto: a proteggere i dati sono le regole Firestore, non lei.

**Sulle regole incluse**: chiunque sia autenticato e conosca il codice di una lega può
scriverci. Per una lega tra amici va bene — i codici sono casuali a 6 caratteri
(circa 900 milioni di combinazioni), quindi non si indovinano. Non metterci dati personali.

---

## Pubblicare su GitHub Pages

Già attivo su <https://jacoposchenetti.github.io/Fantascacchi/>, da `main` / root.
Ogni push su `main` rifà il deploy da solo:

```bash
git push
```

Il routing usa gli hash (`#/l/abc123/asta`) proprio perché GitHub Pages non sa
riscrivere gli URL: così ogni link d'invito regge anche il ricaricamento.

---

## Il listone: due numeri, non uno

Ogni giocatore porta **due misure separate**, perché rispondono a domande diverse:

| Campo | Significa | Domanda a cui risponde |
|---|---|---|
| `avgPoints` | media sui soli tornei **giocati** | quanto è forte quando c'è? |
| `presence` | quota di tornei a cui si è presentato | quanto spesso c'è? |
| `expected` | `avgPoints × presence` | quanto ti rende **per giornata**? |

Tenerle separate è la cosa giusta: una media di 9/11 costruita su due tornei
su ventisei non è la stessa cosa di 8/11 su ventisei, ma un'unica colonna le
farebbe sembrare simili. Il prezzo segue `expected` più il rating blitz
(55/45), quindi chi salta metà dei martedì costa meno — perché metà delle
giornate ti lascia un buco in formazione.

All'asta l'app mostra entrambe: *«8.4/11 quando gioca»* e *«presente 21/26»*,
con la presenza colorata (verde sopra l'80%, rossa sotto il 55%).

### I più forti del mondo entrano comunque

Quel criterio, da solo, buttava fuori **Carlsen**: gioca due Titled Tuesday su
ventisei, quindi il suo valore atteso è 1,46 contro il 2,71 del 150° in lista.
Non arrivava 151°, stava sotto tutti. Matematicamente giusto, ma un listone di
fantascacchi senza il numero uno al mondo sembra rotto anche quando ha ragione.

Quindi i **top 15 FIDE** entrano sempre, fuori classifica, col prezzo normale:
cari perché il prezzo pesa il rating, poco redditizi perché pesa la presenza.
Una scommessa vera, che è il genere di dilemma per cui esiste un'asta.

L'elenco **non è scritto a mano** — invecchierebbe. Arriva dall'export mensile
della FIDE e si aggiorna da solo quando cambia la classifica mondiale:

```bash
python tools/fide.py --top 15
```

Due ostacoli, risolti così:

- **chess.com non espone il rating FIDE** (è `null` anche sul profilo di
  Carlsen) e le classifiche su `ratings.fide.com` si disegnano in JavaScript,
  quindi da uno script non restituiscono niente. Si usa l'export ufficiale in
  formato testo: colonne fisse, stabile da anni. Le posizioni delle colonne si
  ricavano dall'intestazione, così se la FIDE ne sposta una non si legge in
  silenzio il campo sbagliato.
- **La FIDE ragiona per nome, chess.com per username**, e non c'è nessun
  endpoint che traduca. `tools/build_gm_index.py` costruisce l'indice leggendo
  il campo `name` dai profili dei ~1700 GM: sei minuti la prima volta, poi è
  incrementale e scarica solo chi è diventato GM da allora.

Il caso difficile non è l'omonimia ma il contrario: **i fuoriclasse hanno più
account**. Hikaru Nakamura ne ha cinque intestati allo stesso nome, fra secondi
account e quello per lo streaming. A scegliere il principale è chi i Titled
Tuesday li gioca davvero — un account alternativo che non scende mai in campo
non farebbe punti a nessuno.

### Eliminare una lega

Chi l'ha creata la trova in **Impostazioni → Zona pericolosa → Elimina la
lega**. Serve una doppia conferma (la seconda chiede di riscrivere il nome),
poi la lega e tutto quello che le sta attaccato — rose, formazioni, giornate,
offerte, presenze — spariscono per tutti. Gli altri partecipanti che l'avevano
aperta se la ritrovano con un messaggio "lega non trovata".

Le regole Firestore consentono `delete` sul documento della lega **solo se
`adminUid` combacia con chi lo chiede**; le sottocollezioni le svuota il
client prima, perche' Firestore non cancella i figli da solo.

### Le iscrizioni ai tornei non sono pubbliche

Sarebbe utile sapere in anticipo chi si è iscritto al prossimo Titled Tuesday,
per scegliere la formazione il giorno prima. **Non si può**: il campo
`registered` dell'API contiene solo residui di tornei vecchi e cancellati
(verificato su quattro habitué a tre giorni dall'evento: zero tornei futuri), e
la lista iscritti del torneo è troncata a 25 nomi su 774.

Il sostituto è nella scheda e nella schermata Rose: una **striscia di pallini**
con le ultime sei giornate, pieno se ha giocato. È il segnale migliore
disponibile — chi c'è stato le ultime quattro volte di fila probabilmente ci
sarà anche martedì.

### Scheda giocatore

Cliccando un giocatore — all'asta, nelle rose o in formazione — si apre una
scheda con due grafici e i rating live:

- **Rendimento nei Titled Tuesday**: una barra per torneo, e una tacca vuota
  dove non ha giocato. Un grafico dei soli tornei giocati nasconderebbe proprio
  la variabile che conta.
- **Rating blitz nel tempo**: chess.com non pubblica lo storico dei rating, ma
  dentro le partite di ogni torneo il rating del momento c'è. Il generatore lo
  raccoglie, e ne esce una serie settimanale.
- **Rating attuali** per bullet, blitz, rapid e daily, con massimo storico e
  barra vittorie/patte/sconfitte: una sola chiamata live, messa in cache.

Lo storico sta in `history` dentro il listone (chiavi corte: `d` data, `p`
punti, `r` piazzamento, `e` rating). È il motivo per cui il file pesa ~180 KB
invece di 40: compresso dal server sono una trentina.

### Rigenerarlo a mano

```bash
python tools/build_listone.py --events 26 --top 150
```

26 tornei sono circa sei mesi di Titled Tuesday. `--min-events 3` scarta chi ha
troppe poche presenze perché la sua media significhi qualcosa.

### Aggiornamento automatico

[`.github/workflows/listone.yml`](.github/workflows/listone.yml) lo rifà **ogni
mercoledì mattina** e committa solo se i numeri sono cambiati. Ogni commit
ridisegna anche il sito, quindi i prezzi restano allineati da soli.

GitHub sospende i workflow programmati sui repository fermi da 60 giorni: se la
lega va in letargo, riattivalo dalla scheda *Actions* o lancialo a mano con
*Run workflow*.

Serve qualcuno che non è in lista? **Impostazioni → Aggiungi un giocatore**,
basta il suo username chess.com (per lui la presenza risulterà sconosciuta,
perché non è passato dall'aggregazione).

## Com'è fatto

Niente build, niente dipendenze da installare: HTML + moduli ES + un foglio di stile.

```
index.html
css/style.css
js/
  config.js          Firebase + regole di punteggio
  app.js             router a hash, sottoscrizioni, rendering
  store.js           livello dati + adapter locale (localStorage)
  store-firebase.js  adapter Firestore, stessa interfaccia
  chesscom.js        client API chess.com
  scoring.js         calcolo fantapunti
  league.js          stato derivato (rose, budget, turni)
  views/             una vista per schermata
data/listone.json    pool giocatori con prezzi
tools/build_listone.py
```

Tre scelte che vale la pena conoscere se ci metti mano:

- **Una sola primitiva di scrittura.** Tutto ciò che modifica una lega passa da
  `updateLeague(id, mutator)`, che su Firestore è una transazione vera. È il motivo per
  cui due rilanci simultanei non si sovrascrivono.
- **L'asta si chiude da sola, senza server.** Il lotto ha una scadenza assoluta
  (`endsAt`); il primo client che si accorge che è passata prova ad assegnare il
  giocatore. Chi arriva dopo trova lo stato già cambiato e non fa nulla.
- **Il download pesante lo fa una persona sola.** La classifica completa di un Titled
  Tuesday pesa circa mezzo mega. Chi calcola la giornata la scarica una volta e salva uno
  snapshot minuscolo; tutti gli altri leggono quello.

### Note sui dati di chess.com

- Gli ID dei tornei finiscono con un numero opaco
  (`titled-tuesday-blitz-august-25-2026-31064127`), quindi **non** si possono costruire da
  una data: vanno scoperti dalla lista tornei di giocatori che partecipano quasi sempre.
- La classifica finale sta nel gruppo dell'**ultimo turno**: i punti lì dentro sono già
  cumulativi di fine torneo.
- Chi si ritira a metà non compare in quella classifica. Per quei pochi si guarda il suo
  storico personale, che riporta comunque piazzamento e vittorie/patte/sconfitte.
- L'API pubblica non richiede chiavi e manda `Access-Control-Allow-Origin: *`, quindi un
  sito statico può interrogarla direttamente.
