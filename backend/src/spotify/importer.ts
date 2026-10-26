import type { FastifyBaseLogger } from 'fastify'
import { prisma } from '../db.js'
import * as deemix from '../deemix.js'
import { deezer, normalize } from '../enrich.js'
import { scheduleScan } from '../scanner.js'
import { getAll } from './client.js'

// Wait for deemix to fetch the files before rescanning.
const RESCAN_AFTER_QUEUE_MS = 60_000

interface SpotifyTrack {
  type: 'track' | 'episode'
  name: string
  is_local?: boolean
  external_ids?: { isrc?: string }
  artists?: { name: string }[]
  album?: { name: string }
}

interface PlaylistItem {
  added_at: string | null
  item?: SpotifyTrack | null
  /** Deprecated by Spotify in favour of `item`; read as a fallback. */
  track?: SpotifyTrack | null
}

interface SavedTrack {
  added_at: string
  track: SpotifyTrack
}

interface DeezerTrack {
  id: number
  title: string
  link: string
  isrc?: string
  readable?: boolean
  artist: { name: string }
}

const ITEM_FIELDS = 'items(added_at,item(type,name,is_local,external_ids(isrc),artists(name),album(name))),next,total'

type Row = { id: string; position: number; addedAt: Date | null; title: string; artist: string; isrc: string | null }

// --- Matching -----------------------------------------------------------------

/** Library track for a Spotify track: by ISRC, else same title by the same main artist. */
async function findLocal(isrcs: (string | null)[], title: string, artist: string) {
  const codes = isrcs.filter((c): c is string => !!c)
  if (codes.length) {
    const byIsrc = await prisma.track.findFirst({ where: { isrc: { in: codes } }, select: { id: true } })
    if (byIsrc) return byIsrc.id
  }
  const candidates = await prisma.track.findMany({
    where: { artistName: { contains: artist, mode: 'insensitive' } },
    select: { id: true, title: true },
    take: 500,
  })
  const wanted = normalize(title)
  return candidates.find((t) => normalize(t.title) === wanted)?.id ?? null
}

/** Deezer track to download: exact ISRC first, else a search that must match title and artist. */
async function findOnDeezer(
  isrc: string | null,
  title: string,
  artist: string,
  album: string | null,
): Promise<DeezerTrack | null> {
  if (isrc) {
    const track = await deezer<DeezerTrack>(`/track/isrc:${encodeURIComponent(isrc)}`)
    if (track && track.readable !== false) return track
  }
  const wantedTitle = normalize(title)
  const wantedArtist = normalize(artist)
  // The fielded query sometimes returns nothing for tracks Deezer has (e.g. Daft Punk);
  // free text finds them. Either way title and artist must match exactly.
  for (const q of [`artist:"${artist}" track:"${title}"`, `${artist} ${title}`]) {
    const res = await deezer<{ data: (DeezerTrack & { album?: { title: string } })[] }>('/search', { q })
    const matches = (res?.data ?? []).filter(
      (t) => t.readable !== false && normalize(t.title) === wantedTitle && normalize(t.artist.name) === wantedArtist,
    )
    // Same title on several releases: prefer the original album over compilations.
    const best = (album && matches.find((t) => t.album && normalize(t.album.title) === normalize(album))) || matches[0]
    if (best) return best
  }
  return null
}

/** Adds a matched track to the import's target: the playlist (at its Spotify position) or likes. */
async function link(importId: string, row: Row, trackId: string) {
  const imp = await prisma.spotifyImport.findUniqueOrThrow({ where: { id: importId } })
  if (imp.playlistId) {
    // Positions follow the Spotify order, so tracks arriving later land in the right place.
    await prisma.playlistTrack.create({ data: { playlistId: imp.playlistId, trackId, position: row.position + 1 } })
    await prisma.playlist.update({ where: { id: imp.playlistId }, data: { updatedAt: new Date() } })
  } else if (!imp.spotifyPlaylistId) {
    await prisma.like.upsert({
      where: { userId_trackId: { userId: imp.userId, trackId } },
      create: { userId: imp.userId, trackId, likedAt: row.addedAt ?? new Date() },
      update: {},
    })
  }
  // A target playlist deleted by the user: just record the match.
  await prisma.spotifyImportTrack.update({ where: { id: row.id }, data: { status: 'matched', trackId } })
}

// --- Import -------------------------------------------------------------------

