#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .local/model-token ]]; then
  mkdir -p .local
  (umask 077; node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > .local/model-token)
fi
exec .local/llama.cpp/build/bin/llama-server \
  --model .local/models/Qwen3-4B-Q4_K_M.gguf \
  --host 127.0.0.1 --port 8080 --ctx-size 2048 --parallel 1 \
  --threads 4 --batch-size 128 --ubatch-size 64 --n-gpu-layers 0 \
  --jinja --reasoning off --api-key-file .local/model-token "$@"
