import { Environment, MemoryFileSystem, ProcessOptions, Wasm } from '@vscode/wasm-wasi/v1'
import { Uri, Disposable } from 'vscode'
import { MessageTransports } from 'vscode-languageclient'

export interface APILoader {
  load: () => Wasm
}

// workaround an empty interface may represent any objects
declare global {
  namespace WebAssembly {
    interface Module {
      _brand?: void
    }
  }
}

type URIConverters = {
  code2Protocol: (value: Uri) => string,
  protocol2Code: (value: string) => Uri,
}

/** the extended interface of `MessageTransports` that can be used to terminate the underlying WASM process. */
export interface DisposableMessageTransports extends MessageTransports {
  /** new in v0.7.0 */
  dispose(): Promise<number>
}

export type UserProcessOptions = Omit<ProcessOptions, 'env' | 'args'>

export class AgdaLanguageServerFactory implements Disposable {
  static defaultEnv: {
    HOME: string,
    Agda_datadir: string,
    [k: string]: string,
  }

  constructor(wasm: Wasm, module: WebAssembly.Module)

  static buildFromModule(module: WebAssembly.Module): AgdaLanguageServerFactory
  static buildFromUri(uriToModule: Uri): Promise<AgdaLanguageServerFactory>

  createServer(
    memfsAgdaDataDir: MemoryFileSystem,
    processOptions?: UserProcessOptions,
    options?: ALSServerOptions): Promise<DisposableMessageTransports>

  queryVersionString(): Promise<string>

  /** new in v0.7.0 */
  dispose(): Promise<[DisposableMessageTransports, number][]>
}

interface _MemfsUnzipOptions {
  /** the absolute path (empty means `/`) to unarchive the zip into */
  prefix: string
  /** called once for each file/dir in the archive; return `false` to omit unwanted files */
  filter: (path: string) => boolean
}

export interface MemfsUnzipOptions extends Partial<_MemfsUnzipOptions> {}

export interface ALSWasmLoaderExports {
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
