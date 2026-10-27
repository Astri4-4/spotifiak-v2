import { useCallback } from 'react'
import { podcasts, type Episode, type EpisodeProgress, type Track } from './api'
import { useCollection } from './collection/context'
import { usePlayer } from './player/context'

// Within this many seconds of the end an episode counts as heard (outros, ads).
const COMPLETED_FROM_END_SEC = 30

// Positions saved during this visit: lists fetched earlier would otherwise resume
// an episode from where it was when the page loaded.
const saved = new Map<string, EpisodeProgress>()

export function progressOf(episode: Episode) {
  return saved.get(episode.id) ?? episode.progress
}

export function saveProgress(episodeId: string, positionSec: number, durationSec: number) {
  const progress = {
    positionSec: Math.floor(positionSec),
    completed: durationSec > 0 && durationSec - positionSec < COMPLETED_FROM_END_SEC,
  }
  saved.set(episodeId, progress)
  return podcasts.saveProgress(episodeId, progress).catch(() => {})
}

export function markPlayed(episode: Episode, completed: boolean) {
  const progress = { positionSec: 0, completed }
  saved.set(episode.id, progress)
  return podcasts.saveProgress(episode.id, progress)
}

/** The player plays tracks; an episode becomes one, streamed from the publisher. */
export function episodeTrack(episode: Episode): Track {
  const progress = progressOf(episode)
  return {
    id: episode.id,
    title: episode.title,
    artistName: episode.podcast.title,
    artistId: '',
    album: null,
    durationSec: episode.durationSec,
    trackNumber: null,
    discNumber: null,
    addedAt: episode.publishedAt,
    episode: {
      podcastId: episode.podcast.id,
      audioUrl: episode.audioUrl ?? podcasts.audioUrl(episode.id),
      startAt: progress && !progress.completed ? progress.positionSec : 0,
    },
  }
}

/** The artist's page, or the podcast's for an episode. */
export const artistLink = (t: Track) => (t.episode ? `/podcast/${t.episode.podcastId}` : `/artist/${t.artistId}`)

/** Plays an episode, or pauses/resumes it when it is the one playing. */
export function usePlayEpisode() {
  const { current, playing, toggle, playTracks, inJam } = usePlayer()
  const { notify } = useCollection()

  const isPlaying = useCallback((episode: Episode) => playing && current?.id === episode.id, [playing, current])

  const play = useCallback(
    (episode: Episode) => {
      if (current?.id === episode.id) return toggle()
      // A Jam's queue is tracks from the library, shared with the others.
      if (inJam) return notify('Les podcasts ne peuvent pas être écoutés pendant une Jam')
      playTracks([episodeTrack(episode)], 0, episode.podcast.id)
    },
    [current, toggle, inJam, notify, playTracks],
  )

  return { isPlaying, play }
}
