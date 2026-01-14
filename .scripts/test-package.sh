#!/bin/bash

# Test that the plugin package is valid
# Checks for required files and structure

set -e

PLUGIN_ID="com.ncsender.dynamic-tool-slot-mapper"
VERSION=$(node -p "require('./manifest.json').version")
PACKAGE_NAME="${PLUGIN_ID}-v${VERSION}.zip"

echo "Testing plugin package: $PACKAGE_NAME"
echo ""

# Check if package exists
if [ ! -f "$PACKAGE_NAME" ]; then
  echo "❌ Package not found: $PACKAGE_NAME"
  echo "   Run 'npm run package' first"
  exit 1
fi

# Create temp directory for testing
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Extract package
echo "Extracting package..."
unzip -q "$PACKAGE_NAME" -d "$TEMP_DIR"

# Check required files
REQUIRED_FILES=(
  "manifest.json"
  "index.js"
  "logo.png"
  "README.md"
)

echo "Checking required files..."
ALL_GOOD=true

for file in "${REQUIRED_FILES[@]}"; do
  if [ -f "$TEMP_DIR/$file" ]; then
    echo "  ✓ $file"
  else
    echo "  ❌ Missing: $file"
    ALL_GOOD=false
  fi
done

# Validate manifest.json
echo ""
echo "Validating manifest.json..."

if ! node -e "const m = require('$TEMP_DIR/manifest.json'); if (!m.id || !m.version || !m.entry) process.exit(1);" 2>/dev/null; then
  echo "  ❌ Invalid manifest.json"
  ALL_GOOD=false
else
  echo "  ✓ Valid manifest.json"
  echo "    - ID: $(node -p "require('$TEMP_DIR/manifest.json').id")"
  echo "    - Version: $(node -p "require('$TEMP_DIR/manifest.json').version")"
  echo "    - Entry: $(node -p "require('$TEMP_DIR/manifest.json').entry")"
fi

# Summary
echo ""
if [ "$ALL_GOOD" = true ]; then
  echo "✅ Package is valid!"
  exit 0
else
  echo "❌ Package has errors"
  exit 1
fi
