import type { MemoryFileSystem, MountPointDescriptor, ProcessOptions, Readable, Wasm, WasmProcess } from '@vscode/wasm-wasi/v1'
import type {
  AgdaLanguageServerFactory as AgdaLanguageServerFactoryType,
  ALSServerOptions,
  ALSWasmLoaderExports,
  DisposableMessageTransports,
} from './types'

import { Uri, workspace, type ExtensionContext, type Disposable } from 'vscode'

import * as WasmWasiCore from '@agda-web/wasm-wasi-core'
import {
  createStdioOptions,
  createUriConverters,
  startServer,
} from '@agda-web/wasm-wasi-lsp'
import { memfsUnzip, prepareMemfsFromAgdaDataZip } from './zip-utils'
import type { MessageTransports } from 'vscode-languageclient'

function collectPipeOutput(readable: Readable) {
  let result = ''
  const decoder = new TextDecoder()
  readable.onData(data => {
    result += decoder.decode(data, { stream: true })
  })
  return () => (result + decoder.decode()).trimEnd()
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
      HOME: '/home/user',
      Agda_datadir: '/opt/agda',
    }

    private aliveTransports = new Set<DisposableMessageTransports>()

    constructor(readonly wasm: Wasm, readonly module: WebAssembly.Module) {}

    private static eagain(): Error {
      const err: any = new Error('This read to stdin would block')
      err._isWasiError = true
      err.errno = 6 /* Errno.again */
      return err
    }

    async createServer(
      memfsAgdaDataDir: MemoryFileSystem,
      processOptions: Partial<Omit<ProcessOptions, 'env' | 'args'>> = {},
      options: ALSServerOptions = {}) {

      if ('env' in processOptions) {
        throw new Error('Should pass env from the options parameter')
      }

      if ('args' in processOptions) {
        throw new Error('Should pass args from the options parameter')
      }

      const memfsTempDir = await this.wasm.createMemoryFileSystem()
      const memfsHome = await this.wasm.createMemoryFileSystem()

      const env = options.env ?
        { ...AgdaLanguageServerFactory.defaultEnv, ...options.env } :
        AgdaLanguageServerFactory.defaultEnv

      const mountPoints: MountPointDescriptor[] = [
        { kind: 'workspaceFolder' },
        { kind: 'memoryFileSystem', fileSystem: memfsTempDir, mountPoint: '/tmp' },
        { kind: 'memoryFileSystem', fileSystem: memfsHome, mountPoint: env.HOME },
        { kind: 'memoryFileSystem', fileSystem: memfsAgdaDataDir, mountPoint: env.Agda_datadir },
      ]

      await options.presetupCallback?.({ memfsTempDir, memfsHome })

      // TODO: cache the setup result to be reused
      if (options.runSetupFirst) {
        const setupProcess = await this.wasm.createProcess('als', this.module, {
          env,
          args: ['--setup'],
          stdio: { out: { kind: 'pipeOut' }, err: { kind: 'pipeOut' } },
          mountPoints,
          ...processOptions,
        })
        const stdoutDone = collectPipeOutput(setupProcess.stdout!)
        const stderrDone = collectPipeOutput(setupProcess.stderr!)
        const setupExitCode = await setupProcess.run()
        if (options.setupCallback == null && setupExitCode !== 0) {
          throw new Error(`server failed at setup step: stdout=[${stdoutDone()}] stderr=[${stderrDone()}]`)
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
      ;(transports as any)._process = process

      return transports
    }

    private createStdio() {
      const stdio = createStdioOptions()
      const stdinPipe = this.wasm.createWritable()
      const origRead = (stdinPipe as unknown as WasmWasiCore.ReadableStream).read.bind(stdinPipe)
      ;(stdinPipe as any).read = function(mode?: 'max', size?: number) {
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
      const entries = Array.from(this.aliveTransports.values())

      return Promise.all(entries.map(async tx => {
        const ret = await tx.dispose()
        return [tx, ret] as [DisposableMessageTransports, number]
      }))
    }
  }

  return {
    AgdaLanguageServerFactory,
    WasmAPILoader,
    createUriConverters,
    memfsUnzip,
    prepareMemfsFromAgdaDataZip,
  }
}

export function deactivate() {}
