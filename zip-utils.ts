import { MemoryFileSystem } from '@vscode/wasm-wasi/v1'
import JSZip from 'jszip'
import { MemfsUnzipOptions } from './types'

export async function memfsUnzip(memfs: MemoryFileSystem, data: Uint8Array, options?: MemfsUnzipOptions) {
  const zip = await JSZip.loadAsync(data)
  let prefix = options?.prefix ?? '/'
  if (!prefix.startsWith('/')) {
    throw new Error('Prefix should be an absolute path starting with "/"')
  }
  if (prefix === '/') {
    prefix = ''
  } else {
    // ensure that prefix root exists
    try {
      memfs.createDirectory(prefix)
    } catch {}
  }

  memfsUnzipPrim(zip, prefix, options?.filter, (path, file) => {
    if (file.dir) {
      memfs.createDirectory(path)
    } else {
      // https://github.com/Stuk/jszip/issues/643
      const { uncompressedSize } = (file as any)._data as { uncompressedSize: number }

      memfs.createFile(path, {
        size: BigInt(uncompressedSize),
        reader: () => file.async('uint8array'),
      })
    }
  })

  return memfs
}

export function memfsUnzipPrim(
  zip: JSZip, prefix: string, filter: MemfsUnzipOptions['filter'],
  callback: (path: string, file: JSZip.JSZipObject) => void) {

  const ignoredDirs: Set<string> = new Set()

  zip.forEach((relpathOrig, file) => {
    let relpath = relpathOrig
    if (file.dir) {
      // dir always has a trailing "/"; strip it
      relpath = relpath.slice(0, -1)
    }

    const lastSlash = relpath.lastIndexOf('/')
    const dirname = lastSlash >= 0 ? relpath.slice(0, lastSlash) : ''

    let skipped = false

    // if a dir is ignored, all its children are skipped
    // if jszip always iterates in pre-order, we can do better by using a stack
    if (dirname && ignoredDirs.has(dirname)) {
      skipped = true
    }

    if (!skipped && filter && !filter(relpathOrig)) {
      skipped = true
    }

    if (skipped) {
      if (file.dir) {
        ignoredDirs.add(relpath)
      }
      return
    }

    callback(prefix + '/' + relpathOrig, file)
  })
}

/** deprecated -- use `memfsUnzip` instead */
export function prepareMemfsFromAgdaDataZip(data: Uint8Array, memfs: MemoryFileSystem) {
  return memfsUnzip(memfs, data)
}
