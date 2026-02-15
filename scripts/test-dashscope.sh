#!/bin/bash
# Teste DashScope API (Qwen) - substitua DASHSCOPE_API_KEY pela sua chave
# Internacional: dashscope-intl | China: dashscope.aliyuncs.com

API_KEY="${DASHSCOPE_API_KEY:-sk-SUA_API_KEY_AQUI}"
ENDPOINT="https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"

curl -s -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "qwen-plus",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Quem é você? Responda em uma frase."}
    ],
    "temperature": 0.2,
    "max_tokens": 256
  }' | (command -v jq >/dev/null && jq . || cat)
