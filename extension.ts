import type { MemoryFileSystem, MountPointDescriptor, ProcessOptions, Readable, Wasm } from '@vscode/wasm-wasi/v1'
import type { ALSServerOptions, ALSWasmLoaderExports } from './types'

import { ExtensionContext, Uri, workspace } from 'vscode'

import * as WasmWasiCore from '@agda-web/wasm-wasi-core'
import {
  createStdioOptions,
  createUriConverters,
  startServer,
} from '@agda-web/wasm-wasi-lsp'
import { prepareMemfsFromAgdaDataZip } from './zip-utils'

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

  class AgdaLanguageServerFactory {
    static defaultEnv = {
      HOME: '/home/user',
      Agda_datadir: '/opt/agda',
    }

    constructor(readonly wasm: Wasm, readonly module: WebAssembly.Module) {}

    private static eagain(): Error {
      const err: any = new Error("This read to stdin would block")
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

      await options.presetupCallback?.({
        memfsTempDir,
        memfsHome,
        memfsAgdaDataDir,
      })

      if (options.runSetupFirst) {
        const setupProcess = await this.wasm.createProcess('als', this.module, {
          env,
          args: ['--setup'],
          stdio: { out: { kind: 'pipeOut' }, err: { kind: 'pipeOut' } },
          mountPoints,
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
      const stdio = createStdioOptions()
      const stdinPipe = this.wasm.createWritable()
      const origRead = (stdinPipe as any).read.bind(stdinPipe)
      ;(stdinPipe as any).read = function(mode?: 'max', size?: number) {
        if (this.fillLevel === 0) {
          throw AgdaLanguageServerFactory.eagain()
        }
        return origRead(mode, size)
      }
      stdio.in = { kind: 'pipeIn', pipe: stdinPipe }

      const process = await this.wasm.createProcess('als', this.module, {
        initial: 256,
        maximum: 1024,
        shared: true,
        ...options.memoryOptions,
      }, {
        env,
        stdio,
        args: options.args ?? ['+RTS', '-V1', '-RTS'],
        mountPoints,
        ...processOptions,
      })

      return startServer(process)
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
  }

  return {
    AgdaLanguageServerFactory,
    WasmAPILoader,
    createUriConverters,
    prepareMemfsFromAgdaDataZip,
  }
}

export function deactivate() {}
