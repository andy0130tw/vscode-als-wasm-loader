# Agda Language Server WASM Loader

A helper extension to load and spin up a functional instance of the WebAssembly build of Agda Language Server.

This extension is designed to work jointly with [Agda mode for VS Code](https://marketplace.visualstudio.com/items?itemName=banacorn.agda-mode), and contains a patched instance of [WASM WASI Core Extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode.wasm-wasi-core). As a result, the consumer of this package is expected to prepare a [WASM module](https://github.com/agda/agda-language-server) compiled with `WebAssembly.compile`, along with all data files and interface files, placed in a in-memory VFS.

# Sample usage

Use this in your extension activation script as a starting point:

```ts
import { LanguageClient, LanguageClientOptions } from 'vscode-languageclient'

const ext = extensions.getExtension('qbane.als-wasm-loader')

if (!ext.isActive) {
  await ext.activate()
}

const {
  AgdaLanguageServerFactory,
  WasmAPILoader,
  createUriConverters,
} = ext.exports

const wasm = WasmAPILoader.load()
const alsWasmRaw = await workspace.fs.readFile(Uri.joinPath(context.extensionUri, 'path/to/als.wasm'))
const mod = WebAssembly.compile(alsWasmRaw)

const factory = new AgdaLanguageServerFactory(wasm, mod)
const memfsAgdaDataDir = await wasm.createMemoryFileSystem()
// TODO: prepare memfs

const serverOptions = () => factory.createServer(memfsAgdaDataDir, {
  // TODO: process options
})
const clientOptions = {
  // TODO: add more client options
  uriConverters: createUriConverters(),
}

const client = new LanguageClient('als', 'Agda Language Server', serverOptions, clientOptions)
client.registerProposedFeatures()

client.onRequest('agda', (res, opts) => {
  // TODO: add your own callback handling logic
})
```
