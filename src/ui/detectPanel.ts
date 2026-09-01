/**
 * A small QuickPick panel opened from the status bar item. It provides
 * options to manually run dependency detection for the active editor.
 */
import type { TextEditor } from 'vscode'
import type { QuickPickItem } from 'vscode'
import { window } from 'vscode'
import jsonListener from '../core/listener'
import { getDocumentSession } from '../core/DocumentSession'
import { statusBarItem } from './indicators'

interface DetectActionItem extends QuickPickItem {
  run: (editor: TextEditor) => void
}

export function showDetectPanel() {
  const editor = window.activeTextEditor
  if (!editor) {
    void window.showInformationMessage('DepDetect: open a dependency file first (package.json, requirements.txt, pyproject.toml, go.mod or pom.xml).')
    return
  }

  const items: DetectActionItem[] = [
    {
      label: '$(sync) Re-run detection',
      description: 'Fetch all dependencies again (bypasses cache)',
      detail: 'Forces a fresh registry request for every dependency in the active file.',
      run: (target) => void jsonListener(target, { forceFresh: true }),
    },
    {
      label: '$(cloud-download) Detect missing / failed only',
      description: 'Retry dependencies that were not fetched successfully',
      detail: 'Re-requests metadata only for dependencies without a result or with errors.',
      run: (target) => void jsonListener(target, { incremental: true }),
    },
    {
      label: '$(paintcan) Re-render decorations only',
      description: 'Re-decorate the active file using cached results',
      detail: 'No network requests are made.',
      run: (target) => void jsonListener(target, { fetch: false }),
    },
  ]

  const summary = getDocumentSession(editor.document)?.summary
  const placeholder = summary
    ? `Current file: ${summary.fetched}/${summary.total} fetched, ${summary.failed} failed — pick an action to run manually`
    : 'Pick a detection action to run manually'

  void window
    .showQuickPick(items, {
      title: '🎈 DepDetect — Manual Detection',
      placeHolder: placeholder,
      matchOnDescription: true,
      matchOnDetail: true,
    })
    .then(picked => picked?.run(editor))
}

export function registerStatusBarCommand() {
  statusBarItem.command = 'depdetect.detectPanel'
  statusBarItem.tooltip = 'DepDetect: click to run detection manually'
}
