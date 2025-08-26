#!/bin/bash -ex

cd vscode-wasm
npm i --ignore-scripts

cd wasm-wasi-core
npm i
npm run build
npm run esbuild

cd ../wasm-wasi-lsp
npm i
npm run all
