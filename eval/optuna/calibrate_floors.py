#!/usr/bin/env python3
"""
Optuna calibration for the OASIS binder floors.

Each trial sets the binder floors via env (read by src/enrich-facets.ts), RE-BINDS the existing
corpus with `pnpm run enrich` (reuses dist/cache — ~10-15s, no recrawl/re-embed), then scores it
with `pnpm run eval:usefulness`. Multi-objective: maximize good_recall@6, minimize bad_rate@8 —
the precision/recall tradeoff the floors control (esp. denseMargin, which trades spill-precision
for coverage; it's currently a hand-set guess of 0.02).

This runs the REAL pipeline per trial (not a Python proxy), so it needs node + a built dist.

PREREQUISITES
  - OASIS repo, built once:  pnpm install && pnpm build   (produces dist/cache + dist/index.json + dist/lance)
  - node + pnpm on PATH
  - GOOGLE_API_KEY in env  (gemini: intent embeds in enrich + query routing in eval)
  - pip install optuna

RUN
  python eval/optuna/calibrate_floors.py --trials 50

OUTPUT
  Pareto-optimal floor sets -> stdout + eval/optuna/best_floors.json.
  NOTE: trials overwrite dist/index.json. When done, run `pnpm run enrich` once to restore the
  default binding (or with the OASIS_BIND_* env of your chosen floor set).

CAVEAT: only as good as the objective. eval:usefulness is a SMALL hand-scored set, so treat the
output as DIRECTIONAL — a sanity check on the hand-set defaults, not gospel — until the held-out
eval is hardened (see eval/dogfooding/oasis-next-findings.md).
"""
import argparse
import json
import os
import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]  # eval/optuna/ -> repo root


def run_trial(floors: dict) -> tuple[float, float]:
    env = {
        **os.environ,
        "OASIS_BIND_FLOOR": str(floors["dense_floor"]),
        "OASIS_BIND_SPARSE_FLOOR": str(floors["sparse_floor"]),
        "OASIS_BIND_STRONG_SPARSE": str(floors["strong_sparse"]),
        "OASIS_BIND_DENSE_MARGIN": str(floors["dense_margin"]),
    }
    enrich = subprocess.run(["pnpm", "run", "enrich"], cwd=REPO, env=env, capture_output=True, text=True)
    if enrich.returncode != 0:
        raise RuntimeError(f"enrich failed:\n{enrich.stderr[-600:]}")
    ev = subprocess.run(["pnpm", "run", "eval:usefulness"], cwd=REPO, env=env, capture_output=True, text=True)
    out = ev.stdout + ev.stderr
    good = re.search(r"good_recall@6:\s*([\d.]+)", out)
    bad = re.search(r"bad_rate@8:\s*([\d.]+)", out)
    if not good or not bad:
        raise RuntimeError(f"could not parse metrics from:\n{out[-800:]}")
    return float(good.group(1)), float(bad.group(1))


def main() -> None:
    import optuna

    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=50)
    args = ap.parse_args()

    def objective(trial):
        floors = {
            "dense_floor": trial.suggest_float("dense_floor", 0.74, 0.82),        # gemini scale is compressed
            "sparse_floor": trial.suggest_float("sparse_floor", 0.02, 0.10),      # final lexical gate (def 0.035)
            "strong_sparse": trial.suggest_float("strong_sparse", 0.08, 0.20),    # promotion floor (def 0.12)
            "dense_margin": trial.suggest_float("dense_margin", 0.00, 0.06),      # spill/orphan gate (def 0.02 — a guess)
        }
        trial.set_user_attr("floors", floors)
        return run_trial(floors)  # (good_recall@6 -> max, bad_rate@8 -> min)

    study = optuna.create_study(directions=["maximize", "minimize"], study_name="oasis-binder-floors")
    study.optimize(objective, n_trials=args.trials, catch=(RuntimeError,))

    best = sorted(
        ({"good_recall@6": t.values[0], "bad_rate@8": t.values[1], **t.params} for t in study.best_trials),
        key=lambda x: (-x["good_recall@6"], x["bad_rate@8"]),
    )
    out = REPO / "eval" / "optuna" / "best_floors.json"
    out.write_text(json.dumps(best, indent=2))
    print("\n=== Pareto-optimal floor sets (good_recall@6 up, bad_rate@8 down) ===")
    for b in best:
        print(
            f"  good={b['good_recall@6']:.3f} bad={b['bad_rate@8']:.3f}  "
            f"floor={b['dense_floor']:.3f} sparse={b['sparse_floor']:.3f} "
            f"strong={b['strong_sparse']:.3f} margin={b['dense_margin']:.3f}"
        )
    print(f"\nwrote {out}")
    print("Apply a chosen set as defaults in src/embed/bind-endpoints.ts, then re-run `pnpm run enrich`.")


if __name__ == "__main__":
    main()
