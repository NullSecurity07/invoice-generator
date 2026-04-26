#!/bin/bash

# Configuration
FRONTEND_DIR="frontend"
ZIP_NAME="godaddy_frontend.zip"

echo "================================================="
echo "🚀 BLC Invoice Portal - Frontend Deploy Automator"
echo "================================================="
echo ""

# 1. Ask for Render API URL
read -p "🔗 Enter your Render API URL (e.g. https://blc-invoice.onrender.com): " API_URL

if [[ -z "$API_URL" ]]; then
  echo "❌ Error: API URL cannot be empty."
  exit 1
fi

# 2. Inject the Variable into index.html cleanly
INDEX_FILE="$FRONTEND_DIR/index.html"
echo "⚙️  Injecting backend route into index.html..."

# Remove previous ENV_API_URL injection if it exists to avoid duplicates
sed -i '/<script>window.ENV_API_URL/d' "$INDEX_FILE"

# Insert the script tag right after the <head> tag
sed -i "s|<head>|<head>\n    <script>window.ENV_API_URL = \"$API_URL\";</script>|g" "$INDEX_FILE"

echo "✅ Environment script appended to index.html!"

# 3. Zip the frontend directory
echo "📦 Packaging frontend files into a ZIP..."
if [ -f "$ZIP_NAME" ]; then
    rm "$ZIP_NAME"
fi

# Move into frontend folder to zip contents without the parent folder wrapper
cd $FRONTEND_DIR
zip -r "../$ZIP_NAME" ./* -x "*/.DS_Store"
cd ..

echo "================================================="
echo "🎉 SUCCESS: Frontend is ready for GoDaddy!"
echo "================================================="
echo "1. Log into your GoDaddy cPanel."
echo "2. Open File Manager and navigate to the domain root (e.g., trainers document root)."
echo "3. Click 'Upload' and drag-and-drop: '$ZIP_NAME'"
echo "4. Right-click the uploaded file, select 'Extract', and you're done!"
echo "================================================="
