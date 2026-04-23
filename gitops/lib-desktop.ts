import { commands, extensions, window, type Uri } from 'vscode'
import type { LibAPI, ServerRefInfo, GitCloneOptions, RefEntry } from '$gitops'
import type { GitExtension, API as GitAPI } from './vscode-git'

const decoder = new TextDecoder()
function decode(s: Uint8Array) {
  return decoder.decode(s)
}

async function ensureGitExtension(): Promise<GitAPI> {
  const ext = extensions.getExtension<GitExtension>('vscode.git')
  if (ext != null) {
    if (!ext.isActive) {
      await ext.activate()
    }
    if (ext.exports.enabled) {
      return ext.exports.getAPI(1)
    }
  }

  await window.showErrorMessage(`Git extension is not installed or is disabled. Please check and try again.`)
  throw new Error('Cannot proceed without vscode.git extension')
}

function delimitLines(buf: Uint8Array) {
  let i
  const chunks = []
  while ((i = buf.indexOf(10)) >= 0) {
    const chunk = buf.subarray(0, i)
    chunks.push(chunk)
    buf = buf.subarray(i + 1)
  }

  return chunks
}

function parseHeadSymRef(buf: Uint8Array) {
  const idx = buf.indexOf(0)
  if (idx < 0) throw new Error('Cannot find null byte in metadata')
  const text = decode(buf.subarray(idx + 1))
  // XXX: naive parsing, might not handle escapings
  // https://github.com/isomorphic-git/isomorphic-git/blob/v1.37.4/src/wire/parseRefsAdResponse.js#L59
  const mat = text.match(/\ssymref=HEAD:refs\/heads\/(\S+)/)
  if (mat == null) return undefined
  return mat[1]
}

export async function fetchServerRefInfo(url: string): Promise<ServerRefInfo> {
  // git extension has but does not export `ls-remote` which is unfortunate;
  // but it is not surprisingly hard to parse by hand
  const lines = await fetch(`${url}/info/refs?service=git-upload-pack`)
    .then(r => {
      if (r.status >= 400) throw new Error(`Request failed: ${r.status}`)
      if (r.headers.get('content-type') !== 'application/x-git-upload-pack-advertisement')
        throw new Error(`Probably wrong response content type: ${r.headers.get('content-type')}`)

      return r.bytes()
    }).then(delimitLines)

  const branches: RefEntry[] = []
  const tags: RefEntry[] = []
  const REFS_HEADS = 'refs/heads/'

  lines.slice(2)
    .map(xs => [decode(xs.slice(4, 44)), decode(xs.slice(45))])
    .forEach(([oid, ref]) => {
      let mat: RegExpMatchArray | null

      if (ref.startsWith(REFS_HEADS)) {
        branches.push({ name: ref.slice(REFS_HEADS.length), oid })
      } else if ((mat = ref.match(/^refs\/tags\/([^]+)$/)) && !ref.endsWith('^{}')) {
        tags.push({ name: mat[1]!, oid })
      }
    })

  return {
    HEAD: parseHeadSymRef(lines[1]),
    tags,
    branches,
  }
}

export async function gitClone(url: string, dest: Uri, ref?: string, options?: GitCloneOptions): Promise<void> {
  if (dest.scheme === 'vscode-userdata') {
    dest = dest.with({ scheme: 'file' })
  } else if (dest.scheme !== 'file') {
    throw new Error('The destination should be a local directory.')
  }

  const gitAPI = await ensureGitExtension()

  await gitAPI.init(dest)
  const repo = await gitAPI.openRepository(dest)

  if (repo == null) {
    throw new Error(`Failed to locate the git repository at URI ${dest.toString()}`)
  }

  await repo.fetch(url, ref, options?.shallow ? 1 : undefined)
  await repo.checkout('FETCH_HEAD')

  // WTF moment: there is no API for closing a repo
  await commands.executeCommand('git.close', dest)
}

;({
  fetchServerRefInfo,
  gitClone,
} satisfies LibAPI)
