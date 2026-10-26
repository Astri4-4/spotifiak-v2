// localStorage can throw (private mode, blocked storage); preferences are optional.
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`spotifiak:${key}`)
    } catch {
      return null
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(`spotifiak:${key}`, value)
    } catch {
      // ignore
    }
  },
}
