declare module '@agda-web/wasm-wasi-core' {
  import type { Uri } from 'vscode'

  export const activate: (context: {
    extensionUri: Uri,
    extension: {
      packageJSON: {
        version: string
      }
    }
  }) => Promise<import('./types').APILoader>

  import type { Writable } from '@vscode/wasm-wasi/v1'

  /* See /vscode-wasm/wasm-wasi-core/src/common/streams.ts */
  interface WritableStream extends Writable {
    /** originally protected */
    fillLevel: number

    read(): Promise<Uint8Array>
    read(mode: 'max', size: number): Promise<Uint8Array>
    read(mode?: 'max', size?: number): Promise<Uint8Array>
  }
}
