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
}
