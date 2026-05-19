import { fetchServerRefInfo, gitClone, maybeRewriteGitSubmodulePath, RefEntry } from '$gitops'
import {
  type ExtensionContext,
  FileType,
  ProgressLocation,
  QuickPickItem,
  QuickPickItemKind,
  UIKind,
  Uri,
  commands,
  env,
  window,
  workspace,
  WorkspaceFolder,
} from 'vscode'
import type { ConfiguredLibraryEntry } from './types'

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
  folderUri: Uri
  libFileName: string
}

type LibProbeResult = { data: InstalledLibrary } | { isInvalid: true }
type QuickPickItemVariant = (LibProbeResult | { kind: QuickPickItemKind.Separator } | { command: string }) & {
  // newer VS Code provides integration if a URI is provided
  resourceUri?: Uri
}

type InstalledLibraryDesc = QuickPickItem & LibProbeResult
type InstalledLibraryQuickPickItem = QuickPickItem & QuickPickItemVariant

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

async function showActionPicker(item: InstalledLibraryQuickPickItem) {
  if (!('data' in item) || !item.resourceUri) return
  const uriToLibFolder = item.data.folderUri
  const uriToLibFile = item.resourceUri

  const choice = await window.showQuickPick([
    {
      iconPath: { id: 'file-code' },
      label: 'Open library file',
      callback: () => window.showTextDocument(uriToLibFile),
    },
    ...(env.uiKind === UIKind.Desktop ? [{
      iconPath: { id: 'repo' },
      label: 'Mount as a git repository',
      // this will open the source control panel so showing no message should be fine
      callback: async () => {
        await commands.executeCommand('git.openRepository', uriToLibFolder.fsPath)
        await commands.executeCommand('workbench.scm.repositories.focus')
      },
    }] : []),
    {
      iconPath: { id: 'trash' },
      label: 'Delete the library',
      callback: async () => {
        const sure = await window.showWarningMessage(
        `Are you sure you want to delete the library located at "${uriToLibFolder.toString()}"?`,
        { modal: true },
        { title: 'Yes' },
        { title: 'No', isCloseAffordance: true })
        if (sure?.title === 'Yes') {
          const useTrash = env.uiKind === UIKind.Desktop
          await Promise.resolve()
            .then(() => workspace.fs.delete(uriToLibFolder, { recursive: true, useTrash }))
            .catch(err => {
              window.showErrorMessage(
                'Failed deleting library', {
                  modal: true,
                  detail: `Error occurred during deleting library "${uriToLibFolder.toString()}": ${err.message}`,
                })
            })
          window.showInformationMessage(`Deleted "${uriToLibFolder.toString()}"`)
        }
      },
    },
  ], {
    placeHolder: `Choose the action to do with "${item.data.folderName}"...`,
  })

  await choice?.callback()
}

