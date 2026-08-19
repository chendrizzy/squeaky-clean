#!/usr/bin/env bash
# Decision table for scripts/lint-pr-title.sh.
#
# Beyond the table, every accepted title is cross-checked against the release
# gate's own TYPES_RE (extracted from .github/workflows/version-bump.yml) using
# the subject squash-merge would actually produce — "<title> (#42)". If the lint
# and the gate ever disagree about what publishes, this fails.
# Run: bash scripts/tests/pr-title-lint.test.sh
set -uo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
LINT="$REPO_ROOT/scripts/lint-pr-title.sh"
WF="$REPO_ROOT/.github/workflows/version-bump.yml"

GATE_RE=$(grep -oE "TYPES_RE='[^']*'" "$WF" | head -1 | sed "s/^TYPES_RE='//; s/'\$//")
[ -n "$GATE_RE" ] || { echo "FATAL: could not extract TYPES_RE from $WF"; exit 1; }

PASS=0; FAIL=0

# case <title> <want_exit> <want_release: yes|no|->
run_case() {
  local title="$1" want_exit="$2" want_release="$3"
  local out status got_release
  out=$(PR_TITLE="$title" bash "$LINT" 2>&1); status=$?

  if [ "$status" -ne "$want_exit" ]; then
    FAIL=$((FAIL+1)); echo "FAIL exit=$status want=$want_exit for: $title"
    printf '%s\n' "$out" | sed 's/^/     | /'; return
  fi

  if [ "$want_release" = "-" ]; then
    PASS=$((PASS+1)); echo "ok   rejected: $title"; return
  fi

  case "$out" in
    *"publishes a release"*) got_release=yes ;;
    *) got_release=no ;;
  esac

  if [ "$got_release" != "$want_release" ]; then
    FAIL=$((FAIL+1))
    echo "FAIL release=$got_release want=$want_release for: $title"; return
  fi

  # The gate reads the squash-merge subject, not the bare title.
  local subject="$title (#42)" gate_release=no
  printf '%s' "$subject" | grep -qiE "$GATE_RE" && gate_release=yes
  if [ "$gate_release" != "$want_release" ]; then
    FAIL=$((FAIL+1))
    echo "FAIL gate disagrees: lint says release=$want_release but version-bump.yml says $gate_release for squashed subject: $subject"
    return
  fi

  PASS=$((PASS+1)); echo "ok   accepted (release=$want_release): $title"
}

# --- Titles that must ship a release ---------------------------------------
run_case "fix: correct docker cache detection"      0 yes
run_case "fix(detection): cache-dir keyed cleaners" 0 yes
run_case "feat(ub): add --exclude flag"             0 yes
run_case "perf: avoid spawns in scan paths"         0 yes
run_case "revert: feat(ub) exclude flag"            0 yes
run_case 'Revert "fix(detection): cache dirs"'      0 yes
run_case "feat!: rewrite the cleaner registry"      0 yes
run_case "feat(core)!: rewrite the registry"        0 yes

# --- Valid, but must NOT ship on their own ---------------------------------
run_case "chore(ci): bump actions to v5"            0 no
run_case "docs: explain per-volume reporting"       0 no
run_case "style: prettier-format volumes"           0 no
run_case "ci: enforce the release-gate table"       0 no
run_case "test: cover volume attribution"           0 no
run_case "refactor: reshuffle cleaner registry"     0 no
run_case "build: tweak the bundle config"           0 no

# --- The bug this lint exists to prevent -----------------------------------
run_case "Fix docker detection"                     1 -
run_case "Update stuff"                             1 -
run_case "fix docker detection"                     1 -
run_case "Merge pull request #12 from x/y"          1 -
run_case "wip"                                      1 -

# --- Malformed conventional shapes -----------------------------------------
run_case "fix:"                                     1 -
run_case "fix: "                                    1 -
run_case "fix : spaced colon"                       1 -
run_case "nope: unknown type"                       1 -

# --- Markers that do not survive squash-merge ------------------------------
run_case "chore: refresh vendored data [release]"   1 -

# --- Nothing to check -------------------------------------------------------
run_case ""                                         2 -

echo "---"
echo "$PASS passed, $FAIL failed"
exit $FAIL
