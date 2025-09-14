/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MemoryFileSystem, MountPointDescriptor, ProcessOptions, Wasm } from '@vscode/wasm-wasi/v1'
import type { ALSWasmLoaderExports } from './types'

import { ExtensionContext, Uri, workspace } from 'vscode'

import * as WasmWasiCore from '@agda-web/wasm-wasi-core'
import {
  createStdioOptions,
  createUriConverters,
  startServer,
} from '@agda-web/wasm-wasi-lsp'

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
    static HOME = '/home/user'
    static Agda_datadir = '/opt/agda'

    constructor(readonly wasm: Wasm, readonly module: WebAssembly.Module) {}

    private static eagain(): Error {
      const err: any = new Error("This read to stdin would block")
      err._isWasiError = true
      err.errno = 6 /* Errno.again */
      return err
    }

    async createServer(memfsAgdaDataDir: MemoryFileSystem, processOptions: Partial<ProcessOptions> = {}) {
      const memfsTempDir = await this.wasm.createMemoryFileSystem()
      const memfsHome = await this.wasm.createMemoryFileSystem()

      const { HOME, Agda_datadir } = AgdaLanguageServerFactory

      const mountPoints: MountPointDescriptor[] = [
        { kind: 'workspaceFolder' },
        { kind: 'memoryFileSystem', fileSystem: memfsTempDir, mountPoint: '/tmp' },
        { kind: 'memoryFileSystem', fileSystem: memfsHome, mountPoint: HOME },
        { kind: 'memoryFileSystem', fileSystem: memfsAgdaDataDir, mountPoint: Agda_datadir },
      ]

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
      }, {
        env: {
          HOME,
          Agda_datadir,
        },
        stdio,
        args: [
          '+RTS', '-V1', '-RTS',
          // workaround (but to hide it) for the path issue which I haven't dig into
          '+AGDA', '-WnoDuplicateInterfaceFiles', '-AGDA'],
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

      let result = ''
      const decoder = new TextDecoder()
      process.stdout.onData(data => {
        result += decoder.decode(data, { stream: true })
      })
      await process.run()
      return (result + decoder.decode()).trimEnd()
    }

    queryVersionString() {
      return this.queryOutput(['--version'])
    }
  }

  return {
    AgdaLanguageServerFactory,
    WasmAPILoader,
    createUriConverters,
  }
}

export function deactivate() {}
