"""One-command orchestrator for the My Quality Scorecard monthly deliverable.

Runs the full DAG in dependency order: extraction (Node pulls + the satisfaction Graph pull) ->
clinical consumer chain -> satisfaction sub-chain -> build_feed -> build_deliverable. Fail-fast
(stops at the first non-zero exit), streams each step's output live, prints a timing summary.

This encodes the run ORDER so it can't drift from a prose runbook. The order and cross-deps were
reconstructed from the scripts (the README's clinical runbook alone is NOT the whole picture: the
satisfaction sub-chain needs discharges + roster; build_feed needs everything).

Default is STAGE-ONLY and SAFE: it never touches the live OneDrive file unless you pass --deliver.

Usage (from repo root):
  python -m evaluation.run_pipeline                 # full run, stage-only (no OneDrive touch)
  python -m evaluation.run_pipeline --deliver       # full run + overwrite the live file
  python -m evaluation.run_pipeline --skip-extract  # reuse existing CSVs, just rescore + stage
  python -m evaluation.run_pipeline --skip-fetch    # run pulls but skip the satisfaction Graph pull
  python -m evaluation.run_pipeline --list          # print the ordered steps and exit

Prereqs: `az login` done once (Fabric pulls); the satisfaction Graph pull authenticates via the
Windows token broker (silent if cached, else one browser sign-in). See the my-quality-scorecard skill.
"""
from __future__ import annotations
import argparse
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Each step: (phase, label, argv). argv[0] kind is inferred: 'node'/'powershell' run as-is,
# 'py' expands to [sys.executable, '-m', module]. cwd is always REPO.
NODE = "node"
PS = ["powershell", "-ExecutionPolicy", "Bypass", "-File"]

EXTRACT = [
    ("extract", "track-base",       [NODE, "queries/pull-track-base.js"]),
    ("extract", "track-outcomes",   [NODE, "queries/pull-track-outcomes.js"]),
    ("extract", "eval-author",      [NODE, "queries/pull-eval-author.js"]),
    ("extract", "employee-dim",     [NODE, "queries/pull-employee-dim.js"]),
    ("extract", "attribution",      [NODE, "queries/pull-attribution.js"]),
    ("extract", "facility-dim",     [NODE, "queries/pull-facility-dim.js"]),
    ("extract", "facility-hier",    [NODE, "queries/pull-facility-hier.js"]),
    ("extract", "missed-visits",    [NODE, "queries/pull-missed-visits.js"]),
    ("extract", "discharges",       [NODE, "queries/pull-discharges.js"]),
]
FETCH_SATISFACTION = ("extract", "satisfaction-fetch", PS + ["queries/pull-satisfaction-graph.ps1"])

CONSUME = [
    ("clinical",     "build_tracks",                "py:evaluation.build_tracks"),
    ("clinical",     "build_attribution",           "py:evaluation.build_attribution"),
    ("clinical",     "score",                       "py:evaluation.score"),
    ("clinical",     "build_roster",                "py:evaluation.build_roster"),
    ("satisfaction", "extract_satisfaction_lookups","py:evaluation.extract_satisfaction_lookups"),
    ("satisfaction", "build_planned_discharges",    "py:evaluation.build_planned_discharges"),
    ("satisfaction", "build_satisfaction",          "py:evaluation.build_satisfaction"),
    ("satisfaction", "build_satisfaction_feed",     "py:evaluation.build_satisfaction_feed"),
    ("feed",         "build_feed",                  "py:evaluation.build_feed"),
]


def to_argv(spec) -> list[str]:
    if isinstance(spec, str) and spec.startswith("py:"):
        return [sys.executable, "-m", spec[3:]]
    return list(spec)


def build_plan(args) -> list[tuple[str, str, list[str]]]:
    plan: list[tuple[str, str, list[str]]] = []
    if not args.skip_extract:
        plan += [(ph, lb, to_argv(a)) for ph, lb, a in EXTRACT]
        if not args.skip_fetch:
            ph, lb, a = FETCH_SATISFACTION
            plan.append((ph, lb, to_argv(a)))
    plan += [(ph, lb, to_argv(a)) for ph, lb, a in CONSUME]
    deliver_flags = (["--deliver"] if args.deliver else []) + \
                    (["--prod-snapshot"] if getattr(args, "prod_snapshot", False) else [])
    plan.append(("deliver", "build_deliverable",
                 [sys.executable, "-m", "evaluation.build_deliverable", *deliver_flags]))
    return plan


def run(args) -> int:
    plan = build_plan(args)
    print(f"pipeline: {len(plan)} steps | deliver={args.deliver} | "
          f"skip_extract={args.skip_extract} skip_fetch={args.skip_fetch}\n")
    timings: list[tuple[str, str, float]] = []
    t_all = time.perf_counter()
    for i, (phase, label, argv) in enumerate(plan, 1):
        print(f"\n{'='*70}\n[{i}/{len(plan)}] {phase:>12} :: {label}\n{'='*70}", flush=True)
        t0 = time.perf_counter()
        rc = subprocess.run(argv, cwd=REPO).returncode   # stream output live (no capture)
        dt = time.perf_counter() - t0
        timings.append((phase, label, dt))
        if rc != 0:
            print(f"\nFAILED at [{i}/{len(plan)}] {label} (exit {rc}) after {dt:.0f}s. "
                  f"Fix and re-run; use --skip-extract to skip completed pulls.")
            _summary(timings, time.perf_counter() - t_all, failed=label)
            return rc
    _summary(timings, time.perf_counter() - t_all, failed=None)
    if not args.deliver:
        print("\nSTAGE-ONLY: live OneDrive file untouched. Re-run with --deliver to ship, or run:\n"
              "  python -m evaluation.build_deliverable --deliver")
    return 0


def _summary(timings, total, failed) -> None:
    print(f"\n{'-'*70}\ntiming summary:")
    for phase, label, dt in timings:
        print(f"  {phase:>12} :: {label:32} {dt:6.0f}s")
    status = f"FAILED at {failed}" if failed else "OK"
    print(f"  {'total':>12}    {'':32} {total:6.0f}s   [{status}]")


def main() -> None:
    ap = argparse.ArgumentParser(description="Run the My Quality Scorecard pipeline end-to-end.")
    ap.add_argument("--deliver", action="store_true", help="overwrite the live OneDrive file at the end")
    ap.add_argument("--prod-snapshot", action="store_true",
                    help="with --deliver, leave a dated backup of the outgoing file in prod for IT "
                         "(schema-change months only)")
    ap.add_argument("--skip-extract", action="store_true", help="reuse existing CSVs; skip all pulls")
    ap.add_argument("--skip-fetch", action="store_true", help="run pulls but skip the satisfaction Graph pull")
    ap.add_argument("--list", action="store_true", help="print the ordered steps and exit")
    args = ap.parse_args()
    if args.list:
        for i, (phase, label, argv) in enumerate(build_plan(args), 1):
            print(f"{i:2}. {phase:>12} :: {label:32} {' '.join(argv[-2:])}")
        return
    sys.exit(run(args))


if __name__ == "__main__":
    main()
