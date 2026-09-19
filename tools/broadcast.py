#!/usr/bin/env python3
"""
Accesso alle dirette di Lichess: l'equivalente di `build_listone.get` per i
tornei classici.

Perche' Lichess e non chess.com
-------------------------------
I tornei classici si giocano sulla scacchiera vera, non su un sito. Chi li
trasmette pubblica i PGN turno per turno, e Lichess lo fa per tutto quello
che conta — Tata Steel, Candidati, Norway Chess, Olimpiadi — con un'API
aperta, senza chiave e senza limiti dichiarati.

Due endpoint, due nature diverse
--------------------------------
  /api/broadcast/...            documentato, CORS `*`: lo puo' leggere anche
                                il browser.
  /broadcast/<id>/players       JSON non documentato e SENZA CORS: da qui
                                passa solo la CI. E' pero' l'unico posto in
                                cui la classifica arriva gia' fatta, con
                                punti, piazzamento, performance e FIDE id.

Di conseguenza l'archivio lo costruisce la GitHub Action, come per i Titled
Tuesday, e l'app legge file statici.
"""

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://lichess.org/api"
SITO = "https://lichess.org"

# Lichess chiede di farsi riconoscere. Un User-Agent con un contatto e' la
# differenza fra "traffico anomalo" e "un progetto che sta usando l'API".
UA = "Fantascacchi/1.0 (+https://github.com/Jacoposchenetti/Fantascacchi)"

PAUSA_S = 1.0          # fra una chiamata e l'altra, per non pesare


def _leggi(url, tentativi=3, testo=False):
    """GET con ritenti. Restituisce None invece di far cadere tutto."""
    for n in range(tentativi):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "application/x-chess-pgn" if testo else "application/json",
            })
            with urllib.request.urlopen(req, timeout=60) as r:
                dati = r.read().decode("utf-8", errors="replace")
            return dati if testo else json.loads(dati)
        except urllib.error.HTTPError as e:
            # 404 e' una risposta, non un guasto: inutile insistere.
            if e.code == 404:
                return None
            time.sleep(2 * (n + 1))
        except Exception:
            time.sleep(2 * (n + 1))
    return None


def torneo(tour_id):
    """Metadati e turni: {'tour': {...}, 'rounds': [{id, name, startsAt, finished}]}."""
    return _leggi(f"{API}/broadcast/{tour_id}")


def giocatori(tour_id):
    """
    Il campo di partenza con la classifica: name, title, rating, fideId,
    fed, played, score, rank, performances.

    E' anche il listone della lega: in un torneo classico i giocatori
    all'asta sono esattamente questi, non un elenco generale di forti.
    """
    return _leggi(f"{SITO}/broadcast/{tour_id}/players") or []


def pgn_turno(round_id):
    """Il PGN di tutte le partite di un turno, mosse comprese."""
    return _leggi(f"{API}/broadcast/round/{round_id}.pgn", testo=True) or ""


def cerca(query):
    """Cerca un torneo per nome. Restituisce [(id, nome, tier, date)]."""
    d = _leggi(f"{API}/broadcast/search?q={urllib.parse.quote(query)}") or {}
    fuori = []
    for t in d.get("currentPageResults") or d.get("results") or []:
        tour = t.get("tour", t)
        fuori.append((tour.get("id"), tour.get("name"), tour.get("tier"),
                      tour.get("dates")))
    return fuori


def in_evidenza():
    """Le dirette attive, in arrivo e appena concluse."""
    d = _leggi(f"{API}/broadcast/top?page=1") or {}
    fuori = []
    for chiave in ("active", "upcoming", "past"):
        sezione = d.get(chiave) or []
        # `active` e `upcoming` sono liste, `past` e' impaginato: iterare il
        # dizionario a occhi chiusi restituiva le sue CHIAVI, cioe' stringhe.
        if isinstance(sezione, dict):
            sezione = sezione.get("currentPageResults") or []
        for t in sezione:
            tour = t.get("tour", t)
            fuori.append({
                "id": tour.get("id"),
                "name": tour.get("name"),
                "tier": tour.get("tier"),
                "dates": tour.get("dates"),
                "stato": chiave,
            })
    return fuori


# --------------------------- lettura dei PGN ---------------------------- #

_TAG = re.compile(r'^\[([A-Za-z0-9_]+)\s+"(.*)"\]\s*$', re.M)


def partite(pgn):
    """
    Spezza un PGN in partite, ognuna come dizionario delle sue intestazioni
    piu' `mosse` (il testo delle mosse, che a noi serve solo per sapere se
    la partita c'e' davvero).

    Il taglio si fa sulla riga vuota seguita da `[Event`: dentro le mosse
    quella sequenza non compare mai, mentre un semplice split sulla riga
    vuota spezzerebbe anche fra intestazioni e mosse.
    """
    fuori = []
    for blocco in re.split(r"\n\n(?=\[Event )", (pgn or "").strip()):
        if not blocco.strip():
            continue
        g = {k: v for k, v in _TAG.findall(blocco)}
        if not g:
            continue
        coda = _TAG.sub("", blocco).strip()
        g["mosse"] = coda
        fuori.append(g)
    return fuori


def chiave(g, colore):
    """
    L'identita' di uno scacchista.

    Il FIDE id e' l'unica cosa stabile: i nomi cambiano traslitterazione da
    un torneo all'altro ("Praggnanandhaa R", "Praggnanandhaa, R"), e due
    omonimi esistono davvero. Quando manca si ripiega sul nome normalizzato,
    che e' meglio di niente ma non attraversa i tornei.
    """
    fid = (g.get(f"{colore}FideId") or "").strip()
    if fid and fid.isdigit() and fid != "0":
        return f"fide:{fid}"
    nome = (g.get(colore) or "").strip().lower()
    nome = re.sub(r"[^a-z0-9]+", "-", nome).strip("-")
    return f"nome:{nome}" if nome else ""


def elo(g, colore):
    try:
        return int(g.get(f"{colore}Elo") or 0)
    except ValueError:
        return 0


def esito(g):
    """'w', 'b', 'd' oppure None se la partita non e' finita."""
    return {"1-0": "w", "0-1": "b", "1/2-1/2": "d"}.get(g.get("Result"))
