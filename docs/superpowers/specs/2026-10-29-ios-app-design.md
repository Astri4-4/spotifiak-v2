# Spotifiak iOS app — design

Date: 2026-10-29
Status: approved in brainstorming, awaiting spec review

## Goal

A native iOS client for a self-hosted Spotifiak server, doing what the web app (even
installed as a PWA) cannot do well:

- **Background audio** with lock screen / Control Center / AirPods controls.
- **Offline downloads** of tracks, albums, playlists and podcast episodes.
- **Native look and feel** (Apple Music–like navigation, gestures, haptics).
- **Distribution to others** through TestFlight and the App Store.

### What the user said

- All four goals above matter.
- They have a Mac with Xcode, an iPhone, and a paid Apple Developer account.
- v1 scope: core music, podcasts, Jam. Admin and import stay web-only.
- The server address is entered at login (any Spotifiak instance), not hard-coded.
- Native SwiftUI over React Native.
- Unplayable formats (ogg/opus/webm) are transcoded by the backend.

### Assumptions

- iOS 17+ is an acceptable minimum (needed for `@Observable` and SwiftData).
- The UI is in French, like the web app and the backend's error messages.
- Development happens on Linux; the code is compiled and tested by a macOS CI runner,
  and by the user in Xcode for device testing and release.

### Success criteria

- Logging in to any Spotifiak server, browsing, and playing music and podcasts, with
  playback continuing while locked and controllable from the lock screen and AirPods.
- Every track in the library plays, whatever its file format.
- A downloaded playlist plays in airplane mode.
- An iOS device and a browser in the same Jam hear the same thing, within 2 seconds.
- The app passes TestFlight processing.

## Out of scope (v1)

- Admin screens: users, library scan, duplicates.
- Spotify import and Deezer downloads.
- Universal links for Jam invites (each instance would need its own
  `apple-app-site-association`); invites are pasted or scanned instead.
- Offline edits other than podcast progress (likes and playlist edits are disabled
  while offline; no sync queue).
- CarPlay, widgets, Siri, Apple Watch.
- Automated TestFlight uploads (fastlane).

## Architecture

### Repository layout

A new `ios/` directory at the repo root, next to `backend/` and `frontend/`:

```
ios/
  project.yml              XcodeGen spec (the .xcodeproj is generated, not committed)
  Spotifiak/
    App/                   App entry, root view, environment wiring
    API/                   APIClient + models
    Session/               Server URL, login state
    Player/                PlayerEngine, queue logic, now playing / remote commands
    Downloads/             Download manager, SwiftData index, offline catalog
    Jam/                   SSE client, Jam state, player sync
    Features/              SwiftUI screens
    Support/               Image cache, formatting, small shared views
    Resources/             Assets, Info.plist values
  SpotifiakTests/          Swift Testing unit tests + JSON fixtures
```

### Stack

Swift 6 with strict concurrency, SwiftUI, Observation (`@Observable`), SwiftData,
AVFoundation, MediaPlayer, Network. **No third-party dependencies.** XcodeGen is a
build-time tool only.

### Units

| Unit | Responsibility | Depends on |
|---|---|---|
| `API` | `APIClient`: async/await requests against the current server URL, JSON decoding into models mirroring `frontend/src/api.ts`, `{ error }` messages surfaced as `APIError(message, status)`. URL builders for streams and covers. | — |
| `Session` | Server URL (persisted in `UserDefaults`), current user, login / register / logout, `/auth/status`. The session cookie lives in `HTTPCookieStorage.shared`. Any 401 clears the session and returns to login with the server address prefilled. | API |
| `Player` | `PlayerEngine` wrapping `AVQueuePlayer`; `QueueModel`, a pure value type holding the queue logic; audio session; now playing info; remote commands; podcast progress reporting; restoring the last queue at launch. | API, Downloads |
| `Downloads` | `DownloadManager` (background `URLSession`), SwiftData index of downloaded tracks and pinned collections, sync of pinned collections, storage accounting, offline catalog for browsing. | API |
| `Jam` | `JamClient` (SSE over `URLSession.bytes`), commands, mapping Jam state onto `PlayerEngine`. | API, Player |
| `Features` | Screens (below). | all of the above |

Each unit exposes a small `@Observable` object injected through the SwiftUI
environment; screens never call `URLSession` directly.

### Navigation and screens

A `TabView` with **Accueil / Rechercher / Bibliothèque**, each tab with its own
`NavigationStack`. A mini player sits above the tab bar; tapping it opens the
full-screen player as a sheet (cover, scrubber, controls, shuffle/repeat, like,
queue, Jam, add to playlist).

- **Login**: server address, username, password; registration when `/auth/status`
  says sign-up is open (first-user setup included).
