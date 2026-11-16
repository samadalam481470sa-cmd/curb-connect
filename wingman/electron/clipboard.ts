export interface PreparedClipboard {
  text: string
  truncated: boolean
  /** Length after trimming, so the caller can tell how much was left out. */
  originalLength: number
}

/** Generous for a pasted problem statement; stops a copied log file from being uploaded whole. */
export const CLIPBOARD_TEXT_LIMIT = 20000

export function prepareClipboardText(raw: string, limit = CLIPBOARD_TEXT_LIMIT): PreparedClipboard {
  const text = raw.replace(/\r\n/g, '\n').trim()
  const truncated = text.length > limit

  return {
    text: truncated ? text.slice(0, limit) : text,
    truncated,
    originalLength: text.length,
  }
}
