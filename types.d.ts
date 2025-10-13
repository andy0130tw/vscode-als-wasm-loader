import { startServer } from '@agda-web/wasm-wasi-lsp'
import { MemoryFileSystem, ProcessOptions, Wasm } from '@vscode/wasm-wasi/v1'
import { Uri } from 'vscode'

export interface APILoader {
  load: () => Wasm
}

type URIConverters = {
  code2Protocol: (value: Uri) => string,
  protocol2Code: (value: string) => Uri,
}

declare class AgdaLanguageServerFactory {
  static defaultEnv: {
    HOME: string,
    Agda_datadir: string,
    [k: string]: string,
  }
  constructor(wasm: Wasm, module: WebAssembly.Module)
  createServer(memfsAgdaDataDir: MemoryFileSystem, processOptions?: Partial<ProcessOptions>): ReturnType<typeof startServer>
}

declare interface ALSWasmLoaderExports {
  AgdaLanguageServerFactory: typeof AgdaLanguageServerFactory
  WasmAPILoader: APILoader
  // to be used in the `uriConverters` property of client options
  createUriConverters: () => URIConverters
  prepareMemfsFromAgdaDataZip: (data: Uint8Array, memfs: MemoryFileSystem) => Promise<MemoryFileSystem>
}

interface _ALSServerOptions {
  runSetupFirst: boolean
  setupCallback: (exitCode: number, result: string) => void
}

export interface ALSServerOptions extends Partial<_ALSServerOptions> {}
