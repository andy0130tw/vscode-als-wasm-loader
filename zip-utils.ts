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
      const data = (file as any)._data
      // https://github.com/Stuk/jszip/issues/643
      // XXX: there is a quirk that a zero-sized file is converted to a promise;
      // losing its uncompressed size
      const actualSize: number = data?.uncompressedSize ?? 0
      memfs.createFile(path, actualSize !== 0 ? {
        size: BigInt(actualSize),
        reader: () => file.async('uint8array'),
      } : new Uint8Array())
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

    const skipped = (
      // if a dir is ignored, all its children are skipped
      // if jszip always iterates in pre-order, we can do better by using a stack
      (dirname && ignoredDirs.has(dirname)) ||
      // if not, we query the filter function to find out
      (filter && !filter(relpathOrig)))

    if (skipped) {
      if (file.dir) {
        ignoredDirs.add(relpath)
      }
      return
    }

    // omit the leading "/"
    callback((prefix + '/' + relpathOrig).slice(1), file)
  })
}

/** deprecated -- use `memfsUnzip` instead */
export function prepareMemfsFromAgdaDataZip(data: Uint8Array, memfs: MemoryFileSystem) {
  return memfsUnzip(memfs, data)
}
