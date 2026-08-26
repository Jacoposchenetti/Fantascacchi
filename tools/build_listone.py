#!/usr/bin/env python3
"""
Genera data/listone.json: il pool di giocatori acquistabili all'asta,
con prezzi derivati da dati REALI di chess.com (rating blitz + rendimento
nei Titled Tuesday recenti).

Uso:
    python tools/build_listone.py [--events 6] [--top 90]

Perche' esiste: gli ID dei Titled Tuesday hanno un suffisso numerico opaco
(es. ...-august-25-2026-31064127), quindi non sono costruibili da una data.
Vanno scoperti partendo dai tornei giocati da alcuni "anchor player" che
partecipano quasi sempre.
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.chess.com/pub"
UA = "fantascacchi/0.1 (listone builder; https://github.com/)"

# Giocatori usati solo per SCOPRIRE gli ID dei tornei: partecipano quasi sempre.
ANCHORS = ["hikaru", "polish_fighter3000", "ghandeevam2003", "nikotheodorou"]

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11,
    "december": 12,
}
TT_RE = re.compile(
    r"titled-tuesday-(?:blitz-)?([a-z]+)-(\d{1,2})-(\d{4})-(\d+)$"
)

SLEEP = 0.12  # cortesia verso l'API, richieste seriali


def get(url, retries=3):
    """GET JSON con User-Agent (chess.com rifiuta le richieste senza)."""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 429:
                time.sleep(2 + attempt * 3)
                continue
            if attempt == retries - 1:
                return None
        except Exception:
            if attempt == retries - 1:
                return None
            time.sleep(1 + attempt)
    return None


def discover_events(limit):
    """Trova gli ultimi Titled Tuesday, ordinati dal piu' recente."""
    found = {}
    for anchor in ANCHORS:
        data = get(f"{API}/player/{anchor}/tournaments")
        time.sleep(SLEEP)
        if not data:
            continue
        for t in data.get("finished", []):
            tid = t.get("@id", "").rsplit("/", 1)[-1]
            m = TT_RE.match(tid)
            if not m:
                continue
            month, day, year, _ = m.groups()
            if month not in MONTHS:
                continue
            key = (int(year), MONTHS[month], int(day))
            found.setdefault(tid, key)
        if len(found) > limit * 4:
            break
    ordered = sorted(found.items(), key=lambda kv: kv[1], reverse=True)
    return [(tid, "%04d-%02d-%02d" % key) for tid, key in ordered[:limit]]


