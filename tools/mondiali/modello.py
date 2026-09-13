#!/usr/bin/env python3
"""
Si puo' prevedere la classifica di un Mondiale Rapid/Blitz meglio che
ordinando per rating?

    python tools/mondiali/modello.py tools/mondiali/mondiali.csv

L'avversario da battere non e' "il caso": e' l'Elo, che e' gia' un modello
probabilistico calibrato su un secolo di partite. Prevedere una classifica
ordinando i giocatori per rating e' gratis e funziona bene. Un modello che
non lo supera non serve a niente, per quanto sofisticato sia.

Due regole per non ingannarsi:

1. Si addestra solo sul PASSATO. Per prevedere il 2024 si usa il 2014-2023
   e basta. Mescolare le edizioni gonfierebbe i risultati: il modello
   imparerebbe che Carlsen fa bene dal fatto che ha fatto bene nel 2025.

2. Lo storico di un giocatore si costruisce solo con le sue edizioni
   PRECEDENTI. E' la variabile piu' promettente e anche la piu' facile da
   sporcare senza accorgersene.

Si guarda anche solo la testa della classifica, perche' li' e' dove il
problema e' davvero difficile: fra i primi 50 i rating sono vicini e
l'ordinamento per Elo perde quasi tutto il suo potere.
"""

import sys
import unicodedata
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
import xgboost as xgb

CSV = sys.argv[1] if len(sys.argv) > 1 else "tools/mondiali/mondiali.csv"
df = pd.read_csv(CSV)
df = df.dropna(subset=["rating", "punti", "rango"]).copy()


def chiave(nome):
    """'Carlsen, Magnus' e 'Carlsen Magnus' sono la stessa persona."""
    s = unicodedata.normalize("NFKD", str(nome)).encode("ascii", "ignore").decode()
    return " ".join(sorted(s.replace(",", " ").lower().split()))


df["gio"] = df["nome"].map(chiave)
df["evento"] = df["anno"].astype(str) + "-" + df["tipo"]

print(f"Righe: {len(df):,}  ·  eventi: {df.evento.nunique()}  "
      f"·  giocatori distinti: {df.gio.nunique():,}")
print(f"Anni: {df.anno.min()}-{df.anno.max()}  ·  "
      f"rating da {df.rating.min():.0f} a {df.rating.max():.0f}\n")

# ------------------------- variabili note PRIMA del torneo -------------------

df = df.sort_values(["anno", "tipo", "rango"]).reset_index(drop=True)

# Rango atteso dal solo rating: e' la previsione di riferimento.
df["rango_elo"] = df.groupby("evento")["rating"].rank(ascending=False, method="min")
df["n_gioc"] = df.groupby("evento")["gio"].transform("size")
df["rating_z"] = df.groupby("evento")["rating"].transform(
    lambda s: (s - s.mean()) / s.std())
df["rating_medio_campo"] = df.groupby("evento")["rating"].transform("mean")
df["e_blitz"] = (df["tipo"] == "blitz").astype(int)

# Percentili, per confrontare eventi di dimensione diversa.
df["perc_reale"] = df.groupby("evento")["rango"].transform(lambda s: s / s.max())
df["perc_elo"] = df.groupby("evento")["rango_elo"].transform(lambda s: s / s.max())

# Sovrarendimento: quanto ha fatto meglio (o peggio) del suo rating.
df["scarto"] = df["perc_elo"] - df["perc_reale"]      # >0 = meglio dell'atteso

# ------------------- storico del giocatore, solo dal passato -----------------

df = df.sort_values(["anno", "tipo"]).reset_index(drop=True)
storia = {}
prec_n, prec_scarto, prec_perf = [], [], []
for r in df.itertuples():
    passate = storia.get(r.gio, [])
    prec_n.append(len(passate))
    prec_scarto.append(np.mean([p[0] for p in passate]) if passate else 0.0)
    prec_perf.append(np.mean([p[1] for p in passate]) if passate else 0.0)
    delta_perf = (r.performance - r.rating) if pd.notna(r.performance) else 0.0
    storia.setdefault(r.gio, []).append((r.scarto, delta_perf))

