import { Environment, MemoryFileSystem, ProcessOptions, Wasm, MountPointDescriptor } from '@vscode/wasm-wasi/v1'
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
  /** to convert workspace URI to WASM absolute path like `/workspace/foo/bar` */
  code2Protocol: (value: Uri) => string,
  protocol2Code: (value: string) => Uri,
}

/** the extended interface of `MessageTransports` that can be used to terminate the underlying WASM process. */
export interface DisposableMessageTransports extends MessageTransports {
  /** new in v0.7.0 */
  dispose(): Promise<number>
}

/** Note that the file system options are stripped out on purpose */
export type UserProcessOptions = Omit<ProcessOptions, 'env' | 'args'>

export class AgdaLanguageServerFactory implements Disposable {
  /**
   * Environment variables that are provided to the runtime by default.
   * The content can vary between versions, so you should treat each of them as opaque. */
  static defaultEnv: {
    HOME: string,
    Agda_datadir: string,
    /**
     * new in v0.8.0.
     * The content is a path pointing to the mount point for `context.globalStorageUri`. */
    ALSWASM_GLOBAL_STORE_DIR: string,
    /**
     * new in v0.8.0.
     * The content is a path pointing to the mount point for `context.storageUri`.
     * Note that the mount point is created only if a workspace is opened at the time the extension is activated. */
    ALSWASM_WORKSPACE_STORE_DIR: string,
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

export interface UserFileSystemOptions {
  ignoreDefaults?: boolean
  mountpoints?: MountPointDescriptor[]
}

interface _MemfsUnzipOptions {
  /** the absolute path (empty means `/`) to unarchive the zip into */
  prefix: string
  /** called once for each file/dir in the archive; return `false` to omit unwanted files */
  filter: (path: string) => boolean
}

export interface MemfsUnzipOptions extends Partial<_MemfsUnzipOptions> {}

/**
 * Return a list of paths to library files relative to `prefix` (or `base` in VFS) */
interface LibraryEntry {
  base: string
  prefix: Uri
  paths: string[]
}

export interface ConfiguredLibraryEntry {
  source: 'global' | 'workspace' | 'workspaceFolder'
  base: string
  paths: string[]
}

export interface ALSWasmLoaderExports {
  AgdaLanguageServerFactory: typeof AgdaLanguageServerFactory
  WasmAPILoader: APILoader

  /** to be used in the `uriConverters` property of client options */
  createUriConverters: () => URIConverters | undefined

  /** loads `data` as a ZIP archive and mutate `memfs` to extract files */
  memfsUnzip: (memfs: MemoryFileSystem, data: Uint8Array, options: MemfsUnzipOptions) => Promise<MemoryFileSystem>

  /** @deprecated use `extractToMemfs` instead */
  prepareMemfsFromAgdaDataZip: (data: Uint8Array, memfs: MemoryFileSystem) => Promise<MemoryFileSystem>

  /**
   * New in v0.8.0.
   * Search for valid libraries installed inside the extension storage. */
  listInstalledLibraries(): Promise<LibraryEntry>

  /**
   * New in v0.9.0. */
  listConfiguredLibraries(uri: Uri): Promise<ConfiguredLibraryEntry[]>
}

interface _ALSServerOptions {
  runSetupFirst: boolean
  presetupCallback: (filesystems: {
    memfsTempDir: MemoryFileSystem,
    memfsHome: MemoryFileSystem,
  }) => Promise<void>
  memoryOptions: Partial<WebAssembly.MemoryDescriptor>,
  fileSystemOptions: UserFileSystemOptions,
  setupCallback: (exitCode: number, result: string) => void
  env: Environment
  args: string[]
}

export interface ALSServerOptions extends Partial<_ALSServerOptions> {}
