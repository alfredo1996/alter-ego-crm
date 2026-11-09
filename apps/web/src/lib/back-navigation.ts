const KEY = "alter-ego:opened-from-app"

/** Marks that the next page was opened from inside the app, so its Back can use the browser history. */
export function rememberOpenedFromApp(): void {
  try {
    sessionStorage.setItem(KEY, "1")
  } catch {
    // Storage blocked: Back uses its link.
  }
}

/** True when the last page was opened from inside the app and the history has an entry to return to. */
export function canGoBackInApp(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1" && window.history.length > 1
  } catch {
    return false
  }
}

export function forgetOpenedFromApp(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // Nothing to forget.
  }
}