df["ed_precedenti"] = prec_n
df["scarto_passato"] = prec_scarto        # sovrarendimento medio nelle passate
df["perf_passata"] = prec_perf            # performance meno rating, in passato

CARATT = ["rating", "rango_elo", "rating_z", "n_gioc", "rating_medio_campo",
          "e_blitz", "ed_precedenti", "scarto_passato", "perf_passata"]

# ------------------------------- valutazione ---------------------------------

def misura(veri, previsti):
    """Spearman e errore medio di posizione, su un singolo evento."""
    rho = spearmanr(veri, previsti).statistic
    prev_rank = pd.Series(previsti).rank(method="min").values
    vero_rank = pd.Series(veri).rank(method="min").values
    return rho, np.abs(prev_rank - vero_rank).mean()


anni = sorted(df.anno.unique())
righe = []

for anno in anni[3:]:                       # servono almeno 3 anni di storia
    tr = df[df.anno < anno]
    te = df[df.anno == anno]
    if len(tr) < 300 or te.empty:
        continue

    def nuovo():
        return xgb.XGBRegressor(
            n_estimators=400, max_depth=4, learning_rate=0.05,
            subsample=0.85, colsample_bytree=0.85, min_child_weight=10,
            reg_lambda=3.0, random_state=0, n_jobs=-1)

    # Modello A: prevede direttamente il percentile finale.
    m = nuovo().fit(tr[CARATT], tr["perc_reale"])

    # Modello B: prevede solo lo SCARTO dalla previsione dell'Elo.
    #
    # E' la formulazione giusta per la domanda "c'e' segnale oltre l'Elo?".
    # Chiedere a un albero di reimparare da zero la relazione fra rating e
    # classifica e' uno spreco: quella relazione e' monotona e regolare, e
    # gli alberi la approssimano a gradini. Dandogli in pasto solo il
    # residuo, tutta la sua capacita' va sulla correzione, che e' l'unica
    # cosa che puo' aggiungere qualcosa.
    mb = nuovo().fit(tr[CARATT], tr["scarto"])

    # Modello C: una retta, e nient'altro.
    #
    # Quando il segnale e' debole — qui la persistenza del sovrarendimento
    # vale +0.15 di correlazione — un modello con 400 alberi e nove
    # variabili non lo estrae, lo seppellisce sotto il rumore che si e'
    # cucito addosso. Una sola pendenza stimata ai minimi quadrati usa
    # tutto il segnale che c'e' e non puo' inventarsene altro.
    passate = tr[tr["ed_precedenti"] >= 1]
    b = (np.polyfit(passate["scarto_passato"], passate["scarto"], 1)[0]
         if len(passate) >= 100 else 0.0)

    for ev, g in te.groupby("evento"):
        prev = m.predict(g[CARATT])
        prev_b = g["perc_elo"].values - mb.predict(g[CARATT])
        prev_c = g["perc_elo"].values - b * g["scarto_passato"].values
        r_mod, e_mod = misura(g["rango"].values, prev)
        r_res, e_res = misura(g["rango"].values, prev_b)
        r_lin, e_lin = misura(g["rango"].values, prev_c)
        r_elo, e_elo = misura(g["rango"].values, g["rango_elo"].values)

        # Solo la testa: li' i rating sono vicini e l'Elo fatica.
        testa = g.nsmallest(50, "rango_elo")
        rt_mod, _ = misura(testa["rango"].values, m.predict(testa[CARATT]))
        rt_res, _ = misura(testa["rango"].values,
                           testa["perc_elo"].values - mb.predict(testa[CARATT]))
        rt_lin, _ = misura(testa["rango"].values,
                           testa["perc_elo"].values - b * testa["scarto_passato"].values)
        rt_elo, _ = misura(testa["rango"].values, testa["rango_elo"].values)

        righe.append(dict(evento=ev, n=len(g),
                          rho_elo=r_elo, rho_mod=r_mod, rho_res=r_res, rho_lin=r_lin,
                          err_elo=e_elo, err_mod=e_mod, err_res=e_res, err_lin=e_lin,
                          rho_elo50=rt_elo, rho_mod50=rt_mod, rho_res50=rt_res,
                          rho_lin50=rt_lin, b=b))