async function pickAndInstallFromLibraryCatalog(context: ExtensionContext) {
  const libPicked = await window.showQuickPick<QuickPickItem & { descriptor: LibraryDescriptor }>(libraryCatelog.map(lib => {
    return {
      iconPath: { id: 'package' },
      label: lib.name,
      detail: lib.description,
      descriptor: lib,
    }
  }), { placeHolder: 'Select a library...' })
  if (libPicked == null) return

  // --- fetch list of refs and let user pick a commit

  const refEntryToItem = (iconID: string) => ({name, oid}: RefEntry) => ({ iconPath: { id: iconID }, label: name, oid })
  type RefEntryDesc = ReturnType<ReturnType<typeof refEntryToItem>>

  const qp = window.createQuickPick<RefEntryDesc>()
  qp.placeholder = 'Select a tag or branch to clone...' // TODO: tag "or input a commit hash"
  qp.busy = true
  qp.show()

  fetchServerRefInfo(libPicked.descriptor.url).then(info => {
    const tags = info.tags.map(refEntryToItem('tag'))
    const branches = info.branches.map(refEntryToItem('git-branch'))

    qp.busy = false
    qp.items = [...tags, ...branches]
    // the user might be interrupted to install the missing the extension dependency
    qp.show()

    const def = tags.find(it => it.label === libPicked.descriptor.defaultRef)
    if (def) qp.activeItems = [def]
  })

  const commitPicked = await new Promise<RefEntryDesc | undefined>(resolve => {
    qp.onDidAccept(() => {
      resolve(qp.selectedItems[0])
      qp.dispose()
    })
    qp.onDidHide(() => {
      resolve(undefined)
      qp.dispose()
    })
  })

  // XXX: allow to go back?
  if (commitPicked == null) return

  const subdirBaseName = `${libPicked.descriptor.slug}-${commitPicked?.label}`
  let subdirName = subdirBaseName
  // pick a fresh name?
  // let cnt = 0
  // while (await exists(Uri.joinPath(context.globalStorageUri, subdirName))) {
  //   subdirName = subdirBaseName + '-' + (++cnt)
  // }

  let dirCreated = false
  const dest = Uri.joinPath(context.globalStorageUri, subdirName)

  try {
    const stat = await workspace.fs.stat(dest)
    if (!(stat.type & FileType.Directory)) {
      throw new Error(`URI ${dest.toString()} does not point to a directory`)
    }
  } catch (err: any) {
    if (err.code !== 'FileNotFound') {
      throw err
    }
    await workspace.fs.createDirectory(dest)
    dirCreated = true
  }

  try {
    await window.withProgress({
      title: `Cloning ${libPicked.descriptor.slug} ${commitPicked?.label}`,
      location: ProgressLocation.Notification,
    }, prog => {
      return gitClone(
        libPicked.descriptor.url,
        dest,
        (commitPicked as RefEntryDesc).oid,
        {
          shallow: true,
          onProgress: prog.report.bind(prog),
        })
    })
  } catch (err: any) {
    window.showErrorMessage('Failed to clone the git repository', {
      modal: true,
      detail: err.message,
    })
    if (dirCreated) {
      await workspace.fs.delete(dest).then(() => {}, () => {})
    }
    throw err
  }

  window.showInformationMessage(`${libPicked.descriptor.slug} ${commitPicked?.label} is installed.`)
}

async function probeInstalledLibraries(root: Uri) {
  const entries = await Promise.resolve(workspace.fs.readDirectory(root)).catch(err => {
    if (err.code === 'FileNotFound') {
      return []
    }
    throw err
  })
  const dirNames = entries
    .filter(([, type]) => type & FileType.Directory)
    .map(([name]) => name)

  const dirsSettled = await Promise.allSettled(dirNames.map<Promise<InstalledLibrary | null>>(async dn => {
    const uri = Uri.joinPath(root, dn)
    const libFiles = await workspace.fs.readDirectory(uri).then(
      names => names.filter(([name, type]) => type & FileType.File && name.endsWith('.agda-lib')))

    try {
      if (libFiles.length == 0) return null
      if (libFiles.length > 1) throw new Error('Multiple .agda-lib files found')

      const [ libFile ] = libFiles[0]
      const uriToLibFile = Uri.joinPath(uri, libFile)

      const content = new TextDecoder().decode(await workspace.fs.readFile(uriToLibFile))
      // we can keep the parsing quick and dirty because we only need to parse known libraries in catelog
      const parsed = content.match(/^\s*name:\s*(\S+)/m)
      const [libName, libVersion] = parseLibName(parsed ? parsed[1] : '(unnamed)')

      return {
        name: libName,
        version: libVersion.join('.'),
        folderUri: uri,
        folderName: dn,
        libFileName: libFile,
      }
    } catch (err: any) {
      err.folderName = dn
      throw err
    }
  }))

  const results = dirsSettled.map<InstalledLibraryDesc | null>(result => {
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
        iconPath: { id: 'folder-library' },
        label: lib.name + (lib.version ? ' \u2022 ' + lib.version : ''),
        // resourceUri as description is too lengthy
        description: lib.folderName + '/' + lib.libFileName,
        resourceUri: Uri.joinPath(lib.folderUri, lib.libFileName),
        data: lib,
        buttons: [
          ...(env.uiKind === UIKind.Desktop ?
            [{ command: 'open-in-explorer', tooltip: 'Open in explorer', iconPath: { id: 'link-external' } }] : []),
        ]
      }
    }
    return null
  }).filter(x => !!x)

  results.sort((a, b) => {
    if ('isInvalid' in a && 'isInvalid' in b) {
      return (a.description ?? '').localeCompare(b.description ?? '')
    }

    // to make TSC happy
    const oneIsInvalid = (+('isInvalid' in a) - +('isInvalid' in b))
    if (oneIsInvalid) return oneIsInvalid
    if ('isInvalid' in a || 'isInvalid' in b) throw 0

    return a.data.name.localeCompare(b.data.name) ||
      (a.data.version ?? '').localeCompare(b.data.version ?? '') ||
      (a.data.folderName).localeCompare(b.data.folderName)
  })

  return results
}

