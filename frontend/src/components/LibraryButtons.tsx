import type { Album, Artist } from '../api'
import { useCollection } from '../collection/context'
import { HeartFilledIcon, HeartIcon } from '../icons'

/** Heart in the album action bar: adds the album to the library. */
export function SaveAlbumButton({ album }: { album: Album }) {
  const { savedAlbums, toggleSaveAlbum } = useCollection()
  const saved = savedAlbums.some((a) => a.id === album.id)
  const label = saved ? 'Retirer de la Bibliothèque' : 'Ajouter à la Bibliothèque'
  return (
    <button
      className={`heart-button action-save${saved ? ' liked' : ''}`}
      onClick={() => toggleSaveAlbum(album)}
      aria-label={label}
      aria-pressed={saved}
      title={label}
    >
      {saved ? <HeartFilledIcon size={32} /> : <HeartIcon size={32} />}
    </button>
  )
}

/** "S'abonner" / "Abonné" on artist pages: adds the artist to the library. */
export function FollowButton({ artist }: { artist: Artist }) {
  const { followedArtists, toggleFollowArtist } = useCollection()
  const followed = followedArtists.some((a) => a.id === artist.id)
  return (
    <button className="follow-button" onClick={() => toggleFollowArtist(artist)} aria-pressed={followed}>
      {followed ? 'Abonné' : "S'abonner"}
    </button>
  )
}
