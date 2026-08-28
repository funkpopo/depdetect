import type { DecorationOptions, ExtensionContext, TextEditor, TextEditorDecorationType } from 'vscode'
import { workspace } from 'vscode'
import type Dependency from '../core/Dependency'
import decoration, { createDecorationType } from './decoration'
import { statusBarItem } from './indicators'

let decorationHandle: TextEditorDecorationType | undefined

export function initializeDecoration(context: ExtensionContext) {
  if (!decorationHandle) {
    decorationHandle = createDecorationType()
    context.subscriptions.push(decorationHandle)
  }
}

function getDecorationHandle() {
  if (!decorationHandle)
    throw new Error('DepDetect decorations have not been initialized')
  return decorationHandle
}

export function clearDocumentDecorations(editor: TextEditor) {
  editor.setDecorations(getDecorationHandle(), [])
}

export default function decorate(editor: TextEditor, dependencies: Dependency[]): void {
  const pref = loadPref(editor)

  const errors: string[] = []
  const filtered = dependencies.filter(dep => {
    // Dependencies still being fetched have neither versions, an error nor
    // info text. Skip them instead of flagging them as failed so results can
    // be rendered progressively while the remaining requests are in flight.
    if (dep && dep.versions === undefined && dep.error === undefined && !dep.info)
      return false
    if (dep && !dep.error && (dep.versions && dep.versions.length))
      return dep
    else if (!dep.error)
      dep.error = `${dep.item.key}: ` + 'No versions found'
    errors.push(`${dep.error}`)
    return dep
  })
  const options: DecorationOptions[] = []
  // Decorations are inserted after their own line. Reserve one common column
  // for their marker so short and long requirement names do not make the
  // check/cross icons visually zig-zag. Computed over all dependencies (not
  // only the settled ones) so the column stays stable while results stream in.
  const markerColumn = Math.max(
    32,
    ...dependencies.map(dependency => {
      const position = editor.document.positionAt(dependency.item.end)
      return editor.document.lineAt(position.line).text.length + 3
    }),
  )

  for (let i = filtered.length - 1; i > -1; i--) {
    const dependency = filtered[i]
    try {
      const decor = decoration(
        editor,
        dependency.item,
        dependency.versions || [],
        pref.compatibleDecorator,
        pref.incompatibleDecorator,
        pref.errorDecorator,
        dependency.error,
        dependency.info,
        markerColumn,
      )

      if (decor)
        options.push(decor)
    }
    catch (e) {
      console.error(e)
      errors.push(`Failed to build build decorator (${dependency.item.value})`)
    }
  }

  // VS Code replaces the decorations associated with this type on each call.
  // Reusing one type avoids removing and recreating the UI resource on every
  // document refresh, which can otherwise make markers flicker while typing.
  editor.setDecorations(getDecorationHandle(), options)

  // if (errors.length)
  //   statusBarItem.setText('❗️ Completed with errors')
  // else
  statusBarItem.setText('OK')
}

function loadPref(editor: TextEditor) {
  const config = workspace.getConfiguration('', editor.document.uri)
  const compatibleDecorator = config.get<string>('depdetect.compatibleDecorator') ?? ''
  const incompatibleDecorator = config.get<string>('depdetect.incompatibleDecorator') ?? ''
  const errorText = config.get<string>('depdetect.errorDecorator')
  const errorDecorator = errorText ? `${errorText}` : ''
  return {
    compatibleDecorator,
    incompatibleDecorator,
    errorDecorator,
  }
}
