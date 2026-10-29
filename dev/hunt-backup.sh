#!/bin/bash
# LineHunter - dev/hunt-backup.sh
# Pushes every dev/snapshots/*.json (gzipped) to the data-only branch `hunt-snapshots`, so a night's snapshot survives the cloud
# container being reclaimed. Restore: git fetch origin hunt-snapshots; git show origin/hunt-snapshots:snapshots/DATE.json.gz | gunzip > dev/snapshots/DATE.json
set -e
repo=$(cd "$(dirname "$0")/.." && pwd)
wt=$(mktemp -d)
cd "$repo"
git fetch -q origin hunt-snapshots
git worktree add -q --detach "$wt" origin/hunt-snapshots
mkdir -p "$wt/snapshots"
for f in dev/snapshots/*.json; do gzip -9 -c "$f" > "$wt/snapshots/$(basename "$f").gz"; done
cd "$wt"
git checkout -q -B hunt-snapshots
git add -A
if git diff --cached --quiet; then
  echo "hunt-snapshots: no changes"
else
  git -c user.name=Claude -c user.email=noreply@anthropic.com commit -qm "Hunt Score snapshots: $(date -u '+%Y-%m-%d %H:%MZ')

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014MBNVbnVK7r9r1NN7M4cXz"
  git push -q origin hunt-snapshots
  echo "hunt-snapshots: pushed"
fi
cd "$repo"
git worktree remove --force "$wt"
git branch -D hunt-snapshots -q 2>/dev/null || true
