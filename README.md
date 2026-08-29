# ♞ Fantascacchi

Fanta-lega sugli scacchisti veri. Asta a crediti, formazione settimanale, e i punti
arrivano da soli dalla classifica reale dei **Titled Tuesday** di chess.com.

**Online: <https://jacoposchenetti.github.io/Fantascacchi/>**

Sito completamente statico: nessun server da mantenere, gira su GitHub Pages.

---

## Come si svolge

Il gioco ha due tempi con esigenze opposte, come nel fantacalcio vero.

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
4. **L'asta si chiude da sola** quando tutte le rose sono piene.
5. **Ogni martedì**: apri la giornata scegliendo il Titled Tuesday, ognuno
   schiera, tu chiudi gli schieramenti prima del torneo e a torneo finito premi
   *Scarica risultati e calcola*. La classifica si aggiorna per tutti.

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

### Punteggi

| Voce | Punti |
|---|---|
| Ogni punto fatto nel torneo | ×3 |
| Vittoria del torneo | +25 |
| 2° posto | +18 |
| 3° posto | +14 |
| Top 10 | +8 |
| Top 25 | +4 |
| Top 50 | +2 |
| En plein (11/11) | +15 |
| Almeno 9 punti | +5 |
| Sotto 4 punti | −3 |
| Capitano | ×2 |
| Non ha giocato | entra la panchina |

I bonus piazzamento **non si sommano**: vale solo il più alto. Il capitano raddoppia solo
se scende davvero in campo (se viene sostituito, il bonus si perde).

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

### Rigenerarlo a mano

```bash
python tools/build_listone.py --events 26 --top 90
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
