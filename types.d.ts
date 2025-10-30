import { startServer } from '@agda-web/wasm-wasi-lsp'
import { Environment, MemoryFileSystem, ProcessOptions, Wasm } from '@vscode/wasm-wasi/v1'
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

interface _MemfsUnzipOptions {
  /** the absolute path (empty means `/`) to unarchive the zip into */
  prefix: string
  /** called once for each file/dir in the archive; return `false` to omit unwanted files */
  filter: (path: string) => boolean
}

declare interface MemfsUnzipOptions extends Partial<_MemfsUnzipOptions> {}

declare interface ALSWasmLoaderExports {
  AgdaLanguageServerFactory: typeof AgdaLanguageServerFactory
  WasmAPILoader: APILoader

  /** to be used in the `uriConverters` property of client options */
  createUriConverters: () => URIConverters | undefined

  /** loads `data` as a ZIP archive and mutate `memfs` to extract files */
  memfsUnzip: (memfs: MemoryFileSystem, data: Uint8Array, options: MemfsUnzipOptions) => Promise<MemoryFileSystem>

  /** @deprecated use `extractToMemfs` instead */
  prepareMemfsFromAgdaDataZip: (data: Uint8Array, memfs: MemoryFileSystem) => Promise<MemoryFileSystem>
}

interface _ALSServerOptions {
  runSetupFirst: boolean
  presetupCallback: (filesystems: {
    memfsTempDir: MemoryFileSystem,
    memfsHome: MemoryFileSystem,
  }) => Promise<void>
  memoryOptions: Partial<WebAssembly.MemoryDescriptor>,
  setupCallback: (exitCode: number, result: string) => void
  env: Environment
  args: string[]
}

export interface ALSServerOptions extends Partial<_ALSServerOptions> {}
