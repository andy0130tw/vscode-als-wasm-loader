import type { MemoryFileSystem, MountPointDescriptor, Readable, Wasm } from '@vscode/wasm-wasi/v1'
import type {
  AgdaLanguageServerFactory as AgdaLanguageServerFactoryType,
  ALSServerOptions,
  ALSWasmLoaderExports,
  DisposableMessageTransports,
  UserProcessOptions,
} from './types'

import { Uri, workspace, type ExtensionContext, commands, extensions } from 'vscode'

import * as WasmWasiCore from '@agda-web/wasm-wasi-core'
import {
  createStdioOptions,
  createUriConverters,
  startServer,
} from '@agda-web/wasm-wasi-lsp'
import * as ExtCommands from './commands'
import { memfsUnzip, prepareMemfsFromAgdaDataZip } from './zip-utils'
import { GitSubmoduleClonerAPI } from '$gitops'

async function exists(uri: Uri) {
  return workspace.fs.stat(uri).then(() => true, err => {
    if (err?.code === 'FileNotFound') return false
    throw err
  })
}

async function getSubmoduleClonerStorageUri() {
  const ext = extensions.getExtension<GitSubmoduleClonerAPI>('qbane.vscode-git-submodule-cloner')
  if (ext == null) return null
  if (!ext.isActive) await ext.activate()
  return ext.exports.storageUri ?? null
}

function collectPipeOutput(readable: Readable) {
  let result = ''
  const decoder = new TextDecoder()
  readable.onData(data => {
    result += decoder.decode(data, { stream: true })
  })
  return () => (result + decoder.decode()).trimEnd()
}

function memfsHasBeenSetup(memfs: MemoryFileSystem) {
  const memfsPriv = memfs as unknown as { root: { entries: Map<string, unknown> } }
  return memfsPriv.root.entries.has('lib')
}

