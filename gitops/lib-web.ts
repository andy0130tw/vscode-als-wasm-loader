import { commands, env, extensions, UIKind, Uri, window } from 'vscode'
import type { LibAPI, ServerRefInfo, GitCloneOptions } from '$gitops'

type GitSubmoduleClonerAPI = LibAPI & {
  getWorkspaceId(uri: Uri): string
  listSubmodules(uri: Uri): { name: string, path: string, url: string }[]
}

async function ensureExtensionCommon(extensionID: string, extensionName: string = extensionID) {
  const openExtensionPage = () => commands.executeCommand('extension.open', `${extensionID}`)

  do {
    const ext = extensions.getExtension<GitSubmoduleClonerAPI>(extensionID)
    if (ext != null) {
      if (!ext.isActive) {
        await ext.activate()
      }
      const api = ext.exports
      if (api.fetchServerRefInfo == null) {
        const choice = await window.showErrorMessage(
          `Depended extension "${extensionName}" is too old to provide the required API.`, {
            modal: true,
            detail: 'Requires >= 0.0.8. Please upgrade and try again.',
          }, 'Go to marketplace')
        if (choice === 'Go to marketplace') {
          openExtensionPage()
        }
        break
      }
      return api
    }

    // we adopt the pattern for onboarding from antaalt/shader-validator:
    // https://github.com/antaalt/shader-validator/blob/fe795d7371274e113f161fe29bd4cbea4bba61d0/src/extension.ts#L38

    const choice = await window.showInformationMessage(
      'Extension dependency required',
      {
        modal: true,
        detail: `The extension ${extensionName} is required to manage Git repositories in browsers, but it is not installed or is disabled. Install it now?`,
      }, { title: 'Install' }, { title: 'Go to marketplace' }, { title: 'Not now', isCloseAffordance: true })

    if (choice?.title === 'Install') {
      let ok = false
      try {
        await commands.executeCommand('workbench.extensions.installExtension', extensionID, { enable: true })
        window.showInformationMessage(`${extensionName} is installed successfully.`)
        ok = true
      } catch (err) {
        console.error(`Failed to install ${extensionID}: `, err)
        window.showErrorMessage(`Failed to install ${extensionName}. Install it manually and try again.`)
      }
      if (!ok) break

    } else if (choice?.title === 'Go to marketplace') {
      // TODO: support Open VSX
      openExtensionPage()
      const retryChoice = await window.showInformationMessage(
        `After installing ${extensionName}, click here to retry.`,
        'Retry', 'Abort')
      if (retryChoice !== 'Retry') break

    } else {
      window.showErrorMessage('Cannot continue without the missing dependency.')
      break
    }
  } while (true)

  throw new Error(`Failed to get the dependent extension: ${extensionID}`)
}

const ensureExtension = () => ensureExtensionCommon('qbane.vscode-git-submodule-cloner', 'Git Submodule Cloner')

export async function fetchServerRefInfo(url: string): Promise<ServerRefInfo> {
  const gitCloner = await ensureExtension()
  return gitCloner.fetchServerRefInfo(url)
}

export async function gitClone(url: string, dest: Uri, ref?: string, options?: GitCloneOptions): Promise<void> {
  const gitCloner = await ensureExtension()
  return gitCloner.gitClone(url, dest, ref, options)
}

async function maybeRewriteGitSubmodulePath(path: string, wsuri: Uri) {
  if (env.uiKind !== UIKind.Web) {
    // bail out rather than return path silently
    throw new Error('can only rewrite submodule URI on web')
  }
  const gitCloner = await ensureExtension()
  const submodules = gitCloner.listSubmodules(wsuri)

  for (let {name, path: submodPath} of submodules) {
    const prefix = '/workspace/' + submodPath + '/'
    if (path.startsWith(prefix)) {
      return `/submodules/${gitCloner.getWorkspaceId(wsuri)}/${name}/` + path.slice(prefix.length)
    }
  }

  return path
}

;({
  fetchServerRefInfo,
  gitClone,
  maybeRewriteGitSubmodulePath,
} satisfies LibAPI)
