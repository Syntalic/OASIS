# Optuna floor calibration

Tunes the four binder floors against the eval, instead of the current hand-set guesses
(`denseMargin = 0.02` especially). Each trial re-binds the existing corpus (`pnpm run enrich`,
reusing `dist/cache` — no recrawl) and scores `eval:usefulness`; the study Pareto-optimizes
**good_recall@6 ↑ vs bad_rate@8 ↓** (the precision/recall tradeoff the floors control).

Floors (and their current defaults) it sweeps — see `src/embed/bind-endpoints.ts`:
`OASIS_BIND_FLOOR` (0.78) · `OASIS_BIND_SPARSE_FLOOR` (0.035) · `OASIS_BIND_STRONG_SPARSE` (0.12) ·
`OASIS_BIND_DENSE_MARGIN` (0.02). `enrich-facets.ts` reads these from env; unset → the defaults.

## Run locally (recommended)
The harness drives the real `enrich` + `eval` per trial, so it needs the repo + node + a built
`dist/` (which you already have after `pnpm build`):
```bash
pip install optuna
GOOGLE_API_KEY=... python eval/optuna/calibrate_floors.py --trials 50
# ~10–15s/trial → ~10–15 min for 50 trials. Results: eval/optuna/best_floors.json
pnpm run enrich   # restore the default binding (trials overwrite dist/index.json)
```

## Run in Google Colab
Heavier — the harness runs the actual TypeScript pipeline, so Colab needs node + the built data:
```python
# 1. repo + node
!git clone -b feat/oasis-next-quality https://github.com/Syntalic/OASIS.git && cd OASIS
!npm i -g pnpm@11 && cd OASIS && pnpm install
# 2. the built index + embed cache (≈400MB) — upload via Google Drive and copy into OASIS/dist/
#    (dist/index.json, dist/cache/, dist/lance/). Or run `pnpm build` in Colab (live crawl + gemini).
from google.colab import drive; drive.mount('/content/drive')
!cp -r /content/drive/MyDrive/oasis-dist/* OASIS/dist/
# 3. run
!pip install optuna
import os; os.environ["GOOGLE_API_KEY"] = "..."   # gemini
!cd OASIS && python eval/optuna/calibrate_floors.py --trials 50
```
> Because each trial re-binds + re-evals the real pipeline (node + gemini + the 400 MB cache),
> Colab is mostly useful for *offloading* the run, not for avoiding setup. If that's a hassle,
> it's simpler to run it locally (above) — or ask me to run it in the background.

## Applying results
Pick a point off the Pareto front in `best_floors.json` (e.g. highest good_recall@6 with
`bad_rate@8 == 0`), set those as the defaults in `src/embed/bind-endpoints.ts`, and re-run
`pnpm run enrich && pnpm run embed`.

## Caveat
Only as good as the objective. `eval:usefulness` is a small hand-scored set → treat results as
**directional** (a check on the hand-set defaults), not authoritative, until the held-out eval is
hardened. See [`../dogfooding/oasis-next-findings.md`](../dogfooding/oasis-next-findings.md).