def final_standings(tid, total_rounds=11):
    """
    Classifica finale di un evento.
    Il gruppo dell'ultimo turno porta i punti CUMULATIVI di fine torneo,
    quindi basta una sola chiamata. Se l'ultimo turno non esiste si
    scende finche' non si trova un turno valido.
    """
    for rnd in range(total_rounds, 0, -1):
        grp = get(f"{API}/tournament/{tid}/{rnd}/1")
        time.sleep(SLEEP)
        if grp and grp.get("players"):
            ratings = {}
            for g in grp.get("games", []):
                for side in ("white", "black"):
                    p = g.get(side) or {}
                    u = (p.get("username") or "").lower()
                    if u and p.get("rating"):
                        ratings[u] = p["rating"]
            players = [
                {"username": (p.get("username") or "").lower(),
                 "points": p.get("points") or 0}
                for p in grp["players"] if p.get("username")
            ]
            players.sort(key=lambda p: -p["points"])
            return players, ratings
    return [], {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--events", type=int, default=6,
                    help="quanti Titled Tuesday recenti aggregare")
    ap.add_argument("--top", type=int, default=90,
                    help="quanti giocatori tenere nel listone")
    ap.add_argument("--budget", type=int, default=500)
    args = ap.parse_args()

    print(f"[1/4] Scopro gli ultimi {args.events} Titled Tuesday...", flush=True)
    events = discover_events(args.events)
    if not events:
        print("ERRORE: nessun torneo trovato (API irraggiungibile?)", file=sys.stderr)
        return 1
    for tid, d in events:
        print(f"      {d}  {tid}", flush=True)

    print(f"[2/4] Scarico le classifiche finali...", flush=True)
    agg = {}      # username -> stats aggregate
    ratings = {}  # username -> ultimo rating blitz visto
    for tid, date in events:
        players, rts = final_standings(tid)
        if not players:
            print(f"      ! nessuna classifica per {tid}", flush=True)
            continue
        ratings.update(rts)
        # ranking con pari merito standard (1,2,2,4)
        rank, prev_pts, seen = 0, None, 0
        for p in players:
            seen += 1
            if p["points"] != prev_pts:
                rank, prev_pts = seen, p["points"]
            a = agg.setdefault(p["username"], {"events": 0, "pts": 0.0,
                                               "best": 9999, "placements": []})
            a["events"] += 1
            a["pts"] += p["points"]
            a["best"] = min(a["best"], rank)
            a["placements"].append(rank)
        print(f"      {date}: {len(players)} giocatori", flush=True)

    if not agg:
        print("ERRORE: nessun dato aggregato", file=sys.stderr)
        return 1

    # Preselezione: chi ha giocato di piu' e segnato di piu'
    ranked = sorted(
        agg.items(),
        key=lambda kv: (kv[1]["events"], kv[1]["pts"] / max(kv[1]["events"], 1)),
        reverse=True,
    )[: args.top]

    print(f"[3/4] Scarico i profili di {len(ranked)} giocatori...", flush=True)
    players = []
    for i, (user, a) in enumerate(ranked, 1):
        prof = get(f"{API}/player/{user}")
        time.sleep(SLEEP)
        stats = get(f"{API}/player/{user}/stats")
        time.sleep(SLEEP)
        blitz = None
        if stats:
            blitz = (((stats.get("chess_blitz") or {}).get("last") or {})
                     .get("rating"))
        blitz = blitz or ratings.get(user) or 2500
        players.append({
            "id": user,
            "username": (prof or {}).get("username") or user,
            "name": (prof or {}).get("name") or (prof or {}).get("username") or user,
            "title": (prof or {}).get("title") or "",
            "country": ((prof or {}).get("country") or "").rsplit("/", 1)[-1],
            "avatar": (prof or {}).get("avatar") or "",
            "rating": blitz,
            "events": a["events"],
            "avgPoints": round(a["pts"] / a["events"], 2),
            "bestPlacement": a["best"],
        })
        if i % 10 == 0:
            print(f"      {i}/{len(ranked)}", flush=True)

    print("[4/4] Calcolo i prezzi...", flush=True)
    rmin = min(p["rating"] for p in players)
    rmax = max(p["rating"] for p in players)
    fmax = max(p["avgPoints"] for p in players) or 1
    span = max(rmax - rmin, 1)
    for p in players:
        rating_n = (p["rating"] - rmin) / span
        form_n = p["avgPoints"] / fmax
        power = 0.65 * rating_n + 0.35 * form_n
        # esponente > 1: i top costano sproporzionatamente di piu' (come il fantacalcio)
        p["price"] = int(round(6 + (power ** 1.7) * 144))
        p["power"] = round(power, 4)

    players.sort(key=lambda p: -p["price"])

    out = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "api.chess.com",
        "events": [{"id": t, "date": d} for t, d in events],
        "budget": args.budget,
        "players": players,
    }
    dest = Path(__file__).resolve().parent.parent / "data" / "listone.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nScritto {dest} ({len(players)} giocatori)")
    print("\nTop 12:")
    for p in players[:12]:
        print(f"  {p['price']:>4}cr  {p['title']:<4} {p['name'][:28]:<28} "
              f"{p['rating']} blitz  media {p['avgPoints']}/11")
    return 0


if __name__ == "__main__":
    sys.exit(main())
