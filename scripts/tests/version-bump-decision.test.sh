#!/usr/bin/env bash
# Decision-table test for the release gate in .github/workflows/version-bump.yml.
#
# Extracts the real "Decide whether (and how) to bump" step body from the
# workflow and runs it against stubbed git/node, so the table below tests the
# shipped logic rather than a copy of it. Run: bash scripts/tests/version-bump-decision.test.sh
set -u

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
WF="$REPO_ROOT/.github/workflows/version-bump.yml"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Extract the run: block. Body lines are 10-space indented; stop at the next
# step (- name:) or any other 8-space step key (env:, if:) so a future key
# placed after run: cannot be silently appended as shell text.
awk '
  /- name: Decide whether \(and how\) to bump/ {instep=1}
  instep && /^        run: \|/ {inrun=1; next}
  inrun && /^      - name:/ {exit}
  inrun && /^        [a-z_-]+:/ {exit}
  inrun {sub(/^          /, ""); print}
' "$WF" > "$WORK/step.sh"

grep -q 'GITHUB_OUTPUT' "$WORK/step.sh" || {
  echo "FATAL: step extraction failed (no GITHUB_OUTPUT writes found)"; exit 1
}

# --- Stubs -------------------------------------------------------------------
# git: FAKE_COMMITS is the ALREADY path-filtered subject list (the real pathspec
# excludes live in the workflow), FAKE_BODIES the full messages.
mkdir -p "$WORK/bin"
cat > "$WORK/bin/git" <<'STUB'
#!/usr/bin/env bash
args="$*"
case "$args" in
  *"describe --tags"*)
    if [ -n "${FAKE_LAST_TAG:-}" ]; then echo "$FAKE_LAST_TAG"; else exit 1; fi ;;
  *"log -1"*) printf '%s' "$FAKE_LAST_COMMIT" ;;
  *"%B"*)     printf '%s\n' "${FAKE_BODIES:-$FAKE_COMMITS}" ;;
  *)          printf '%s\n' "$FAKE_COMMITS" ;;
esac
STUB
cat > "$WORK/bin/node" <<'STUB'
#!/usr/bin/env bash
echo "$FAKE_VERSION"
STUB
chmod +x "$WORK/bin/git" "$WORK/bin/node"

PASS=0; FAIL=0
# case <desc> <subjects> <head> <tag> <version> <want_skip> <want_type> [bodies] [event]
run_case() {
  local desc="$1" commits="$2" head="$3" tag="$4" ver="$5" want_skip="$6" want_type="$7"
  local bodies="${8:-$2}" event="${9:-push}"
  local out="$WORK/out.txt"
  : > "$out"
  # bash -e mirrors how GitHub Actions runs step bodies (bash -e {0}).
  FAKE_COMMITS="$commits" FAKE_BODIES="$bodies" FAKE_LAST_COMMIT="$head" \
    FAKE_LAST_TAG="$tag" FAKE_VERSION="$ver" GITHUB_OUTPUT="$out" \
    EVENT_NAME="$event" PATH="$WORK/bin:$PATH" \
    bash -e "$WORK/step.sh" > "$WORK/log.txt" 2>&1
  local got_skip got_type
  got_skip=$(grep '^skip=' "$out" | tail -1 | cut -d= -f2)
  got_type=$(grep '^version_type=' "$out" | tail -1 | cut -d= -f2)
  if [ "$got_skip" = "$want_skip" ] && [ "${got_type:-none}" = "$want_type" ]; then
    PASS=$((PASS+1)); echo "ok   $desc"
  else
    FAIL=$((FAIL+1))
    echo "FAIL $desc: want skip=$want_skip type=$want_type, got skip=$got_skip type=${got_type:-none}"
    sed 's/^/     | /' "$WORK/log.txt"
  fi
}

T="v0.6.4"; V="0.6.4"

# --- The regression this gate exists for ------------------------------------
run_case "v0.6.5 regression: style+ci only -> skip" \
  "style: prettier-format volumes module and tests
chore(ci): bump codecov-action to v5" \
  "chore(ci): bump codecov-action to v5" "$T" "$V" true none