export async function activate(context: ExtensionContext): Promise<ALSWasmLoaderExports> {
  const coreDir = 'vscode-wasm/wasm-wasi-core'
  const corePkgJSONRaw = await workspace.fs.readFile(Uri.joinPath(context.extensionUri, coreDir, 'package.json'))
  const corePkgJSON = JSON.parse(new TextDecoder().decode(corePkgJSONRaw)) as { version: string }

  const WasmAPILoader = await WasmWasiCore.activate({
    extensionUri: Uri.joinPath(context.extensionUri, coreDir),
    extension: {
      packageJSON: {
        version: corePkgJSON.version,
      }
    }
  })

  class AgdaLanguageServerFactory implements AgdaLanguageServerFactoryType {
    static defaultEnv = {
      TMPDIR: '/tmp',
      HOME: '/home/user',
      Agda_datadir: '/opt/agda',
      ALSWASM_GLOBAL_STORE_DIR: '/opt/global',
      ALSWASM_WORKSPACE_STORE_DIR: '/opt/workspace',
    }

    private aliveTransports = new Set<DisposableMessageTransports>()

    constructor(readonly wasm: Wasm, readonly module: WebAssembly.Module) {}

    static buildFromModule(module: WebAssembly.Module) {
      const wasm = WasmAPILoader.load()
      return new AgdaLanguageServerFactory(wasm, module)
    }

    static async buildFromUri(uriToModule: Uri) {
      const wasm = WasmAPILoader.load()
      return new AgdaLanguageServerFactory(wasm, await wasm.compile(uriToModule))
    }

    private static eagain(): Error {
      const err: any = new Error('This read to stdin would block')
      err._isWasiError = true
      err.errno = 6 /* Errno.again */
      return err
    }

    async createServer(
      memfsAgdaDataDir: MemoryFileSystem,
      processOptions: UserProcessOptions = {},
      options: ALSServerOptions = {}) {

      if ('env' in processOptions) {
        throw new Error('Should pass env from the options parameter')
      }

      if ('args' in processOptions) {
        throw new Error('Should pass args from the options parameter')
      }

      if ('mountPoints' in processOptions || 'rootFileSystem' in processOptions) {
        throw new Error('Should pass mountPoints or rootFileSystem from the options parameter')
      }

      const env = { ...AgdaLanguageServerFactory.defaultEnv, ...options.env }

      const agdaDataDirDesc: MountPointDescriptor =
        { kind: 'memoryFileSystem', fileSystem: memfsAgdaDataDir, mountPoint: env.Agda_datadir }

      const presetMountPoints: MountPointDescriptor[] = [
        { kind: 'workspaceFolder' },
        agdaDataDirDesc,
      ]

      if (!options.fileSystemOptions?.ignoreDefaults) {
        const memfsTempDir = await this.wasm.createMemoryFileSystem()
        const memfsHome = await this.wasm.createMemoryFileSystem()

        presetMountPoints.push(
          { kind: 'memoryFileSystem', fileSystem: memfsTempDir, mountPoint: env.TMPDIR },
          { kind: 'memoryFileSystem', fileSystem: memfsHome, mountPoint: env.HOME },
          { kind: 'vscodeFileSystem', uri: context.globalStorageUri, mountPoint: env.ALSWASM_GLOBAL_STORE_DIR },
        )

        if (context.storageUri) {
          presetMountPoints.push(
            { kind: 'vscodeFileSystem', uri: context.storageUri, mountPoint: env.ALSWASM_WORKSPACE_STORE_DIR },
          )
        }

        const maybeSubmodClonerStorageUri = await getSubmoduleClonerStorageUri()
        if (maybeSubmodClonerStorageUri && await exists(maybeSubmodClonerStorageUri)) {
          const env_ = env as Record<string, string>
          env_.SUBMODULE_STORE_DIR = '/submodules'
          presetMountPoints.push(
            { kind: 'vscodeFileSystem', uri: maybeSubmodClonerStorageUri, mountPoint: env_.SUBMODULE_STORE_DIR }
          )
        }

        await options.presetupCallback?.({ memfsTempDir, memfsHome })
      }

      const mountPoints = options.fileSystemOptions?.mountpoints?.length ?
        [...presetMountPoints, ...options.fileSystemOptions.mountpoints] :
        presetMountPoints

      // XXX: we assume that the setup can be skipped if it has been initialized by caller
      if (options.runSetupFirst && !memfsHasBeenSetup(memfsAgdaDataDir)) {
        const setupProcess = await this.wasm.createProcess('als', this.module, {
          env,
          args: ['--setup'],
          stdio: { out: { kind: 'pipeOut' }, err: { kind: 'pipeOut' } },
          mountPoints: [agdaDataDirDesc],
          ...processOptions,
        })
        const stdoutDone = collectPipeOutput(setupProcess.stdout!)
        const stderrDone = collectPipeOutput(setupProcess.stderr!)
        const setupExitCode = await setupProcess.run()
        if (options.setupCallback == null && setupExitCode !== 0) {
          const stdout = stdoutDone()
          const stderr = stderrDone()
          const err = new Error(`server failed at setup step: stdout=[${stdout}] stderr=[${stderr}]`)
          Object.assign(err, { stdout, stderr })
        }

        options.setupCallback?.(setupExitCode, stderrDone())
      }

      // patch the stdin pipe
      const stdio = this.createStdio()

      const process = await this.wasm.createProcess('als', this.module, {
        initial: 1,  // we do not use threads, so it is a waste to allocate this
        maximum: 1,
        shared: true,
        ...options.memoryOptions,
      }, {
        env,
        stdio,
        args: options.args ?? ['+RTS', '-V1', '-RTS'],
        mountPoints,
        ...processOptions,
      })

      const transports = await startServer(process) as DisposableMessageTransports
      this.aliveTransports.add(transports)

      transports.dispose = async () => {
        const ret = await process.terminate()
        this.aliveTransports.delete(transports)
        return ret
      }
      Object.assign(transports, { _process: process })

      return transports
    }

    private createStdio() {
      const stdio = createStdioOptions()
      const stdinPipe = this.wasm.createWritable() as WasmWasiCore.WritableStream
      const origRead = stdinPipe.read.bind(stdinPipe)
      stdinPipe.read = function (mode?: 'max', size?: number) {
        if (this.fillLevel === 0) {
          throw AgdaLanguageServerFactory.eagain()
        }
        return origRead(mode, size)
      }
      stdio.in = { kind: 'pipeIn', pipe: stdinPipe }
      return stdio
    }

    private async queryOutput(args: string[]) {
      const process = await this.wasm.createProcess('als', this.module, {
        args,
        stdio: { out: { kind: 'pipeOut' } },
      })

      const done = collectPipeOutput(process.stdout!)
      await process.run()
      return done()
    }

    queryVersionString() {
      return this.queryOutput(['--version'])
    }

    dispose() {
      const txs = Array.from(this.aliveTransports.values())

      return Promise.all(txs.map(async tx => {
        const ret = await tx.dispose()
        this.aliveTransports.delete(tx)
        return [tx, ret] as [DisposableMessageTransports, number]
      }))
    }
  }

  context.subscriptions.push(
    commands.registerCommand('als-wasm-loader.manage-libraries', ExtCommands.manageLibraries(context)))

  context.subscriptions.push(
    commands.registerCommand('als-wasm-loader.show-configured-libraries', ExtCommands.showConfiguredLibraries))

  return {
    AgdaLanguageServerFactory,
    WasmAPILoader,
    createUriConverters,
    memfsUnzip,
    prepareMemfsFromAgdaDataZip,
    listInstalledLibraries: ExtCommands.listInstalledLibraries(context),
    listConfiguredLibraries: ExtCommands.listConfiguredLibraries,
  }
}

export function deactivate() {}
