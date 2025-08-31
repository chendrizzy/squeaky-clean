#!/bin/bash

# Fix minimatch imports - v10 uses named export
echo "Fixing minimatch imports..."
find src/cleaners -name "*.ts" -exec sed -i '' 's/import minimatch from .minimatch./import { minimatch } from "minimatch"/g' {} \;

# Add missing CacheSelectionCriteria imports to cleaners that need it
echo "Adding missing CacheSelectionCriteria imports..."
for file in src/cleaners/{androidstudio,brew,bun,chrome,docker,firefox,flutter,gradle,nix,npm,nx,pip,pnpm,turbo,vite,vscode,webpack,xcode,yarn}.ts; do
  if ! grep -q "CacheSelectionCriteria" "$file" | head -1; then
    echo "Skipping $file - already has import"
  else
    # Check if file already imports from '../types'
    if grep -q "from '../types'" "$file"; then
      # Add to existing import
      sed -i '' "/from '..\/types'/s/}/&, CacheSelectionCriteria/" "$file" 2>/dev/null || true
      sed -i '' "/from '..\/types'/s/{/{CacheSelectionCriteria, /" "$file" 2>/dev/null || true
    else
      # Add new import after first import line
      sed -i '' "1,/^import/s/^import/import { CacheSelectionCriteria } from '..\/types';\nimport/" "$file" 2>/dev/null || true
    fi
  fi
done

echo "Build errors fixed!"