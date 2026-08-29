#!/usr/bin/env python3
"""
Pubblica i risultati dei Titled Tuesday come file statici, cosi' che l'app
non debba scaricare niente di pesante e i punteggi si aggiornino da soli.

Perche' esiste
--------------
La classifica completa di un torneo pesa circa mezzo mega, perche' contiene
il PGN di ogni partita. Farla scaricare al browser significa mezzo mega a
giornata a persona. Qui la scarichiamo una volta sola in CI e ne salviamo
l'estratto che serve davvero: username -> [punti, piazzamento]. Circa 8 KB.

Da quel momento l'app legge un file minuscolo e calcola i fantapunti da sola,
senza che nessuno debba premere niente.

Uso:
    python tools/build_results.py [--events 12] [--keep 60]
"""

import argparse
import json
import sys
import time
from pathlib import Path

# Le funzioni di accesso a chess.com stanno gia' li': duplicarle
# significherebbe doverle correggere in due posti.
from build_listone import get, discover_events, final_standings, API

OUT = Path(__file__).resolve().parent.parent / "data" / "tt"

# Un Titled Tuesday dura circa tre ore. Serve a capire se un torneo senza
# risultati e' ancora in corso o se e' finito e i dati non sono arrivati.
DURATA_STIMATA_S = 3 * 60 * 60


def tournament_meta(tid):
    """Orari e dimensione del torneo, dal documento principale."""
    root = get(f"{API}/tournament/{tid}")
    if not root:
        return None
    s = root.get("settings") or {}
    return {
        "name": root.get("name") or tid,
        "start": root.get("start_time"),
        "finish": root.get("finish_time"),
        "total": s.get("registered_user_count"),
        "rounds": s.get("total_rounds") or 11,
        "status": root.get("status"),
    }


def build_event(tid, date):
    """Estratto di un torneo: solo cio' che serve a calcolare i fantapunti."""
    meta = tournament_meta(tid)
    if not meta:
        return None

    players, _ = final_standings(tid, meta["rounds"])
    if not players:
        return None

    # Pari merito standard: 1, 2, 2, 4.
    standings, rank, prev = {}, 0, None
    for i, p in enumerate(players):
        if p["points"] != prev:
            rank, prev = i + 1, p["points"]
        # Coppia invece di oggetto: su 260 giocatori sono kilobyte risparmiati.
        standings[p["username"]] = [p["points"], rank]

    return {
        "id": tid,
        "date": date,
        "name": meta["name"],
        "start": meta["start"],
        "finish": meta["finish"],
        "rounds": meta["rounds"],
        "total": meta["total"] or len(players),
        "played": len(players),
        "standings": standings,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--events", type=int, default=12,
                    help="quanti tornei recenti controllare a ogni giro")
    ap.add_argument("--keep", type=int, default=60,
                    help="quanti file di risultati conservare nel repository")
    ap.add_argument("--force", action="store_true",
                    help="riscarica anche i tornei gia' salvati")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)

    print(f"[1/3] Cerco gli ultimi {args.events} Titled Tuesday...", flush=True)
    events = discover_events(args.events)
    if not events:
        print("ERRORE: nessun torneo trovato", file=sys.stderr)
        return 1

    print("[2/3] Scarico solo quelli che mancano...", flush=True)
    nuovi = 0
    for tid, date in events:
        dest = OUT / f"{tid}.json"
        if dest.exists() and not args.force:
            print(f"      = {date}  gia' presente", flush=True)
            continue
        ev = build_event(tid, date)
        if not ev:
            print(f"      ! {date}  classifica non disponibile", flush=True)
            continue
        dest.write_text(json.dumps(ev, ensure_ascii=False, separators=(",", ":")),
                        encoding="utf-8")
        nuovi += 1
        print(f"      + {date}  {ev['played']} giocatori  "
              f"({dest.stat().st_size // 1024} KB)", flush=True)
        time.sleep(0.2)

    print("[3/3] Aggiorno l'indice...", flush=True)
    index = []
    for f in OUT.glob("titled-tuesday-*.json"):
        try:
            ev = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        index.append({
            "id": ev["id"], "date": ev["date"],
            "start": ev.get("start"), "finish": ev.get("finish"),
            "rounds": ev.get("rounds", 11), "played": ev.get("played", 0),
            "total": ev.get("total", 0),
        })
    index.sort(key=lambda e: e["date"], reverse=True)

    # Il repository non deve crescere all'infinito: le stagioni vecchie
    # restano nella cronologia git, non nella cartella.
    for old in index[args.keep:]:
        (OUT / f"{old['id']}.json").unlink(missing_ok=True)
    index = index[: args.keep]

    (OUT / "index.json").write_text(
        json.dumps({
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "durataStimataS": DURATA_STIMATA_S,
            "events": index,
        }, ensure_ascii=False, indent=1),
        encoding="utf-8")

    print(f"\nFatto: {nuovi} tornei nuovi, {len(index)} nell'indice.")
    if index:
        print(f"Piu' recente: {index[0]['date']}  ({index[0]['played']} giocatori)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
