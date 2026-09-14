#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .local/models .local/logs
# Pinned official llama.cpp release and Qwen model revision.
if [[ ! -d .local/llama.cpp/.git ]]; then
  git clone --depth 1 --branch v0.4.0 https://github.com/ggml-org/llama.cpp.git .local/llama.cpp
fi
cmake -S .local/llama.cpp -B .local/llama.cpp/build -DCMAKE_BUILD_TYPE=Release \
  -DGGML_NATIVE=ON -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF
cmake --build .local/llama.cpp/build --target llama-server -j 2
expected_model_sha='7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5'
if ! printf '%s  %s\n' "$expected_model_sha" '.local/models/Qwen3-4B-Q4_K_M.gguf' | sha256sum --check --status; then
curl -fL --retry 3 --connect-timeout 20 -C - \
  https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf \
  -o .local/models/Qwen3-4B-Q4_K_M.gguf

fi

printf '%s  %s\n' '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5' '.local/models/Qwen3-4B-Q4_K_M.gguf' | sha256sum -c -
