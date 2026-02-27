#!/usr/bin/env bash
# Updates the Homebrew tap formula after npm publish.
# Runs automatically via the "postpublish" npm lifecycle hook.
set -euo pipefail

VERSION=$(node -p "require('./package.json').version")
TARBALL_URL="https://registry.npmjs.org/squeaky-clean/-/squeaky-clean-${VERSION}.tgz"

# Skip prereleases
if [[ "$VERSION" == *"-"* ]]; then
  echo "Skipping Homebrew update for prerelease ${VERSION}"
  exit 0
fi

echo "Updating Homebrew formula for v${VERSION}..."

# Wait for npm to propagate
echo "Waiting for npm tarball to be available..."
for i in $(seq 1 30); do
  STATUS=$(curl -sL -o /dev/null -w "%{http_code}" "$TARBALL_URL")
  if [ "$STATUS" = "200" ]; then
    echo "npm tarball available."
    break
  fi
  if [ "$i" = "30" ]; then
    echo "ERROR: Timed out waiting for npm tarball after 5 minutes"
    exit 1
  fi
  echo "  Attempt $i/30: HTTP $STATUS, retrying in 10s..."
  sleep 10
done

# Get SHA256
SHA256=$(curl -sL "$TARBALL_URL" | shasum -a 256 | awk '{print $1}')

# Sanity check — sha256 of empty content
if [ -z "$SHA256" ] || [ "$SHA256" = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ]; then
  echo "ERROR: Failed to fetch tarball or got empty file"
  exit 1
fi

echo "SHA256: ${SHA256}"

# Update the in-repo formula
sed -i.bak "s|url \"https://registry.npmjs.org/squeaky-clean/-/squeaky-clean-.*\.tgz\"|url \"${TARBALL_URL}\"|" Formula/squeaky-clean.rb
sed -i.bak "s/sha256 \"[a-f0-9]*\"/sha256 \"${SHA256}\"/" Formula/squeaky-clean.rb
rm -f Formula/squeaky-clean.rb.bak

# Commit and push in-repo formula
git add Formula/squeaky-clean.rb
if ! git diff --cached --quiet; then
  git commit -m "chore(brew): update formula to v${VERSION}"
  git push origin main
fi

# Update the tap repo
TAP_DIR=$(mktemp -d)
echo "Cloning tap repo..."
git clone "https://github.com/chendrizzy/homebrew-squeaky-clean.git" "$TAP_DIR" 2>/dev/null

sed -i.bak "s|url \"https://registry.npmjs.org/squeaky-clean/-/squeaky-clean-.*\.tgz\"|url \"${TARBALL_URL}\"|" "$TAP_DIR/Formula/squeaky-clean.rb"
sed -i.bak "s/sha256 \"[a-f0-9]*\"/sha256 \"${SHA256}\"/" "$TAP_DIR/Formula/squeaky-clean.rb"
rm -f "$TAP_DIR/Formula/squeaky-clean.rb.bak"

cd "$TAP_DIR"
git add Formula/squeaky-clean.rb
if ! git diff --cached --quiet; then
  git commit -m "Update squeaky-clean to v${VERSION}"
  git push origin main
  echo "✅ Homebrew tap updated to v${VERSION}"
else
  echo "Homebrew tap already at v${VERSION}"
fi

rm -rf "$TAP_DIR"
