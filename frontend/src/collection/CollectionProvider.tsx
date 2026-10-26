import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { collection, type PlaylistSummary } from '../api'
import { CollectionContext, type CollectionState } from './context'

const TOAST_MS = 3000

export function CollectionProvider({ children }: { children: ReactNode }) {
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set())
  const [likesVersion, setLikesVersion] = useState(0)
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([])
  const [playlistsVersion, setPlaylistsVersion] = useState(0)
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    collection
      .likedIds()
      .then((ids) => setLikedIds(new Set(ids)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    collection.playlists().then(setPlaylists).catch(() => {})
  }, [playlistsVersion])

  const notify = useCallback((message: string) => {
    clearTimeout(toastTimer.current)
    setToast({ id: Date.now(), message })
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])

  const refreshPlaylists = useCallback(() => setPlaylistsVersion((v) => v + 1), [])

  const toggleLike = useCallback(
    (trackId: string) => {
      const liked = likedIds.has(trackId)
      const apply = (add: boolean) =>
        setLikedIds((prev) => {
          const next = new Set(prev)
          if (add) next.add(trackId)
          else next.delete(trackId)
          return next
        })

      // Optimistic: the heart reacts immediately, and reverts if the API fails.
      apply(!liked)
      notify(liked ? 'Retiré des Titres likés' : 'Ajouté aux Titres likés')
      ;(liked ? collection.unlike(trackId) : collection.like(trackId))
        .then(() => setLikesVersion((v) => v + 1))
        .catch(() => {
          apply(liked)
          notify("Impossible de modifier vos Titres likés")
        })
    },
    [likedIds, notify],
  )

  const createPlaylist = useCallback(
    async (trackIds?: string[]) => {
      const { id, name } = await collection.createPlaylist()
      if (trackIds?.length) await collection.addToPlaylist(id, trackIds)
      refreshPlaylists()
      notify(`Playlist « ${name} » créée`)
      return id
    },
    [notify, refreshPlaylists],
  )

  const addToPlaylist = useCallback(
    async (playlist: PlaylistSummary, trackIds: string[]) => {
      try {
        await collection.addToPlaylist(playlist.id, trackIds)
        notify(`Ajouté à « ${playlist.name} »`)
        refreshPlaylists()
      } catch (err) {
        notify((err as Error).message)
      }
    },
    [notify, refreshPlaylists],
  )

  const state: CollectionState = useMemo(
    () => ({ likedIds, likesVersion, toggleLike, playlists, refreshPlaylists, createPlaylist, addToPlaylist, notify }),
    [likedIds, likesVersion, toggleLike, playlists, refreshPlaylists, createPlaylist, addToPlaylist, notify],
  )

  return (
    <CollectionContext.Provider value={state}>
      {children}
      {toast && (
        <div key={toast.id} className="toast" role="status">
          {toast.message}
        </div>
      )}
    </CollectionContext.Provider>
  )
}
