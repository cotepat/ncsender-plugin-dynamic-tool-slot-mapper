#!/bin/bash

# Package ncSender plugin as a .zip file for distribution
# This script creates a clean package with only the necessary files

set -e

PLUGIN_ID="com.ncsender.dynamic-tool-slot-mapper"
VERSION=$(node -p "require('./manifest.json').version")
OUTPUT_NAME="${PLUGIN_ID}-v${VERSION}.zip"

echo "Packaging ${PLUGIN_ID} v${VERSION}..."

# Create temporary directory for packaging
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Create plugin directory structure (ncSender expects files in a subdirectory)
PLUGIN_DIR="$TEMP_DIR/$PLUGIN_ID"
mkdir -p "$PLUGIN_DIR"

# Copy plugin files to plugin directory
echo "Copying plugin files..."
cp manifest.json "$PLUGIN_DIR/"
cp index.js "$PLUGIN_DIR/"
cp logo.png "$PLUGIN_DIR/"

# Note: README.md, QUICKSTART.md, and docs/ are excluded to avoid issues
# with ncSender's plugin extraction logic

# Create zip file
echo "Creating zip file..."
cd "$TEMP_DIR"
zip -r "$OUTPUT_NAME" "$PLUGIN_ID" -x "*.DS_Store" "*/.*"
cd - > /dev/null

# Move zip to project root
mv "$TEMP_DIR/$OUTPUT_NAME" .

echo "✓ Package created: $OUTPUT_NAME"
echo "  Size: $(du -h "$OUTPUT_NAME" | cut -f1)"
echo ""
echo "Ready for distribution!"
