# Agda Language Server WASM Loader

A helper extension to load and spin up a functional instance of the WebAssembly build of Agda Language Server.

Designed to work jointly with [Agda mode for VS Code](https://marketplace.visualstudio.com/items?itemName=banacorn.agda-mode), this extension contains a patched instance of the [WASM WASI Core Extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode.wasm-wasi-core). Consequently, the consumer of this package is expected to prepare a [WASM module](https://github.com/agda/agda-language-server) that is compiled with `WebAssembly.compile`, along with all data files and interface files, placed in a in-memory VFS.

# Sample usage

Use this in your extension's activation script as a starting point:

```ts
import { LanguageClient, LanguageClientOptions } from 'vscode-languageclient'
import { Uri } from 'vscode'

const ext = extensions.getExtension('qbane.als-wasm-loader')

if (ext == null) {
  // prompt the user to install it
  throw new Error('extension is not installed or is not enabled.')
}

if (!ext.isActive) {
  await ext.activate()
}

const {
  AgdaLanguageServerFactory,
  createUriConverters,
} = ext.exports

// build the factory from the given WebAssembly module
const uriToModule = Uri.joinPath(context.extensionUri, 'path/to/als.wasm')
const alsWasmRaw = await workspace.fs.readFile(uriToModule)
const mod = WebAssembly.compile(alsWasmRaw)
const factory = AgdaLanguageServerFactory.buildFromModule(mod)
// or: await AgdaLanguageServerFactory.buildFromUri(uriToModule)

const memfsAgdaDataDir = await wasm.createMemoryFileSystem()
// TODO: may need to populate memfsAgdaDataDir;
// see the note section "Preparing the memory filesystems" below

let transportStore = { transport: null }
const serverOptions = () => factory.createServer(memfsAgdaDataDir, {
  // TODO: extra process options for vscode-wasm
}, {
  // env: { ENV: 'EXTRA_ENVS' },
  // args: [
  //   '+RTS', '-V1', '-RTS',  /* the default args */
  //   '+AGDA', '... Agda args here ...', '-AGDA'
  // ],
  // async presetupCallback({ memfsTempDir, memfsHome }) {
  //   // you might want to put configs or libraries in the file system
  // },
  // runSetupFirst: true,
  // setupCallback(code, stderr) {},
}).then(t => transportStore.transport = t)
// store `transportStore` to allow disposal; see the note section "On cleaning up" below

const clientOptions = {
  // TODO: add more client options
  uriConverters: createUriConverters(),
}

const client = new LanguageClient('als', 'Agda Language Server', serverOptions, clientOptions)
client.registerProposedFeatures()

client.onRequest('agda', (res, opts) => {
  // TODO: add your own callback handling logic
})

client.start()
```

If you are using TypeScript, include the type definition `types.d.ts` to have a better experience.

## Note: On cleaning up

When the language client is busy, stopping the language client will not terminate the WASM module immediately.

The transport object returned from `AgdaLanguageServerFactory.createServer` implements the [Disposable](https://vscode-api.netlify.app/classes/vscode.disposable) interface. When its `dispose` method is called, the worker executing the WASM module will be terminated (if it is running), and a promise resolving to the exit code is returned. As illustrated in the example, it is very hacky to retain a reference to the transport object while fully adhering to the API structure and avoiding monkey-patching anything.

The factory itself is also a Disposable. Disposing it will terminate all workers created from it. You can register it to your extension's [`context.subscriptions`](https://vscode-api.netlify.app/interfaces/vscode.extensioncontext#subscriptions).

## Note: Preparing the memory filesystems

You need a copy of Agda's built-in files to be extracted in the memfs for Agda to function properly. This loader provides a helper function `memfsUnzip` for this task:

```ts
// const ext = extensions.getExtension('qbane.als-wasm-loader')
const resp = await fetch('path/to/agda-data.zip')
await ext.exports.memfsUnzip(memfsAgdaDataDir, await resp.bytes())
```

You can setup other memfs' in the hook `presetupCallback`. Be careful of mount points!

### The setup step (Agda v2.8.0 or later)

Starting with newer ALS (containing [this patch](https://github.com/agda/agda-language-server/pull/39)) powered by Agda v2.8.0 or later, you can skip the memfs preparation step with the option `runSetupFirst`. The factory will run command `als --setup` before actually running the server, extracting data files (in v2.8.0 this is ~600 kB) to the memfs' datadir. The downside is that no interface file for Agda built-ins will be written due to memfs being read-only at runtime (for now).

The setup step can be monitored by passing a function to `setupCallback`, which is called once the setup process is exited, with the exit code and the piped content of stderr as parameters, respectively. If this step fails and the callback is not set, the server will crash before its start.

# Acknowledgements

The included WASM WASI Core Extension fixes some WASM/WASI issues to satisfy Haskell-based WASM modules' need, including but not limited to:

* [vscode-wasm #226: fix assumptions about how fd\_prestat\_get may be called](https://github.com/microsoft/vscode-wasm/pull/226)
* [vscode-wasm #205: Optimize fd\_write for Performance Improvements](https://github.com/microsoft/vscode-wasm/pull/205); requires Node 20, which in turn requires VS Code desktop 1.90.0, or a modern browser. Fallback implementation is included.
