#!/usr/bin/env python3
"""
Archivia un torneo classico trasmesso da Lichess, nello stesso formato con
cui l'app legge i Titled Tuesday.

Cosa produce, per ogni torneo <id>:

    data/bc/<id>/index.json        metadati, turni e listone del torneo
    data/bc/<id>/r<N>.json         risultati del turno N
    data/bc/<id>/finale.json       risultati dell'intero torneo
    data/bc/<id>/partite/r<N>.json indice partite del turno N

I due file di risultati hanno lo stesso identico contratto dei Titled
Tuesday — `standings`, `h2h`, `upsets` — perche' servono due leghe diverse
con lo stesso motore di punteggio:

  * lega su UN torneo, dove una giornata e' un TURNO   -> r<N>.json
  * lega a CIRCUITO, dove una giornata e' un TORNEO    -> finale.json

Un turno di un torneo chiuso pesa un paio di kilobyte, l'archivio completo
dei Candidati (14 turni, 8 giocatori) sta sotto i 100 KB.

Uso:
    python tools/build_broadcast.py BLA70Vds [Ee0xddnN ...]
    python tools/build_broadcast.py --cerca "Tata Steel"
    python tools/build_broadcast.py --aggiorna        # rifa quelli gia' in archivio
"""

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import broadcast as lb                                          # noqa: E402

# I nomi dei tornei girano il mondo: "Haustmót", "Festival di Scacchi",
# "Mistrzostwa Polski". Sulla console di Windows, che di suo e' cp1252,
# stamparli faceva morire lo strumento con un UnicodeEncodeError a meta'
# elenco — dopo aver gia' scritto meta' archivio.
for flusso in (sys.stdout, sys.stderr):
    try:
        flusso.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

RADICE = Path(__file__).resolve().parent.parent
OUT = RADICE / "data" / "bc"

# I tornei che il progetto segue: li rilegge la CI tutti i giorni finche'
# sono in corso. E' un file e non una costante perche' aggiungerne uno deve
# essere una riga di JSON, non una modifica al codice.
SEGUITI = OUT / "seguiti.json"

# Dopo quanto un torneo si considera finito e non si ritocca piu'. Due
# giorni oltre l'ultimo turno: i PGN delle ultime partite a volte arrivano
# con calma, e una partita aggiustata il giorno dopo cambia la classifica.
CODA_S = 2 * 24 * 3600

# Sotto questo divario di rating la vittoria non e' una sorpresa. Stesso
# valore dei Titled Tuesday: cambiarlo qui e non li' vorrebbe dire che la
# stessa impresa vale diversamente a seconda del torneo.
UPSET_MIN = 100

# Prezzi: ancorati al rating ASSOLUTO, non alla forbice del torneo.
#
# Normalizzare sul campo di gara sembrava ovvio e non funziona: ai
# Candidati fra il primo e l'ultimo ci sono 112 punti Elo, e il piu' debole
# — un 2698 — sarebbe finito a sei crediti come un dilettante. Con l'ancora
# assoluta un 2700 costa uguale ai Candidati e al Grand Swiss, che e' anche
# quello che serve a una lega a circuito.
PREZZO_BASE = 6
PREZZO_SCALA = 144
RATING_ZERO = 2400        # sotto questo, prezzo minimo
RATING_SPAN = 450         # 2850 = il massimo della scala


def prezzo(rating):
    """Dal rating FIDE ai crediti d'asta."""
    quota = min(1.0, max(0.0, ((rating or 0) - RATING_ZERO) / RATING_SPAN))
    # Esponente > 1: i fuoriclasse costano sproporzionatamente, come nel
    # fantacalcio. E' la stessa curva del listone dei Titled Tuesday.
    return int(round(PREZZO_BASE + (quota ** 1.5) * PREZZO_SCALA))


def iso(ms):
    """Da millisecondi a data ISO, in UTC come tutto il resto dell'app."""
    if not ms:
        return None
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d")


