#!/bin/bash

# ==========================================
# Script para rebuild completo do Monarco
# ==========================================

set -e  # Exit on error

echo "🔨 Limpando builds anteriores..."
rm -rf dist dist-electron

echo "📦 Buildando aplicação web (Vite)..."
npm run build

echo "✅ Web build concluído!"
echo ""
echo "📂 Estrutura dist:"
ls -la dist/ | head -10

echo ""
echo "🚀 Buildando Electron para Linux..."
npm run build:linux

echo "✅ Build Linux concluído!"
echo ""
echo "📂 Arquivos gerados em dist-electron/:"
ls -lh dist-electron/*.{AppImage,deb} 2>/dev/null || true

echo ""
echo "🎉 Build completo!"