- **Accueil**: the same shelves as `HomePage.tsx`.
- **Rechercher**: `/search` results (tracks, albums, artists), and a podcasts
  section backed by `/podcasts/search`.
- **Bibliothèque**: liked tracks, playlists (own and public), saved albums, followed
  artists, podcasts; a "Téléchargés" filter.
- **Album, Artist, Playlist, Podcast** detail pages, mirroring the web pages.
- **Playlist editing**: create, rename, make public, delete, add and remove tracks,
  reorder by drag.
- **File d'attente**: the queue, reorderable, with the "added" section before the
  context.
- **Jam**: participants, queue with who added each track, invite link + QR code,
  join by pasting or scanning a link, leave/end, host can remove a participant.
- **Compte**: display name, password, server, downloads settings, logout.
- Track context menu (long press): play next, add to queue, add to playlist,
  like, go to album/artist, download.

## API usage

The app uses the existing routes, unchanged except for the two backend changes below:
`/auth/*`, `/me`, `/me/password`, `/tracks`, `/albums`, `/artists`, `/search`,
`/me/likes*`, `/me/albums*`, `/me/artists*`, `/playlists*`, `/podcasts*`,
`/me/podcasts*`, `/me/episodes/:id/progress`, `/episodes/:id/audio`, `/jam*`,
`/tracks/:id/stream`, `/tracks/:id/cover`.

Authentication: the backend's `spotifiak_session` cookie (`httpOnly`, `SameSite=lax`)
is stored and sent by `URLSession` like any cookie. CORS does not apply to native
requests. No auth change is needed.

## Backend changes

1. **Transcoding.** Add `ffmpeg` to `backend/Dockerfile`. `GET /tracks/:id/stream` and
   `GET /episodes/:id/audio` accept `?compat=1`:
   - mp3, m4a, aac and flac files are served as they are;
   - otherwise ffmpeg converts the file once to AAC 256 kbps in an m4a container at
     `TRANSCODE_DIR/<id>.m4a` (new config value, defaulting next to the podcast
     directory). It writes to `<id>.m4a.part` and renames when done, so a partial
     file is never served. Simultaneous requests for the same id share one
     conversion through an in-memory map of in-flight promises;
   - the result is served through the existing `streamFile`, Range included;
   - `/episodes/:id/audio` only serves episodes created from YouTube (local files).
     RSS episodes play from their external `audioUrl`, which is not transcoded;
   - cached files are removed when their source goes away: tracks gone after a
     library scan, deleted episodes.
2. **`format` on tracks and episodes.** API responses gain `format`, the lowercase
   file extension without the dot (`"flac"`, `"ogg"`). The app asks for `compat=1`
   only when the format is not mp3, m4a, aac or flac, and shows a quality badge.

## Player

- Behaviour matches `frontend/src/player/PlayerProvider.tsx`: tracks added to the
  queue play before the rest of the launched context; shuffle; repeat
  (off / all / one); "previous" restarts the track unless it is in its first 3
  seconds; the queue can be reordered.
- `QueueModel` is a pure value type (no AVFoundation) holding all of that logic, so
  it can be unit tested. `PlayerEngine` keeps `AVQueuePlayer` one item ahead of
  `QueueModel` for gapless playback.
- `AVAudioSession` category `.playback`. Interruptions (calls, Siri) pause playback
  and resume when the system says `shouldResume`. A route change where the old
  device was headphones pauses playback.
- `MPNowPlayingInfoCenter`: title, artist, album, artwork, duration, elapsed time,
  rate. `MPRemoteCommandCenter`: play, pause, toggle, next, previous, change
  position; skip ±15 s instead of next/previous while a podcast episode plays.
- Source choice: local file if downloaded; otherwise the stream URL (with
  `compat=1` when needed).
- Podcasts: start at `startAt`; `PUT /me/episodes/:id/progress` every 15 s while
  playing, on pause and at the end. When offline, progress goes into a local
  pending table and is sent when the network returns (latest value per episode
  wins).
- The queue, current index and position are saved on change (throttled) and
  restored, paused, at launch.

## Offline

- **Downloadable units**: a track, an album, a playlist, a podcast episode.
  Downloading an album or playlist **pins** it. A sync, run at launch and when
  the network comes back, downloads tracks added to a pinned playlist since then
  and removes tracks no longer referenced by any pin or individual download.
- **Storage**: audio in `Application Support/Downloads/<trackId>.<ext>`, covers in
  `Application Support/Covers/`, both excluded from iCloud backup. Files are
  downloaded with `compat=1` when needed, so stored files always play.
- **SwiftData index**:
  - `DownloadedItem`: id, kind (track/episode), file name, byte size, decoded
    metadata snapshot (JSON of the API model), state (queued, downloading,
    done, failed).
  - `PinnedCollection`: id, kind (album/playlist/podcast), metadata snapshot,
    ordered item ids.
  - `PendingProgress`: episode id, position, updated at.