def classifica(punti):
    """
    Da {pid: punti} a {pid: [punti, piazzamento]}, con i pari merito
    contati come si fa negli scacchi: 1, 2, 2, 4.
    """
    ordinati = sorted(punti.items(), key=lambda kv: -kv[1])
    fuori, rank, prec = {}, 0, None
    for i, (pid, p) in enumerate(ordinati):
        if p != prec:
            rank, prec = i + 1, p
        fuori[pid] = [round(p, 1), rank]
    return fuori


def leggi_turni(tour_id, turni):
    """
    Scarica ogni turno una volta sola e ne ricava tutto quello che serve.

    Restituisce una lista parallela a `turni`, con per ciascuno:
    partite grezze, esiti per giocatore, scontri e imprese.
    """
    fuori = []
    for n, r in enumerate(turni, start=1):
        pgn = lb.pgn_turno(r["id"])
        time.sleep(lb.PAUSA_S)
        partite = lb.partite(pgn)

        righe, h2h, upsets = [], [], []
        for g in partite:
            w, b = lb.chiave(g, "White"), lb.chiave(g, "Black")
            if not w or not b:
                continue
            e = lb.esito(g)
            if e is None:
                # Partita in corso o rinviata: non e' un risultato, e
                # contarla come patta falserebbe la classifica.
                continue
            wr, br = lb.elo(g, "White"), lb.elo(g, "Black")

            h2h.append([w, b, e, n])

            if e != "d":
                vinc, gap = (w, br - wr) if e == "w" else (b, wr - br)
                if gap >= UPSET_MIN:
                    upsets.append([vinc, int(gap), n])

            righe.append({
                "w": w, "b": b, "wr": wr, "br": br, "e": e, "t": n,
                # Il turno su Lichess: basta a ripescare le mosse, una
                # chiamata sola per tutto il turno.
                "r": r["id"],
                "id": (g.get("GameURL") or "").rsplit("/", 1)[-1],
                "eco": g.get("Opening") or "",
                # I nomi veri servono a chi guarda: le chiavi sono FIDE id.
                "wn": g.get("White") or "", "bn": g.get("Black") or "",
            })

        fuori.append({
            "n": n,
            "id": r["id"],
            "nome": r.get("name") or f"Turno {n}",
            "start": (r.get("startsAt") or 0) // 1000,
            "finito": bool(r.get("finished")),
            "partite": righe,
            "h2h": h2h,
            "upsets": upsets,
        })
        print(f"      turno {n:>2}: {len(righe)} partite, "
              f"{len(upsets)} imprese", flush=True)
    return fuori


def punti_del_turno(turno):
    """
    Quanto ha fatto ognuno in QUESTO turno: 1, 0.5 o 0, e con che colore.

    Chi non compare non ha giocato — turno di riposo, bye, eliminazione.
    E' la stessa situazione dei Titled Tuesday saltati, e la panchina
    serve a quello.

    Il colore serve al punteggio: vincere col nero vale un bonus, ed e'
    l'unico posto in cui si sa.
    """
    punti, colori = {}, {}
    for g in turno["partite"]:
        punti[g["w"]] = punti.get(g["w"], 0) + (1 if g["e"] == "w" else 0.5 if g["e"] == "d" else 0)
        punti[g["b"]] = punti.get(g["b"], 0) + (1 if g["e"] == "b" else 0.5 if g["e"] == "d" else 0)
        colori[g["w"]], colori[g["b"]] = "w", "b"
    return punti, colori


def scrivi(percorso, dati):
    percorso.parent.mkdir(parents=True, exist_ok=True)
    percorso.write_text(json.dumps(dati, ensure_ascii=False, separators=(",", ":")),
                        encoding="utf-8")
    return percorso.stat().st_size


def gia_completo(tour_id, turni_meta):
    """
    Vero se l'archivio c'e' gia', copre tutti i turni ed e' passata la coda.
    Serve a non riscaricare ogni notte i tornei dell'anno scorso.
    """
    idx = OUT / tour_id / "index.json"
    if not idx.exists():
        return False
    try:
        m = json.loads(idx.read_text(encoding="utf-8"))
    except Exception:
        return False
    if len(m.get("rounds", [])) < len(turni_meta):
        return False
    if any((r.get("played") or 0) == 0 for r in m.get("rounds", [])):
        return False
    ultimo = max((r.get("startsAt") or 0) for r in turni_meta) / 1000
    return time.time() > ultimo + CODA_S


