#!/usr/bin/env bash
# Checks a pull-request title against the commit convention the release gate
# in .github/workflows/version-bump.yml reads.
#
# Why this exists: squash-merge turns the PR title into the commit subject, so
# a title like "Fix docker detection" lands on main as a subject the gate
# cannot recognise — the fix silently never ships. (With merge commits the PR
# title is not a subject at all, so this check is advisory there.)
#
# Usage: PR_TITLE='fix: correct docker detection' bash scripts/lint-pr-title.sh
#        bash scripts/lint-pr-title.sh 'fix: correct docker detection'
#
# Exit: 0 title is fine · 1 title is rejected · 2 nothing to check.
set -uo pipefail

TITLE="${PR_TITLE-${1-}}"

# Conventional types this repo uses. RELEASING must stay a subset of TYPES_RE
# in .github/workflows/version-bump.yml — scripts/tests/pr-title-lint.test.sh
# extracts that regex and fails if the two ever disagree.
TYPES='build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test'
RELEASING='feat|fix|perf|revert'
CONVENTIONAL="^(${TYPES})(\([^)]+\))?!?: .+"
GIT_REVERT='^Revert ".+"$'

err() {
  if [ -n "${GITHUB_ACTIONS-}" ]; then
    echo "::error::$1"
  else
    echo "error: $1" >&2
  fi
}

matches() { printf '%s' "$TITLE" | grep -qE "$1"; }

if [ -z "$TITLE" ]; then
  err "No PR title to check (set PR_TITLE or pass the title as an argument)."
  exit 2
fi

if ! matches "$CONVENTIONAL" && ! matches "$GIT_REVERT"; then
  err "PR title is not a conventional commit subject: \"$TITLE\""
  cat >&2 <<EOF

Squash-merge uses the PR title as the commit subject, and the release gate
only recognises conventional subjects. Retitle as "<type>[(scope)][!]: <what>":

  fix: correct docker cache detection     <- ships a release
  feat(ub): add --exclude flag            <- ships a release
  chore(ci): bump actions to v5           <- valid, ships nothing on its own

Types: ${TYPES//|/, }
EOF
  exit 1
fi

# " (#123)" is appended on squash-merge, so a trailing marker stops being
# trailing and the gate's end-anchored match never fires.
if matches '\[[Rr]elease\]$'; then
  err "A trailing [release] marker does not survive squash-merge: GitHub appends \" (#123)\" to the subject."
  echo "Use a releasing type instead (${RELEASING//|/, }), or land the commit directly on main." >&2
  exit 1
fi

if matches "^(${RELEASING})(\([^)]+\))?!?:" || matches "$GIT_REVERT"; then
  echo "OK: \"$TITLE\" — merging this publishes a release."
else
  echo "OK: \"$TITLE\" — conventional, but publishes nothing on its own."
fi
