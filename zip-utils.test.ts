import JSZip from 'jszip'
import fs from 'node:fs'
import { it } from 'node:test'
import assert from 'node:assert'
import { memfsUnzipPrim } from './zip-utils'

it('filters', async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync('./fixtures/agda-data.zip'))

  async function count(filter = (_: string) => true, debug = false) {
    let dir = 0, files = 0
    await memfsUnzipPrim(zip, '', filter, (path, file) => {
      if (debug) console.log('+', path)
      if (file.dir) dir++
      else files++
    })

    return [dir, files]
  }

  assert.deepEqual(await count(() => true, true), [12, 75])
  assert.deepEqual(await count(() => false), [0, 0])

  assert.deepEqual(await count(path => {
    if (path === 'lib/prim/Agda/Builtin/Reflection/') {
      return false
    }
    return true
  }), [11, 71])

  assert.deepEqual(await count(path => {
    if (path === 'lib/prim/Agda/Builtin/') {
      return false
    }
    return true
  }), [4, 5])
})
