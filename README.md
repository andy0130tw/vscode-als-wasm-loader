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
// TODO: may need to prepare memfs like below:
// const resp = await fetch('path/to/agda-data.zip')
// ext.exports.prepareMemfsFromAgdaDataZip(await resp.bytes(), memfsAgdaDataDir)

const serverOptions = () => factory.createServer(memfsAgdaDataDir, {
  // TODO: process options
}, {
  // NOTE: see the note section below
  // runSetupFirst: true,
  // setupCallback(code, stderr) {},
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

## Note on the setup step

Starting with newer ALS (containing [this patch](https://github.com/agda/agda-language-server/pull/39)) powered by Agda v2.8.0 or later, you can skip the memfs preparation step with the option `runSetupFirst`. The factory will run command `als --setup` before actually running the server, extracting data files (~600 kB) to the memfs' datadir. The downside is that no interface file for Agda built-ins will be written due to memfs being read-only (for now).

The setup step can be monitored by passing a function to `setupCallback`. If this step fails and the callback is not set, the server will crash before its start.

# Acknowledgements

The included WASM WASI Core Extension fixes some WASM/WASI issues to satisfy Haskell-based WASM modules' need, including but not limited to:

* https://github.com/microsoft/vscode-wasm/pull/226