# --- Release-worthy ---------------------------------------------------------
run_case "fix -> patch"                  "fix(review): defects"      "fix(review): defects"      "$T" "$V" false patch
run_case "feat on 0.x -> patch"          "feat(ub): --exclude flag"  "feat(ub): --exclude flag"  "$T" "$V" false patch
run_case "perf -> patch"                 "perf: faster du"           "perf: faster du"           "$T" "$V" false patch
run_case "revert -> patch"               "revert: feat(ub) thing"    "revert: feat(ub) thing"    "$T" "$V" false patch
run_case "git-generated Revert \"..\" -> patch" \
  'Revert "fix(detection): cache-dir detection"' 'Revert "fix(detection): cache-dir detection"' "$T" "$V" false patch
run_case "capitalized Fix: -> patch"     "Fix: resolve docker crash" "Fix: resolve docker crash" "$T" "$V" false patch
run_case "trailing [release] override -> patch" \
  "chore: refresh vendored data [release]" "chore: refresh vendored data [release]" "$T" "$V" false patch

# --- Bump sizing ------------------------------------------------------------
run_case "FEATURE RELEASE -> minor"      "FEATURE RELEASE: new tier" "FEATURE RELEASE: new tier" "$T" "$V" false minor
run_case "conventional bang feat(scope)!: -> minor" "feat(core)!: new engine" "feat(core)!: new engine" "$T" "$V" false minor
run_case "legacy bang feat!: -> minor"   "feat!: new engine"         "feat!: new engine"         "$T" "$V" false minor
run_case "BREAKING CHANGE -> major"      "BREAKING CHANGE: drop n16" "BREAKING CHANGE: drop n16" "$T" "$V" false major
run_case "BREAKING CHANGE in body footer -> major" \
  "feat: new engine" "feat: new engine" "$T" "$V" false major \
  "feat: new engine

BREAKING CHANGE: old config no longer migrated"
run_case "major outranks minor in same range" \
  "FEATURE RELEASE: tier
BREAKING CHANGE: drop n16" "BREAKING CHANGE: drop n16" "$T" "$V" false major
run_case "1.x + feat -> minor"           "feat: shiny"               "feat: shiny"               "v1.2.0" "1.2.0" false minor
run_case "1.x stray '!:' in chore does not force major" \
  "fix: real
chore: note wow!: thing" "chore: note wow!: thing" "v1.2.0" "1.2.0" false patch

# --- Must NOT release -------------------------------------------------------
run_case "docs only -> skip"             "docs: update readme"       "docs: update readme"       "$T" "$V" true none
run_case "refactor only -> skip"         "refactor: reshuffle"       "refactor: reshuffle"       "$T" "$V" true none
run_case "non-conventional subject -> skip" "Update stuff"           "Update stuff"              "$T" "$V" true none
run_case "subject MENTIONING markers -> skip" \
  "ci: document [release] and MINOR CHANGE: markers" \
  "ci: document [release] and MINOR CHANGE: markers" "$T" "$V" true none
run_case "body prose mentioning a marker mid-line -> skip" \
  "ci: harden release gate" "ci: harden release gate" "$T" "$V" true none \
  "ci: harden release gate

Explains why BREAKING CHANGE: markers must start a line."
run_case "all commits path-excluded (empty scan) -> skip" "" "chore: sync formula" "$T" "$V" true none
run_case "head is release commit -> skip"    "fix: x" "chore(release): v0.6.5 [skip ci]" "v0.6.5" "0.6.5" true none
run_case "[skip release] on head -> skip"    "fix: real fix [skip release]" "fix: real fix [skip release]" "$T" "$V" true none
run_case "[skip release] is durable on later pushes" \
  "fix: half-finished guard [skip release]
chore: update comments" "chore: update comments" "$T" "$V" true none

# --- Fresh repo / dispatch --------------------------------------------------
run_case "no tag yet + docs only -> skip" "docs: initial"  "docs: initial"  "" "0.1.0" true none
run_case "no tag yet + feat -> patch"     "feat: first"    "feat: first"    "" "0.1.0" false patch
run_case "dispatch bypasses [skip ci] head when work is pending" \
  "fix: real bug" "chore: sync Homebrew formula [skip ci]" "$T" "$V" false patch "fix: real bug" workflow_dispatch
run_case "dispatch with nothing shippable is still a no-op" \
  "chore: sync formula" "chore: sync formula" "$T" "$V" true none "chore: sync formula" workflow_dispatch

echo "---"
echo "$PASS passed, $FAIL failed"
exit $FAIL