res = pd.DataFrame(righe)

print("=" * 78)
print("PREVISIONE IN AVANTI — addestrato solo sugli anni precedenti")
print("=" * 78)
print(f"{'evento':<12} {'n':>4} {'Spearman (tutti)':>28} {'errore posizioni':>26}")
print(f"{'':<12} {'':>4} {'Elo':>9} {'diretto':>9} {'residuo':>9} {'lineare':>9} "
      f"{'errElo':>7} {'errLin':>8}")
print("-" * 78)
for r in res.itertuples():
    print(f"{r.evento:<12} {r.n:>4} {r.rho_elo:>9.3f} {r.rho_mod:>9.3f} "
          f"{r.rho_res:>9.3f} {r.rho_lin:>9.3f} {r.err_elo:>7.1f} {r.err_lin:>8.1f}")
print("-" * 78)
print(f"{'MEDIA':<12} {res.n.mean():>4.0f} {res.rho_elo.mean():>9.3f} "
      f"{res.rho_mod.mean():>9.3f} {res.rho_res.mean():>9.3f} {res.rho_lin.mean():>9.3f} "
      f"{res.err_elo.mean():>7.1f} {res.err_lin.mean():>8.1f}")

print("\n" + "=" * 78)
print("RIEPILOGO — chi batte l'Elo, e di quanto")
print("=" * 78)
for eti, rho, err, rho50 in [
        ("modello diretto (prevede la classifica)", res.rho_mod, res.err_mod, res.rho_mod50),
        ("modello sul residuo (corregge l'Elo)", res.rho_res, res.err_res, res.rho_res50),
        ("correzione lineare (una sola pendenza)", res.rho_lin, res.err_lin, res.rho_lin50)]:
    vinte = (rho > res.rho_elo).sum()
    print(f"\n  {eti}")
    print(f"    batte l'Elo in {vinte}/{len(res)} eventi ({vinte / len(res) * 100:.0f}%)")
    print(f"    Spearman              {(rho - res.rho_elo).mean():+.3f}")
    print(f"    posizioni risparmiate {(res.err_elo - err).mean():+.1f}  (positivo = meglio)")
    print(f"    sui primi 50          {(rho50 - res.rho_elo50).mean():+.3f}")

# ------------------------------ cosa usa il modello --------------------------

finale = xgb.XGBRegressor(
    n_estimators=400, max_depth=4, learning_rate=0.05, subsample=0.85,
    colsample_bytree=0.85, min_child_weight=10, reg_lambda=3.0,
    random_state=0, n_jobs=-1).fit(df[CARATT], df["perc_reale"])
imp = pd.Series(finale.feature_importances_, index=CARATT).sort_values(ascending=False)
print("\nSu cosa si appoggia il modello:")
for k, v in imp.items():
    print(f"  {k:22} {v:.3f}  {'#' * int(v * 60)}")

# Quanto e' persistente il sovrarendimento? E' la domanda dietro tutto.
ripetuti = df[df.ed_precedenti >= 2]
if len(ripetuti) > 50:
    rho = spearmanr(ripetuti["scarto_passato"], ripetuti["scarto"]).statistic
    print(f"\nPersistenza del sovrarendimento (chi ha gia' 2+ edizioni alle "
          f"spalle):\n  correlazione fra passato e presente: {rho:+.3f} "
          f"su {len(ripetuti):,} casi")
