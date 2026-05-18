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
export function maybeRewriteGitSubmodulePath(path: string, wsuri: Uri): Promise<string>

type LibAPI = {
  fetchServerRefInfo: typeof fetchServerRefInfo,
  gitClone: typeof gitClone,
  maybeRewriteGitSubmodulePath: typeof maybeRewriteGitSubmodulePath,
}

export type GitSubmoduleClonerAPI = {
  gitClone: LibAPI['gitClone']
  fetchServerRefInfo: LibAPI['fetchServerRefInfo']
  getWorkspaceId(uri: Uri): string
  listSubmodules(uri: Uri): Promise<GitModuleParseResult>
  storageUri?: Uri
}

export interface GitSubmoduleSpec {
  name: string
  nameRaw?: string
  path: string
  url: string
}

export interface GitModuleParseResult {
  entries: GitSubmoduleSpec[]
  errors: (Error & { name?: string })[]
}