async function _listInstalledLibraries(context: ExtensionContext) {
  const entries = await probeInstalledLibraries(context.globalStorageUri)
  const paths = entries.filter(x => ('data' in x)).map(x => x.data.folderName + '/' + x.data.libFileName)
  // to strip the leading "/"
  const configuredLibs = await listConfiguredLibraries()
    .then(xss => xss.flatMap(xs => xs.paths.map(x => x.slice(1))))
  return {
    // FIXME: hot fix so that submodule paths do not need to start with base
    base: '',
    prefix: context.globalStorageUri,
    paths: [
      ...paths.map(x => '$ALSWASM_GLOBAL_STORE_DIR/' + x),
      ...configuredLibs,
    ],
  }
}

function joinPath(base: string, ...segs: string[]) {
  const uri = Uri.from({ scheme: 'file', path: base })
  return Uri.joinPath(uri, ...segs).path
}

type ConfigMappers<T, U> = {
  global: (paths: T) => U,
  workspace: (paths: T, only: boolean) => U,
  workspaceFolder: (paths: T, wsf: WorkspaceFolder) => U,
}

function aggregateConfigurations<T extends unknown[], U extends unknown[]>(section: string, key: string, mappers: ConfigMappers<T, U>) {
  // NOTE: sorted by the same order as insertion in `libraries` file
  const configsFound = []

  const unscopedConfig = workspace.getConfiguration(section)
  const unscopedConfigSources = unscopedConfig.inspect<T>(key)

  const globalPaths = unscopedConfigSources?.globalValue
  if (globalPaths?.length) {
    configsFound.push({
      source: 'global',
      paths: mappers.global(globalPaths),
    })
  }

  const folders = workspace.workspaceFolders
  // we should have reversed the array, but the result (either 0 or 1 element) is the same; see below
  if (!folders?.length) return configsFound

  const wsPaths = unscopedConfigSources?.workspaceValue

  if (folders.length === 1) {
    if (wsPaths?.length) {
      configsFound.push({
        source: 'workspace',
        paths: mappers.workspace(wsPaths, true),
      })
    }
  } else {  // folders.length > 1
    if (wsPaths?.length) {
      // this path is virtual; it makes sense only if the first component is a workspace folder path
      configsFound.push({
        source: 'workspace',
        paths: mappers.workspace(wsPaths, false),
      })
    }

    for (const wsf of folders) {
      const wsfConfig = workspace.getConfiguration(section, wsf.uri)
      const wsfPaths = wsfConfig.inspect<T>(key)?.workspaceFolderValue
      if (wsfPaths?.length) {
        configsFound.push({
          source: 'workspaceFolder',
          folderName: wsf.name,
          paths: mappers.workspaceFolder(wsfPaths, wsf),
        })
      }
    }
  }

  return configsFound
}

