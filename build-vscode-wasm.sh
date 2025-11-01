#!/bin/bash -ex

echo "============ Installing root deps ============"
cd vscode-wasm
[ "$1" = "--npm-ci" ] && npm ci --ignore-scripts

echo "============ Building wasm-wasi-core ============"
cd wasm-wasi-core
[ "$1" = "--npm-ci" ] && npm ci
npm run build
npm run esbuild

echo "============ Building wasm-wasi-lsp ============"
cd ../wasm-wasi-lsp
[ "$1" = "--npm-ci" ] && npm ci
npm run all
