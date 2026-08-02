export interface ShortcutKeyInput {
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export function getAccelerator(input: ShortcutKeyInput): string | null {
  const key = getAcceleratorKey(input.code)
  if (!key) return null

  const modifiers: string[] = []
  if (input.ctrlKey || input.metaKey) modifiers.push('CommandOrControl')
  if (input.altKey) modifiers.push('Alt')
  if (input.shiftKey) modifiers.push('Shift')

  if (modifiers.length === 0 && !/^F(?:[1-9]|1\d|2[0-4])$/.test(key)) {
    return null
  }

  return [...modifiers, key].join('+')
}

export function formatAccelerator(accelerator: string): string {
  return accelerator
    .replace('CommandOrControl', 'Ctrl')
    .replaceAll('+', ' · ')
    .replace('Right', '→')
    .replace('Left', '←')
}

function getAcceleratorKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(code)) return code

  const namedKeys: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown'
  }

  return namedKeys[code] ?? null
}