export async function listConfiguredLibraries(): Promise<ConfiguredLibraryEntry[]> {
  const folderNameToUri = new Map((workspace.workspaceFolders ?? []).map(({ name, uri }) => [name, uri]))

  function resolveCanonVFSPath(p: string) {
    const PREFIX_WORKSPACE_SINGULAR = '/workspace/'
    const PREFIX_WORKSPACE_PLURAL = '/workspaces/'

    if (workspace.workspaceFolders?.length === 1) {
      if (p.startsWith(PREFIX_WORKSPACE_SINGULAR)) {
        return {
          workspaceFolder: workspace.workspaceFolders[0].uri,
          path: p.slice(PREFIX_WORKSPACE_SINGULAR.length),
        }
      }
    } else if (p.startsWith(PREFIX_WORKSPACE_PLURAL)) {
      const relPath = p.slice(PREFIX_WORKSPACE_PLURAL.length)
      const pos = relPath.indexOf('/')
      const wsfName = relPath.slice(0, pos)
      const wsfUri = folderNameToUri.get(wsfName)
      if (wsfUri) {
        return {
          workspaceFolder: wsfUri,
          path: relPath.slice(pos + 1),
        }
      }
    }

    return { path: p }
  }

  async function resolveWithWorkspaceFolderMappings(p: string) {
    const resolved = resolveCanonVFSPath(p)
    if (resolved.workspaceFolder?.scheme === 'vscode-vfs' && resolved.workspaceFolder.authority.match(/^github\+?/)) {
      return maybeRewriteGitSubmodulePath(resolved.path, resolved.workspaceFolder)
    }
    return p
  }

  function mapAsync<A, B>(arr: A[], mapper: (a: A) => Promise<B>): Promise<B[]> {
    return Promise.all(arr.map(mapper))
  }

  const CONFIG_SECTION = 'alsWasmLoader'
  const CONFIG_KEY = 'libraryFilePaths'

  const toAbsolutePaths = (ps: string[], base: string) => ps.map(p => p[0] === '/' ? p : joinPath(base, p))
  const mappers: ConfigMappers<string[], string[]> = {
    global: ps => toAbsolutePaths(ps, '/'),
    workspace: (ps, only) => toAbsolutePaths(ps, only ? '/workspace' : '/workspaces'),
    workspaceFolder: (ps, wsf) => toAbsolutePaths(ps, `/workspaces/${wsf.name}`),
  }

  const configs = aggregateConfigurations(CONFIG_SECTION, CONFIG_KEY, mappers) as ConfiguredLibraryEntry[]

  return mapAsync(configs, async ({ paths, ...rest }) => ({
    paths: await mapAsync(paths, resolveWithWorkspaceFolderMappings), ...rest,
  }))
}

export async function showConfiguredLibraries() {
  const resolvedConfigs = await listConfiguredLibraries()

  window.showInformationMessage('Configured libraries', {
    modal: true,
    detail: resolvedConfigs.length == 0 ? '(none)' : resolvedConfigs.map(config => {
      const sourceDisp = (
        config.source === 'workspaceFolder' ? `workspace folder settings "${config.folderName}"` :
        config.source === 'workspace' ? 'workspace settings' :
        'user settings')
      return `From ${sourceDisp}:\n` + config.paths.map(s => `\u2022 ${s}\n`).join('')
    }).join('\n'),
  })
}

async function _manageLibraries(context: ExtensionContext, ..._args: any[]) {
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
        pickAndInstallFromLibraryCatalog(context)
      }
    } else if ('data' in item) {
      await showActionPicker(item)
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

export const listInstalledLibraries = makeCurried(_listInstalledLibraries)
export const manageLibraries = makeCurried(_manageLibraries)
