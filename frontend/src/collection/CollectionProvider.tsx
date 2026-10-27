import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { collection, type Album, type Artist, type FollowedArtist, type PlaylistSummary, type SavedAlbum } from '../api'
import { CollectionContext, type CollectionState } from './context'

const TOAST_MS = 3000

export function CollectionProvider({ children }: { children: ReactNode }) {
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set())
  const [likesVersion, setLikesVersion] = useState(0)
  const [savedAlbums, setSavedAlbums] = useState<SavedAlbum[]>([])
  const [followedArtists, setFollowedArtists] = useState<FollowedArtist[]>([])
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([])
  const [playlistsVersion, setPlaylistsVersion] = useState(0)
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    collection
      .likedIds()
      .then((ids) => setLikedIds(new Set(ids)))
      .catch(() => {})
  }, [likesVersion])

  useEffect(() => {
    collection.playlists().then(setPlaylists).catch(() => {})
  }, [playlistsVersion])

  useEffect(() => {
    collection.savedAlbums().then(setSavedAlbums).catch(() => {})
    collection.followedArtists().then(setFollowedArtists).catch(() => {})
  }, [])

  const notify = useCallback((message: string) => {
    clearTimeout(toastTimer.current)
    setToast({ id: Date.now(), message })
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])

  const refreshPlaylists = useCallback(() => setPlaylistsVersion((v) => v + 1), [])
  const refreshLikes = useCallback(() => setLikesVersion((v) => v + 1), [])

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

  // Optimistic like toggleLike: the list (and the button) change at once, then revert on error.
  const toggleSaveAlbum = useCallback(
    (album: Album) => {
      const saved = savedAlbums.some((a) => a.id === album.id)
      const before = savedAlbums
      setSavedAlbums(saved ? before.filter((a) => a.id !== album.id) : [{ ...album, savedAt: new Date().toISOString() }, ...before])
      notify(saved ? 'Retiré de la Bibliothèque' : 'Ajouté à la Bibliothèque')
      ;(saved ? collection.unsaveAlbum(album.id) : collection.saveAlbum(album.id)).catch(() => {
        setSavedAlbums(before)
        notify('Impossible de modifier votre Bibliothèque')
      })
    },
    [savedAlbums, notify],
  )

  const toggleFollowArtist = useCallback(
    (artist: Artist) => {
      const followed = followedArtists.some((a) => a.id === artist.id)
      const before = followedArtists
      setFollowedArtists(
        followed ? before.filter((a) => a.id !== artist.id) : [{ ...artist, followedAt: new Date().toISOString() }, ...before],
      )
      notify(followed ? `Vous n'êtes plus abonné à ${artist.name}` : `Abonné à ${artist.name}`)
      ;(followed ? collection.unfollowArtist(artist.id) : collection.followArtist(artist.id)).catch(() => {
        setFollowedArtists(before)
        notify('Impossible de modifier votre Bibliothèque')
      })
    },
    [followedArtists, notify],
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
    () => ({
      likedIds,
      likesVersion,
      toggleLike,
      refreshLikes,
      savedAlbums,
      followedArtists,
      toggleSaveAlbum,
      toggleFollowArtist,
      playlists,
      refreshPlaylists,
      createPlaylist,
      addToPlaylist,
      notify,
    }),
    [likedIds, likesVersion, toggleLike, refreshLikes, savedAlbums, followedArtists, toggleSaveAlbum, toggleFollowArtist, playlists, refreshPlaylists, createPlaylist, addToPlaylist, notify],
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
