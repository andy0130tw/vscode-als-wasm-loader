import { type ExtensionContext, window, workspace, Uri, FileType, QuickPickItem, QuickPickItemKind, env, UIKind } from 'vscode'

interface LibraryDescriptor {
  name: string
  slug: string
  url: string
  description: string
  defaultRef: string
}

const libraryCatelog: LibraryDescriptor[] = [
  {
    name: 'Standard library',
    slug: 'standard-library',
    url: 'https://github.com/agda/agda-stdlib',
    description: 'The Agda standard library',
    defaultRef: 'v2.3',
  },
  {
    name: 'Cubical',
    slug: 'cubical',
    url: 'https://github.com/agda/cubical',
    description: 'An experimental library for Cubical Agda',
    defaultRef: 'v0.9',
  },
]

interface InstalledLibrary {
  name: string
  version: string | null
  folderName: string
}

type QuickPickItemVariant = { kind: QuickPickItemKind.Separator } | { command: string } | { data: InstalledLibrary } | { isInvalid: true }

type InstalledLibraryQuickPickItem = QuickPickItem & QuickPickItemVariant & {
  // newer VS Code provides integration if a URI is provided
  resourceUri?: Uri
}

const parseLibName = (text: string): [string, string[]] => {
  const cs = Array.from(text)
  let i = cs.length - 1
  for (; i >= 0; i--) {
    const c = cs[i]
    if (!(c == '.' || (c >= '0' && c <= '9'))) break
  }
  if (cs[i] == '-') {
    const nn = text.slice(0, i)
    const vv = text.slice(i + 1).split('.')
    if (vv.every(x => !!x)) return [nn, vv]
  }
  return [text, []]
}

async function pickAndInstallFromLibraryCatalog() {
  const libPicked = await window.showQuickPick<QuickPickItem & { descriptor: LibraryDescriptor }>(libraryCatelog.map(lib => {
    return {
      iconPath: { id: 'package' },
      label: lib.name,
      detail: lib.description,
      descriptor: lib,
    }
  }), { placeHolder: 'Select a library...' })
  if (libPicked == null) return

  // TODO: fetch server refs
  const commitPicked = await window.showQuickPick([{ iconPath: { id: 'tag' }, label: libPicked.descriptor.defaultRef }], {
    placeHolder: 'Select a tag to install...', // TODO: tag "or input a commit hash"
  })

  // TODO: allow to go back
  if (commitPicked == null) return

  await window.showInformationMessage(`You picked ${libPicked.descriptor.slug} ${commitPicked?.label}`)

  // TODO: install it
}

async function probeInstalledLibraries(root: Uri) {
  const entries = await workspace.fs.readDirectory(root)
  const dirNames = entries
    .filter(([, type]) => type & FileType.Directory)
    .map(([name]) => name)

  const results = await Promise.allSettled(dirNames.map(async dn => {
    const uri = Uri.joinPath(root, dn)
    const libFiles = await workspace.fs.readDirectory(uri).then(
      names => names.filter(([name, type]) => type & FileType.File && name.endsWith('.agda-lib')))

    try {
      if (libFiles.length == 0) return null
      if (libFiles.length > 1) throw new Error('Multiple .agda-lib files found')

      const [ libFile ] = libFiles[0]
      const uriToLibFile = Uri.joinPath(uri, libFile)

      const content = new TextDecoder().decode(await workspace.fs.readFile(uriToLibFile))
      const parsed = content.match(/^name: (.+)/m)
      if (!parsed) {
        throw new Error(`Could not parse "${dn}/${libFile}"`)
      }

      const [libName, libVersion] = parseLibName(parsed[1])

      return {
        name: libName,
        version: libVersion.join('.'),
        folderName: dn,
      } as InstalledLibrary
    } catch (err: any) {
      err.folderName = dn
      throw err
    }
  }))

  return results.map<InstalledLibraryQuickPickItem | null>(result => {
    if (result.status === 'rejected') {
      const err: Error & { folderName: string } = result.reason
      return {
        isInvalid: true,
        iconPath: { id: 'warning' },
        label: `(Invalid)`,
        description: err.folderName,
        detail: `Reason: ${result.reason.message}`,
      }
    }
    if (result.value) {
      const lib = result.value
      return {
        iconPath: { id: 'library' },
        label: lib.name + (lib.version ? ' \u2022 ' + lib.version : ''),
        // resourceUri as description is too lengthy
        description: lib.folderName,
        resourceUri: Uri.joinPath(root, lib.folderName),
        data: lib,
        buttons: [
          ...(env.uiKind === UIKind.Desktop ?
            [{ command: 'open-in-explorer', tooltip: 'Open in explorer', iconPath: { id: 'link-external' } }] : []),
        ]
      }
    }
    return null
  }).filter(x => !!x)
}

export async function _manageLibraries(context: ExtensionContext, ..._args: any[]) {
  let showInvalid = false
  let items: InstalledLibraryQuickPickItem[] = []

  const qp = window.createQuickPick<InstalledLibraryQuickPickItem>()

  qp.title = 'Manage installed libraries for ALS WASM'
  qp.buttons = [
    { ['index' as any]: 0, ['command' as any]: 'toggle-invalid', iconPath: { id: 'eye-closed' }, tooltip: 'Show invalid entries' },
  ]
  qp.matchOnDescription = true
  qp.busy = true
  qp.show()

  function updateItems() {
    if (showInvalid) {
      qp.items = items
    } else {
      qp.items = items.filter(x => x.alwaysShow || !('isInvalid' in x && x.isInvalid))
    }
  }

  probeInstalledLibraries(context.globalStorageUri).then(probedLibraries => {
    items = [
      {
        command: 'install-a-library',
        iconPath: { id: 'plus' },
        label: 'Install a library...',
        alwaysShow: true,
      },
      { kind: QuickPickItemKind.Separator, label: 'installed libraries', alwaysShow: true },
      ...probedLibraries,
    ]
    qp.busy = false
    updateItems()
  })

  qp.onDidAccept(async () => {
    const item = qp.selectedItems[0]
    if ('command' in item) {
      if (item.command === 'install-a-library') {
        pickAndInstallFromLibraryCatalog()
      }
    }
  })

  qp.onDidTriggerButton(async btn => {
    const { command, index } = btn as any
    if (command === 'toggle-invalid') {
      showInvalid = !showInvalid
      const newButtons = qp.buttons.slice()
      newButtons[index] = { ...newButtons[index], iconPath: { id: showInvalid ? 'eye' : 'eye-closed' } }
      qp.buttons = newButtons
      updateItems()
    }
  })

  qp.onDidTriggerItemButton(async evt => {
    const { command } = evt.button as any
    if (command === 'open-in-explorer') {
      if (!evt.item.resourceUri) return
      let uri = evt.item.resourceUri
      if (uri.scheme === 'vscode-userdata') {
        uri = uri.with({ scheme: 'file' })
      }
      const ok = await env.openExternal(uri)
      if (!ok) {
        await window.showErrorMessage(`Cannot goto ${evt.item.resourceUri.toString()}`)
        return
      }
    }
  })
}

const makeCurried = <Head = unknown, Tail extends unknown[] = unknown[], Ret = unknown>
  (f: (ctx: Head, ...args: Tail) => Ret) =>
    (ctx: Head) => (...args: Tail) => f(ctx, ...args)

export const manageLibraries = makeCurried(_manageLibraries)