def costruisci(tour_id, forza=False):
    print(f"[{tour_id}] leggo il torneo…", flush=True)
    t = lb.torneo(tour_id)
    if not t or not t.get("rounds"):
        print(f"      ! {tour_id}: non trovato", file=sys.stderr)
        return None

    if not forza and gia_completo(tour_id, t["rounds"]):
        print("      già completo, non lo ritocco", flush=True)
        return json.loads((OUT / tour_id / "index.json").read_text(encoding="utf-8"))

    tour = t["tour"]
    turni_meta = t["rounds"]
    campo = lb.giocatori(tour_id)

    print(f"      {tour.get('name')}: {len(turni_meta)} turni, "
          f"{len(campo)} giocatori", flush=True)

    turni = leggi_turni(tour_id, turni_meta)
    dest = OUT / tour_id

    # ---- listone: chi si puo' comprare all'asta ----
    listone = []
    for p in campo:
        fid = p.get("fideId")
        listone.append({
            "id": f"fide:{fid}" if fid else
                  f"nome:{(p.get('name') or '').lower().replace(' ', '-')}",
            "name": p.get("name") or "?",
            "title": p.get("title") or "",
            "rating": p.get("rating") or 0,
            # Il resto dell'app li chiama cosi': `country` per la bandierina,
            # `price` per l'asta, `fide` per la scheda giocatore.
            "country": p.get("fed") or "",
            "fide": fid or None,
            "price": prezzo(p.get("rating")),
        })

    # ---- un file per turno ----
    totale = {}
    scritti = 0
    for turno in turni:
        punti, colori = punti_del_turno(turno)
        for pid, p in punti.items():
            totale[pid] = totale.get(pid, 0) + p

        # Il piazzamento accanto al punteggio di giornata e' quello nel
        # torneo DOPO questo turno: dice se il tuo e' in testa, che e'
        # l'informazione che uno cerca guardando la giornata.
        dopo = classifica(totale)
        st = {pid: [punti[pid], dopo[pid][1], colori.get(pid, "")] for pid in punti}

        scrivi(dest / f"r{turno['n']}.json", {
            "id": f"{tour_id}/r{turno['n']}",
            "n": turno["n"],
            "date": iso((turni_meta[turno["n"] - 1].get("startsAt") or 0)),
            "start": turno["start"],
            "rounds": 1,
            "total": len(campo) or len(totale),
            "played": len(punti),
            "standings": st,
            "h2h": turno["h2h"],
            "upsets": turno["upsets"],
        })
        scrivi(dest / "partite" / f"r{turno['n']}.json",
               {"id": f"{tour_id}/r{turno['n']}", "games": turno["partite"]})
        scritti += 1

    # ---- il torneo intero, per le leghe a circuito ----
    # La classifica ufficiale viene dall'endpoint dei giocatori quando c'e':
    # tiene conto di forfait e spareggi meglio di una somma di PGN.
    ufficiale = {}
    for p in campo:
        fid = p.get("fideId")
        pid = f"fide:{fid}" if fid else f"nome:{(p.get('name') or '').lower().replace(' ', '-')}"
        if p.get("score") is not None and p.get("rank"):
            ufficiale[pid] = [round(float(p["score"]), 1), int(p["rank"])]
    finale = ufficiale or classifica(totale)

    giocati = sum(1 for t_ in turni if t_["partite"])
    scrivi(dest / "finale.json", {
        "id": tour_id,
        "date": iso((tour.get("dates") or [None])[0]),
        "start": ((tour.get("dates") or [0])[0] or 0) // 1000,
        "rounds": len(turni_meta),
        "total": len(campo) or len(finale),
        "played": len(finale),
        "standings": finale,
        "h2h": [h for t_ in turni for h in t_["h2h"]],
        "upsets": [u for t_ in turni for u in t_["upsets"]],
    })

    # ---- indice del torneo ----
    meta = {
        "id": tour_id,
        "name": tour.get("name") or tour_id,
        "slug": tour.get("slug") or "",
        "tier": tour.get("tier") or 0,
        "url": f"https://lichess.org/broadcast/{tour.get('slug') or tour_id}/{tour_id}",
        "dates": tour.get("dates") or [],
        "rounds": [{
            "n": t_["n"], "id": t_["id"], "name": t_["nome"],
            "start": t_["start"], "date": iso(turni_meta[t_["n"] - 1].get("startsAt")),
            "played": len(t_["partite"]),
        } for t_ in turni],
        "giocati": giocati,
        "players": listone,
        "generatedAt": int(time.time()),
    }
    peso = scrivi(dest / "index.json", meta)

    print(f"      scritti {scritti} turni + finale + indice ({peso // 1024} KB)",
          flush=True)
    return meta


