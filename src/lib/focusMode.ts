const KEY = 'english-reader:focus-mode'

export function loadFocusMode(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function saveFocusMode(value: boolean) {
  try {
    localStorage.setItem(KEY, value ? '1' : '0')
  } catch {
    /* ignore */
  }
}
