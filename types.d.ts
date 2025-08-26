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
  constructor(wasm: Wasm, module: WebAssembly.Module)
  createServer(memfsAgdaDataDir: MemoryFileSystem, processOptions?: Partial<ProcessOptions>): ReturnType<typeof startServer>
}

declare interface ALSWasmLoaderExports {
  AgdaLanguageServerFactory: typeof AgdaLanguageServerFactory
  WasmAPILoader: APILoader
  // to be used in the `uriConverters` property of client options
  createUriConverters: () => URIConverters
}
