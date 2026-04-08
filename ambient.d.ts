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

  type ReadableStream = {
    read(): Promise<Uint8Array>
    read(mode: 'max', size: number): Promise<Uint8Array>
    read(mode?: 'max', size?: number): Promise<Uint8Array>
  }
}