async function readSpotifyTracks(userId: string, spotifyPlaylistId: string | null) {
  if (!spotifyPlaylistId) {
    const saved = await getAll<SavedTrack>(userId, '/me/tracks?limit=50')
    return saved.map((s) => ({ addedAt: s.added_at, track: s.track }))
  }
  const items = await getAll<PlaylistItem>(
    userId,
    `/playlists/${encodeURIComponent(spotifyPlaylistId)}/items?limit=50&fields=${encodeURIComponent(ITEM_FIELDS)}`,
  )
  return items.map((i) => ({ addedAt: i.added_at, track: i.item ?? i.track ?? null }))
}

/** Creates the import and processes it in the background. */
export async function startImport(
  log: FastifyBaseLogger,
  userId: string,
  source: { spotifyPlaylistId: string; name: string } | 'liked',
) {
  const liked = source === 'liked'
  const name = liked ? 'Titres likés Spotify' : source.name
  const playlist = liked
    ? null
    : await prisma.playlist.create({
        data: { name, description: 'Importée depuis Spotify', ownerId: userId },
        select: { id: true },
      })
  const imp = await prisma.spotifyImport.create({
    data: { userId, name, spotifyPlaylistId: liked ? null : source.spotifyPlaylistId, playlistId: playlist?.id },
  })
  void processImport(log, imp.id).catch((err) => log.error({ err, importId: imp.id }, 'Spotify import crashed'))
  return imp
}

async function processImport(log: FastifyBaseLogger, importId: string) {
  const imp = await prisma.spotifyImport.findUniqueOrThrow({ where: { id: importId } })
  let queued = 0

  try {
    const items = await readSpotifyTracks(imp.userId, imp.spotifyPlaylistId)
    await prisma.spotifyImportTrack.createMany({
      data: items.map(({ addedAt, track }, position) => {
        const supported = track && track.type === 'track' && !track.is_local
        return {
          importId,
          position,
          addedAt: addedAt ? new Date(addedAt) : null,
          title: track?.name ?? 'Élément indisponible',
          artist: track?.artists?.[0]?.name ?? '',
          album: track?.album?.name ?? null,
          isrc: track?.external_ids?.isrc?.toUpperCase() ?? null,
          // Podcast episodes and local files can't come from Deezer.
          status: supported ? ('pending' as const) : ('not_found' as const),
        }
      }),
    })

    const rows = await prisma.spotifyImportTrack.findMany({
      where: { importId, status: 'pending' },
      orderBy: { position: 'asc' },
    })
    for (const row of rows) {
      const local = await findLocal([row.isrc], row.title, row.artist)
      if (local) {
        await link(importId, row, local)
        continue
      }
      const found = await findOnDeezer(row.isrc, row.title, row.artist, row.album)
      if (!found) {
        await prisma.spotifyImportTrack.update({ where: { id: row.id }, data: { status: 'not_found' } })
        continue
      }
      // If deemix is unreachable, every remaining download would fail: stop the import.
      await deemix.addToQueue(found.link)
      queued++
      await prisma.spotifyImportTrack.update({
        where: { id: row.id },
        data: { status: 'queued', deezerIsrc: found.isrc?.toUpperCase() ?? null },
      })
    }

    await prisma.spotifyImport.update({ where: { id: importId }, data: { status: queued ? 'waiting' : 'done' } })
    log.info({ importId, tracks: items.length, queued }, 'Spotify import processed')
  } catch (err) {
    log.warn({ err, importId }, 'Spotify import failed')
    await prisma.spotifyImport.update({
      where: { id: importId },
      data: { status: 'failed', error: (err as Error).message },
    })
  } finally {
    if (queued) scheduleScan(log, RESCAN_AFTER_QUEUE_MS)
  }
}

/** After each scan: link downloads that arrived and close finished imports. */
export async function resolvePendingImports(log: FastifyBaseLogger) {
  const rows = await prisma.spotifyImportTrack.findMany({ where: { status: 'queued' }, orderBy: { position: 'asc' } })
  let linked = 0
  for (const row of rows) {
    const local = await findLocal([row.isrc, row.deezerIsrc], row.title, row.artist)
    if (local) {
      await link(row.importId, row, local)
      linked++
    }
  }
  const finished = await prisma.spotifyImport.updateMany({
    where: { status: 'waiting', tracks: { none: { status: { in: ['queued', 'pending'] } } } },
    data: { status: 'done' },
  })
  if (linked || finished.count) log.info({ linked, importsFinished: finished.count }, 'Spotify imports updated')
}
