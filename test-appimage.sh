#!/bin/bash

cd /home/akira/Documents/Desenvolvimentos/AkiraProjects/monarco/dist-electron

echo "🚀 Iniciando AppImage com logging..."
echo "Saída será salva em /tmp/monarco-test.log"
echo ""

ELECTRON_ENABLE_LOGGING=1 ./Monarco-0.1.0-x86_64.AppImage 2>&1 | tee /tmp/monarco-test.log &
PID=$!

echo "PID: $PID"
echo "Aguardando 10 segundos..."
sleep 10

kill -9 $PID 2>/dev/null || true

echo ""
echo "📋 Conteúdo do log:"
cat /tmp/monarco-test.log
