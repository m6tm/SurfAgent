/**
 * Petits helpers types autour de chrome.storage.local.
 * Tolerent l'absence de l'API chrome (tests Node) en renvoyant null.
 */
export async function chromeStorageGet(key: string): Promise<unknown> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null
  const items = (await chrome.storage.local.get(key)) as Record<string, unknown>
  return items[key] ?? null
}

export async function chromeStorageSet(key: string, value: unknown): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  await chrome.storage.local.set({ [key]: value })
}
