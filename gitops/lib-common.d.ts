import type { Uri } from 'vscode'

interface RefEntry {
  name: string
  oid: string
}

interface ServerRefInfo {
  HEAD: string | undefined
  branches: RefEntry[]
  tags: RefEntry[]
}

interface GitCloneOptions {
  shallow?: boolean
  onProgress?: (info: { message: string, increment: number }) => void | Promise<void>
}

export function fetchServerRefInfo(url: string): Promise<ServerRefInfo>
export function gitClone(url: string, dest: Uri, ref?: string, options?: GitCloneOptions): Promise<void>

type LibAPI = {
  fetchServerRefInfo: typeof fetchServerRefInfo,
  gitClone: typeof gitClone,
}
