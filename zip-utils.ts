import { MemoryFileSystem } from '@vscode/wasm-wasi/v1'
import JSZip from 'jszip'

export async function prepareMemfsFromAgdaDataZip(data: Uint8Array, memfs: MemoryFileSystem) {
  const zip = await JSZip.loadAsync(data)
  zip.forEach((path, file) => {
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
