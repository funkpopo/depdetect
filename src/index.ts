import type { ExtensionContext } from 'vscode'
import Commands from './commands/commands'
import { registerAutoCompletion } from './providers/autoCompletion'
import { registerListener } from './core/listener'
import { saveCache } from './api'
import { initializeDecoration } from './ui/decorator'
import { registerStatusBarCommand } from './ui/detectPanel'

export function activate(context: ExtensionContext) {
  initializeDecoration(context)
  registerStatusBarCommand()
  registerListener(context)
  registerAutoCompletion(context)
  context.subscriptions.push(
    Commands.replaceVersion,
    Commands.reload,
    Commands.detectPanel,
  )
}

export function deactivate() {
  saveCache()
}