def rigenera_indice():
    """
    L'elenco dei tornei in archivio: e' quello che l'app mostra a chi crea
    una lega, quindi deve contenere solo tornei che si possono davvero
    leggere — non l'intero catalogo di Lichess.
    """
    voci = []
    for d in sorted(OUT.glob("*/index.json")):
        m = json.loads(d.read_text(encoding="utf-8"))
        voci.append({
            "id": m["id"], "name": m["name"], "tier": m.get("tier", 0),
            "dates": m.get("dates", []), "url": m.get("url", ""),
            "rounds": len(m.get("rounds", [])),
            "giocati": m.get("giocati", 0),
            "players": len(m.get("players", [])),
        })
    voci.sort(key=lambda v: (v.get("dates") or [0])[0], reverse=True)
    scrivi(OUT / "index.json", {"generatedAt": int(time.time()), "tours": voci})
    print(f"[indice] {len(voci)} tornei in archivio", flush=True)
    return voci


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tours", nargs="*", help="id delle dirette Lichess")
    ap.add_argument("--cerca", help="cerca un torneo per nome e basta")
    ap.add_argument("--evidenza", action="store_true",
                    help="elenca le dirette attive e appena concluse")
    ap.add_argument("--aggiorna", action="store_true",
                    help="ricostruisce i tornei gia' in archivio")
    ap.add_argument("--seguiti", action="store_true",
                    help="costruisce i tornei elencati in data/bc/seguiti.json")
    ap.add_argument("--segui", metavar="ID",
                    help="aggiunge un torneo all'elenco dei seguiti e lo costruisce")
    ap.add_argument("--force", action="store_true",
                    help="riscarica anche i tornei gia' completi")
    args = ap.parse_args()

    if args.cerca:
        for tid, nome, tier, date in lb.cerca(args.cerca):
            quando = iso((date or [None])[0]) or "?"
            print(f"  {tid}  tier {tier}  {quando}  {nome}")
        return 0

    if args.evidenza:
        for t in lb.in_evidenza():
            if (t.get("tier") or 0) < 4:
                continue           # tier 3 e' il circolo sotto casa
            print(f"  {t['id']}  tier {t['tier']}  {t['stato']:<8} {t['name']}")
        return 0

    seguiti = []
    if SEGUITI.exists():
        seguiti = json.loads(SEGUITI.read_text(encoding="utf-8")).get("tours", [])

    tours = list(args.tours)
    if args.segui:
        tours.append(args.segui)
        if args.segui not in seguiti:
            seguiti.append(args.segui)
            scrivi(SEGUITI, {"tours": seguiti})
            print(f"[seguiti] aggiunto {args.segui}", flush=True)
    if args.seguiti:
        tours += seguiti
    if args.aggiorna:
        tours += [d.name for d in OUT.glob("*/") if (d / "index.json").exists()]
    tours = list(dict.fromkeys(t for t in tours if t))

    if not tours:
        print("Niente da fare: passa almeno un id, oppure --aggiorna.",
              file=sys.stderr)
        return 1

    fatti = 0
    for tid in tours:
        if costruisci(tid, forza=args.force):
            fatti += 1

    rigenera_indice()
    print(f"\n{fatti} tornei su {len(tours)} archiviati.")
    return 0 if fatti else 1


if __name__ == "__main__":
    raise SystemExit(main())
