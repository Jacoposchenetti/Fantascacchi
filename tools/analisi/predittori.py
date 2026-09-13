#!/usr/bin/env python3
"""
Cosa distingue una rosa vincente, sui dati della simulazione.

    python tools/analisi/predittori.py rose8.csv

Il ML qui serve a SPIEGARE, non a indovinare: i punti li ha gia' calcolati
il motore vero dell'app dentro la simulazione. La domanda e' quale
caratteristica della rosa li muove, e di quanto.

Tre passaggi, in ordine di quanto ci si puo' fidare:

1. Correlazioni semplici. Grezze, ma leggibili e difficili da sbagliare.

2. XGBoost + importanza per permutazione. L'importanza "gain" nativa
   gonfia le variabili continue e va presa con le pinze; la permutazione
   misura invece quanto peggiora la previsione se quella colonna viene
   mescolata, sul set di prova. E' piu' lenta e molto piu' onesta.

3. Effetti parziali. Sapere che una variabile conta non dice in che
   verso ne' dove sta il punto di svolta, che e' quello che serve per
   giocare. Qui si guarda la previsione del modello al variare di una
   colonna sola.

Attenzione ai gruppi: le rose della stessa lega si contendono gli stessi
giocatori e giocano gli stessi tornei, quindi non sono indipendenti. La
divisione fra addestramento e prova e' PER LEGA, altrimenti il modello
sbircia le risposte dei compagni di tavolo e sembra piu' bravo di quanto e'.
"""

import sys
import numpy as np
import pandas as pd
from sklearn.inspection import permutation_importance
from sklearn.metrics import r2_score
from sklearn.model_selection import GroupShuffleSplit
import xgboost as xgb

CSV = sys.argv[1] if len(sys.argv) > 1 else "rose8.csv"
df = pd.read_csv(CSV)

ESCLUSE = ["lega", "punti", "posizione", "vinta"]
X_COLS = [c for c in df.columns if c not in ESCLUSE]

print(f"Rose simulate: {len(df):,}  ·  leghe: {df.lega.nunique():,}  "
      f"·  caratteristiche: {len(X_COLS)}")
print(f"Punti stagione: media {df.punti.mean():.0f}, "
      f"dev.st. {df.punti.std():.0f}, "
      f"dal {df.punti.quantile(.05):.0f} al {df.punti.quantile(.95):.0f} "
      f"(5°-95° percentile)\n")

X, y, g = df[X_COLS], df["punti"], df["lega"]

# Divisione PER LEGA: rose dello stesso tavolo non finiscono a cavallo.
tr, te = next(GroupShuffleSplit(n_splits=1, test_size=0.25,
                               random_state=0).split(X, y, g))

# ------------------------------ 1. correlazioni ------------------------------

print("=" * 72)
print("1. CORRELAZIONE COI PUNTI (grezza, una variabile alla volta)")
print("=" * 72)
corr = df[X_COLS + ["punti"]].corr()["punti"].drop("punti").sort_values(key=abs,
                                                                       ascending=False)
for nome, v in corr.items():
    barra = "#" * int(abs(v) * 40)
    print(f"  {nome:24} {v:+.3f}  {barra}")

# --------------------------------- 2. modello --------------------------------

modello = xgb.XGBRegressor(
    n_estimators=700, max_depth=5, learning_rate=0.05,
    subsample=0.8, colsample_bytree=0.8, min_child_weight=8,
    reg_lambda=2.0, random_state=0, n_jobs=-1,
)
modello.fit(X.iloc[tr], y.iloc[tr])

r2_tr = r2_score(y.iloc[tr], modello.predict(X.iloc[tr]))
r2_te = r2_score(y.iloc[te], modello.predict(X.iloc[te]))
print(f"\n{'=' * 72}")
print("2. XGBOOST — quanto conta ciascuna, a parita' di tutto il resto")
print("=" * 72)
print(f"  R² addestramento {r2_tr:.3f}  ·  R² prova {r2_te:.3f}")
if r2_te < 0.25:
    print("  ATTENZIONE: il modello spiega poco. Il caso pesa piu' della rosa.")

perm = permutation_importance(modello, X.iloc[te], y.iloc[te],
                              n_repeats=12, random_state=0, n_jobs=-1,
                              scoring="r2")
ordine = np.argsort(perm.importances_mean)[::-1]
print("\n  Importanza per permutazione (caduta di R² se la colonna e' mescolata):")
for i in ordine:
    m, sd = perm.importances_mean[i], perm.importances_std[i]
    if m <= 0.0005:
        continue
    print(f"  {X_COLS[i]:24} {m:.4f} ±{sd:.4f}  {'#' * int(m * 300)}")

# ------------------------------ 3. effetti parziali --------------------------

print(f"\n{'=' * 72}")
print("3. IN CHE VERSO — punti previsti al variare di una sola colonna")
print("=" * 72)

principali = [X_COLS[i] for i in ordine[:6]]
base = X.iloc[te].median()

for col in principali:
    q = np.quantile(X[col], [0.05, 0.25, 0.5, 0.75, 0.95])
    finta = pd.DataFrame([base] * len(q))
    finta[col] = q
    prev = modello.predict(finta[X_COLS])
    delta = prev[-1] - prev[0]
    print(f"\n  {col}   (dal 5° al 95° percentile: {delta:+.0f} punti)")
    for valore, p in zip(q, prev):
        print(f"      {valore:9.3f} -> {p:7.0f}")

# ------------------------- 4. e per VINCERE la lega? -------------------------

print(f"\n{'=' * 72}")
print("4. LE ROSE CHE HANNO VINTO, CONFRONTATE CON LE ALTRE")
print("=" * 72)
vin, per = df[df.vinta == 1], df[df.vinta == 0]
print(f"  {'caratteristica':24} {'vincenti':>10} {'altre':>10} {'scarto':>10}")
righe = []
for c in X_COLS:
    a, b = vin[c].mean(), per[c].mean()
    sd = df[c].std()
    righe.append((abs(a - b) / sd if sd else 0, c, a, b))
righe.sort(reverse=True)
for eff, c, a, b in righe[:12]:
    print(f"  {c:24} {a:10.3f} {b:10.3f} {a - b:+10.3f}   ({eff:.2f} dev.st.)")