- **Transfers**: a background `URLSessionConfiguration` so downloads continue with
  the app suspended. The session cookie is copied into each request's `Cookie`
  header. At most 3 transfers at once; failed transfers retry 3 times with backoff,
  then show as failed with a retry button. Cellular downloads are off by default
  (`allowsCellularAccess` follows the setting).
- **Offline detection**: `NWPathMonitor`, plus "server unreachable" when requests
  fail with a connection error. While offline:
  - Bibliothèque shows only downloaded and pinned content, built from the index;
  - Accueil and Rechercher show an "Hors ligne" banner;
  - content that is not downloaded is greyed out and cannot be played;
  - like and playlist editing controls are disabled.
- **Settings** (Compte): download over cellular (default off), total storage used,
  storage per pinned collection, remove a download, remove all downloads.

## Jam

Everyone in a Jam listens on their own device; the server holds the state and pushes
it over Server-Sent Events (see `backend/src/jam.ts`).

- **Start**: from a track, album or playlist menu → `POST /jam`. **Join**: paste an
  invite link or scan its QR code; the Jam id is taken from the URL path →
  `POST /jam/:id/join`. At launch and on return to the foreground, `/jam/current`
  restores the Jam the account is in.
- **Events**: `JamClient` reads `/jam/:id/events` with `URLSession.bytes(for:)`,
  parses SSE frames (`event:`, `data:`, comment heartbeats) and handles `state` and
  `end` (`{ reason: "ended" | "removed" }`).
- **Sync**: each `state` sets the current track, then the target position
  `position + (now − receivedAt)` when playing, then play/pause. Seek only if the
  local position differs from the target by more than 2 seconds.
- **Commands**: every user action (play, pause, seek, next, prev, jump, add,
  playTracks, remove, move, and `ended` when a track finishes) is sent as
  `POST /jam/:id/commands`. Local state changes only when the server's echo
  arrives, as in the web app.
- **Background**: while audio plays the app stays alive and the stream stays
  connected. If paused in the background the app is suspended. Returning to the
  foreground reconnects and resyncs through `/jam/current`.
- **Reconnect**: on stream errors, retry after 1, 2, 5, then every 10 seconds. If
  `/jam/current` returns nothing, leave Jam mode and show "La Jam est terminée".
- Downloaded tracks play from the local file inside a Jam too.

## Error handling

- **401** anywhere: clear the session and the cookie, return to Login with the server
  address prefilled.
- **Server unreachable / no network**: offline mode (above) plus a "Serveur
  injoignable — Réessayer" banner.
- **Other API errors**: the backend's `error` message (already French and
  user-facing) in a toast; generic "Une erreur est survenue" when there is none.
- **Track that fails to play** (404, decode error): toast, skip to the next. Stop
  after 3 consecutive failures.
- **Download failures**: retried as above, then shown per item with a retry action.

## Testing

- **Unit tests** (Swift Testing, `SpotifiakTests`):
  - API model decoding from JSON fixtures captured from a real server;
  - `QueueModel`: added-before-context order, shuffle keeps the current track,
    repeat modes, the 3-second "previous" rule, moving and removing entries;
  - SSE parser: multi-line data, comments, partial chunks;
  - Jam sync: target position and the 2-second drift threshold;
  - download index: pinning, syncing a changed playlist, removing orphaned files.
- **CI**: `.github/workflows/ios.yml` on a `macos` runner, for changes under `ios/`:
  install XcodeGen, generate the project, build, run the tests on an iOS simulator.
  This is also how changes are verified from the Linux development machine.
- **Backend**: a test for `?compat=1`: an ogg file comes back as m4a, Range
  requests work, a second request reuses the cache, and concurrent requests start
  one conversion.
- **Manual checklist on a device** (`ios/TESTING.md`): locked-screen playback,
  lock screen and AirPods controls, phone call interruption, headphones unplug,
  downloads with the app closed, airplane mode, Jam with a browser on the other side.

## Delivery milestones

Each milestone is usable on its own and committed separately.

1. **Foundation**: XcodeGen project, iOS CI, login with server address, Accueil,
   Rechercher, Album and Artist pages, player with background audio and lock screen
   controls. Backend: transcoding and `format`.
2. **Library**: likes, playlists (create, edit, reorder, public), saved albums,
   followed artists, queue screen.
3. **Podcasts**: subscriptions, episodes, resume, search, creating podcasts from
   YouTube videos and playlists.
4. **Offline**: downloads, pinning, offline mode, download settings.
5. **Jam**.
6. **Release**: app icon, signing, privacy manifest, `ios/RELEASE.md` explaining
   archiving and uploading to TestFlight from Xcode.
