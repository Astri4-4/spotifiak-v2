# iOS Milestone 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A SwiftUI app that logs in to any Spotifiak server, browses Accueil / Rechercher / Album / Artiste, and plays music in the background with lock screen controls. Every library file plays, thanks to backend transcoding.

**Architecture:** The backend gains an ffmpeg transcode cache behind `?compat=1` and a `format` field on tracks. The iOS code is split in two. `ios/SpotifiakCore` is a Foundation-only Swift package (models, API client behind an `HTTPTransport` protocol, server address handling, queue logic) that builds and tests on Linux. `ios/Spotifiak` is the XcodeGen-generated app target (SwiftUI, AVFoundation, MediaPlayer), which depends on the package and is built and tested by a macOS GitHub Actions runner.

**Tech Stack:** Backend: Node 24, Fastify 5, Prisma 7, `node:test` via tsx, ffmpeg. iOS: Swift 6 (language mode 6), SwiftUI, Observation, AVFoundation, MediaPlayer, Swift Testing, XcodeGen, iOS 17 deployment target.

**Spec:** `docs/superpowers/specs/2026-10-29-ios-app-design.md`. This plan covers milestone 1 only. Milestones 2–6 get their own plans.

**Deviations from the spec, decided here:**
- Pure logic lives in a separate `ios/SpotifiakCore` package rather than folders in the app target, so it can be tested on Linux.
- The transcode cache defaults to `$TMPDIR/spotifiak-transcode`; compose mounts a volume there. It is pruned by a sweep after each library scan instead of hooks at every deletion site.
- `format` on podcast episodes moves to milestone 3, where episodes are first consumed.

## Global Constraints

- iOS deployment target 17.0; Swift language mode 6 (strict concurrency); `swift-tools-version: 6.0`.
- No third-party Swift dependencies. XcodeGen is a build tool only.
- UI text in French. Backend error messages are shown as they come.
- Compatible formats, never transcoded: `mp3`, `m4a`, `aac`, `flac`.
- Transcode output: AAC 256 kbps in an m4a container, written to `<id>.m4a.part`, then renamed to `<id>.m4a`.
- "Previous" restarts the track when the position is over 3 seconds.
- Added-to-queue tracks play before the rest of the launched context (spec, Player section).
- HTTP servers must work: `NSAppTransportSecurity` → `NSAllowsArbitraryLoads = true`, because self-hosted LAN servers are plain HTTP.
- Session cookie handling stays in `HTTPCookieStorage.shared`; no auth changes on the backend.
- Commit identity: this machine has no git identity. Commit with `git -c user.name="Astri4-4" -c user.email="sacha.guerin@supinfo.com" commit ...` and end messages with the attribution lines from the session.

## Review Focus

1. **Server address typed loosely**: `music.example.com`, `https://music.example.com/`, `192.168.1.10:8080`, `http://host/api`. The web deployment serves the API under `/api`, a bare API does not. The app must find the API without the user knowing which → `candidateAPIBases` tests in Task 4.
2. **Optional fields from real data**: tracks with `album: null`, `durationSec: null`, `trackNumber: null`; albums with `year: null` and `coverUrl: null`; artists with neither picture nor cover track → decoding fixtures in Task 3 include each null.
3. **Source file changed in place** (full scan picks up a re-encoded file, same track id): the cached transcode must not be served stale → mtime test in Task 1.
4. **Corrupt or unreadable file under `compat=1`**: ffmpeg fails. The request must answer an error rather than hang or leave a `.part` behind, and the next request must retry → failure test in Task 1.
5. **Expired session mid-use** (server restarted or session revoked): any 401 outside `/auth/*` must return to Login with the server prefilled, not leave empty screens → `APIClient` 401 test in Task 4.

---

### Task 1: Backend transcode module

**Files:**
- Create: `backend/src/transcode.ts`
- Create: `backend/test/transcode.test.ts`
- Modify: `backend/package.json` (add `"test": "node --import tsx --test test/*.test.ts"`)
- Modify: `backend/src/config.ts` (add `TRANSCODE_DIR`)

**Interfaces:**
- Produces:
  - `COMPATIBLE_EXTENSIONS: ReadonlySet<string>`: `.mp3 .m4a .aac .flac`.
  - `compatFile(source: string, id: string, dir?: string): Promise<string>`. Returns `source` when its extension is compatible. Otherwise returns the path of an up-to-date `<dir>/<id>.m4a`, converting when it is missing or older than `source` (mtime). Concurrent calls for the same id share one conversion. Rejects on ffmpeg failure, removing the `.part`. `dir` defaults to `config.TRANSCODE_DIR`.
  - `pruneTranscodes(keep: Set<string>, dir?: string): Promise<number>`: deletes `<id>.m4a` files whose id is not in `keep` plus any leftover `.part`; returns the count deleted.
  - `conversionCount(): number`: number of ffmpeg runs started since process start (for tests).
- `config.TRANSCODE_DIR: string`, default `path.join(os.tmpdir(), 'spotifiak-transcode')`. `FFMPEG_PATH: string`, default `'ffmpeg'`.

`transcode.ts` must not import `db.ts`. Tests import it with `DATABASE_URL`, `DEEMIX_URL` and `MUSIC_DIR` set to dummy values in the test file before importing (config parses env at import).

- [ ] **Step 1: Write the failing tests** in `backend/test/transcode.test.ts`

Each test gets a fresh temp dir. Fixtures are generated with `ffmpeg -f lavfi -i sine=frequency=440:duration=2` into `.ogg` (libvorbis) and `.mp3`; no binary fixtures in git.

```ts
test('serves compatible files untouched', async () => {
  assert.equal(await compatFile(mp3, 't1', dir), mp3)
  assert.equal(conversionCount(), before)
})
test('converts ogg to AAC m4a once', async () => {
  const out = await compatFile(ogg, 't2', dir)
  assert.equal(out, path.join(dir, 't2.m4a'))
  assert.equal(await probeCodec(out), 'aac')   // ffprobe -show_entries stream=codec_name
  await compatFile(ogg, 't2', dir)
  assert.equal(conversionCount(), before + 1)
})
test('concurrent requests share one conversion', async () => {
  const [a, b] = await Promise.all([compatFile(ogg, 't3', dir), compatFile(ogg, 't3', dir)])
  assert.equal(a, b)
  assert.equal(conversionCount(), before + 1)
})
test('reconverts when the source is newer than the cache', async () => {
  await compatFile(ogg, 't4', dir)
  await utimes(ogg, new Date(), new Date(Date.now() + 60_000))
  await compatFile(ogg, 't4', dir)
  assert.equal(conversionCount(), before + 2)
})
test('rejects on a corrupt file, leaves no .part, retries next time', async () => {
  await writeFile(bad, 'not audio')            // bad = <dir>/bad.ogg
  await assert.rejects(compatFile(bad, 't5', dir))
  assert.deepEqual((await readdir(dir)).filter((f) => f.startsWith('t5')), [])
  await assert.rejects(compatFile(bad, 't5', dir))
  assert.equal(conversionCount(), before + 2)
})
test('prunes unknown ids and leftover parts', async () => {
  // files: keep.m4a, gone.m4a, x.m4a.part
  assert.equal(await pruneTranscodes(new Set(['keep']), dir), 2)
  assert.deepEqual(await readdir(dir), ['keep.m4a'])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test`
Expected: FAIL, cannot find module `../src/transcode.js`.

- [ ] **Step 3: Implement `backend/src/transcode.ts` and the config entries**

Run `FFMPEG_PATH -v error -y -i <source> -vn -map 0:a:0 -c:a aac -b:a 256k -f mp4 -movflags +faststart <part>` with `spawn`, reject with the last stderr line, then `rename(part, final)`. `mkdir(dir, { recursive: true })` before converting. In-flight map: `Map<string, Promise<string>>`, keyed by id, deleted in `finally`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test && npm run typecheck`
Expected: 6 passing, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/transcode.ts backend/src/config.ts backend/test backend/package.json
git commit -m "Backend: transcode cache for formats iOS can't play"
```

---

### Task 2: Backend wiring (`compat=1`, `format`, pruning, Docker)

**Files:**
- Modify: `backend/src/library.ts` (`trackSelect` gains `path: true`; `toTrack` drops `path` and adds `format`)
- Modify: `backend/src/server.ts:72-78` (`/tracks/:id/stream` reads `compat`)
- Modify: `backend/src/youtube.ts` (`/episodes/:id/audio` reads `compat`)
- Modify: `backend/src/scanner.ts` (after the cleanup phase, `pruneTranscodes` with all track ids and episode ids)
- Modify: `backend/Dockerfile` (install ffmpeg; `mkdir /transcode && chown node:node /transcode`)
- Modify: `compose.yaml` (`TRANSCODE_DIR: /transcode`, volume `transcode:/transcode`)
- Modify: `frontend/src/api.ts` (`Track.format?: string`; optional because episodes mapped to tracks have none)
- Test: `backend/test/library.test.ts`

**Interfaces:**
- Consumes: `compatFile`, `pruneTranscodes` from Task 1.
- Produces: every API `Track` JSON has `format: string`, the lowercase extension without the dot (`"flac"`). `path` is never sent. `GET /tracks/:id/stream?compat=1` and `GET /episodes/:id/audio?compat=1` serve `compatFile(...)` through `streamFile`. Without `compat`, behaviour is unchanged. Conversion failure → `500 { error: 'Conversion audio impossible' }`.

- [ ] **Step 1: Write the failing test** in `backend/test/library.test.ts`

```ts
test('toTrack exposes format and hides path', () => {
  const t = toTrack({ id: 'a', path: 'Artist/Album/01 Song.FLAC', createdAt: new Date(0) })
  assert.equal(t.format, 'flac')
  assert.equal('path' in t, false)
  assert.equal(t.addedAt.getTime(), 0)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL, `format` is undefined.

- [ ] **Step 3: Implement**

`toTrack<T extends { createdAt: Date; path: string }>` returns `{ ...rest, format: path.extname(p).slice(1).toLowerCase(), addedAt }`. Every `toTrack` caller already passes `trackSelect` results; run `grep -rn "toTrack\|trackSelect" backend/src` and fix any caller that builds its own select. Add the `compat` query parse (`z.object({ compat: z.coerce.boolean().optional() })`) to both audio routes.

- [ ] **Step 4: Verify**

Run: `cd backend && npm test && npm run typecheck && cd ../frontend && npm run build`
Expected: all pass. Then, with compose running and an `.ogg` in the music dir:
`curl -s -b cookie.txt -r 0-99 -o /dev/null -w '%{http_code} %{content_type}\n' 'http://localhost:8080/api/tracks/<id>/stream?compat=1'`
Expected: `206 audio/mp4`.

- [ ] **Step 5: Commit**

```bash
git add backend frontend/src/api.ts compose.yaml
git commit -m "Backend: compat=1 streams, track format, ffmpeg in the image"
```

---

### Task 3: SpotifiakCore package and models

**Prerequisite (once, with the user's OK):** install the Swift 6 toolchain on Arch (`swiftly`, from swift.org) so `swift test` runs locally. Without it, Tasks 3–5 are verified by the CI job from Task 6 instead.

**Files:**
- Create: `ios/SpotifiakCore/Package.swift` (library `SpotifiakCore`, test target `SpotifiakCoreTests` with resources `Fixtures/`)
- Create: `ios/SpotifiakCore/Sources/SpotifiakCore/Models.swift`
- Create: `ios/SpotifiakCore/Tests/SpotifiakCoreTests/ModelsTests.swift`
- Create: `ios/SpotifiakCore/Tests/SpotifiakCoreTests/Fixtures/{album-detail,artist-detail,search,albums-page,auth-status}.json`

**Interfaces:**
- Produces (all `Codable, Sendable, Hashable`, `Identifiable` where there is an `id`), mirroring `frontend/src/api.ts` field names:
  - `User { id, username, displayName, role: Role }`, `enum Role: String { admin, user }`
  - `AuthStatus { user: User?, needsSetup: Bool, signupOpen: Bool }`
  - `Track { id, title, artistName, artistId, album: TrackAlbum?, durationSec: Double?, trackNumber: Int?, discNumber: Int?, addedAt: Date, format: String? }`, `TrackAlbum { id, title, coverUrl: URL? }`
  - `Album { id, title, year: Int?, createdAt: Date, coverUrl: URL?, artist: AlbumArtist, coverTrackId: String?, trackCount: Int }`, `AlbumArtist { id, name, pictureUrl: URL? }`
  - `AlbumDetail` = `Album` fields + `tracks: [Track]` (separate struct; no inheritance)
  - `Artist { id, name, pictureUrl: URL?, coverTrackId: String? }`, `ArtistDetail` = Artist fields + `albums: [Album]`, `tracks: [Track]`
  - `SearchResults { tracks: [Track], albums: [Album], artists: [Artist] }`
  - `Page<T> { items: [T] }`
  - `extension JSONDecoder { static let spotifiak: JSONDecoder }`, which decodes ISO 8601 dates with fractional seconds (the API sends `2026-10-26T13:31:58.123Z`).

- [ ] **Step 1: Write fixtures and failing tests**

Fixtures are hand-written to match the backend selects in `backend/src/library.ts`. `album-detail.json` has one complete `flac` track and one with `durationSec: null, trackNumber: null`; `albums-page.json` has an album with `year: null, coverUrl: null, coverTrackId: null`; `search.json` has an artist with `pictureUrl: null`.

```swift
@Test func decodesAlbumDetailWithNullFields() throws {
  let album = try decode(AlbumDetail.self, "album-detail")
  #expect(album.tracks.count == 2)
  #expect(album.tracks[1].durationSec == nil)
  #expect(album.tracks[0].format == "flac")
  #expect(album.tracks[0].addedAt == ISO8601DateFormatter.withFractionalSeconds.date(from: "2026-10-26T13:31:58.123Z"))
}
@Test func decodesAlbumWithoutCoverOrYear() throws {
  let page = try decode(Page<Album>.self, "albums-page")
  #expect(page.items[0].year == nil && page.items[0].coverUrl == nil && page.items[0].coverTrackId == nil)
}
@Test func decodesSearchAndAuthStatus() throws {
  #expect(try decode(SearchResults.self, "search").artists[0].pictureUrl == nil)
  #expect(try decode(AuthStatus.self, "auth-status").user?.role == .admin)
}
@Test func decodesTrackWithoutFormat() throws {   // episode-shaped tracks have none
  let t = try JSONDecoder.spotifiak.decode(Track.self, from: Data(#"{"id":"e","title":"T","artistName":"A","artistId":"a","album":null,"durationSec":null,"trackNumber":null,"discNumber":null,"addedAt":"2026-10-26T13:31:58Z"}"#.utf8))
  #expect(t.format == nil && t.album == nil)
}
```

Note the last fixture date has **no** fractional seconds: the decoder must accept both.

- [ ] **Step 2: Run to verify failure**

Run: `cd ios/SpotifiakCore && swift test`
Expected: compile failure, `AlbumDetail` not found.

- [ ] **Step 3: Implement `Models.swift`**

- [ ] **Step 4: Run to verify pass**

Run: `cd ios/SpotifiakCore && swift test`
Expected: 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add ios/SpotifiakCore
git commit -m "iOS: SpotifiakCore package with API models"
```

---

### Task 4: Server address and API client

**Files:**
- Create: `ios/SpotifiakCore/Sources/SpotifiakCore/ServerAddress.swift`
- Create: `ios/SpotifiakCore/Sources/SpotifiakCore/APIClient.swift`
- Create: `ios/SpotifiakCore/Tests/SpotifiakCoreTests/ServerAddressTests.swift`
- Create: `ios/SpotifiakCore/Tests/SpotifiakCoreTests/APIClientTests.swift`

**Interfaces:**
- Consumes: models from Task 3.
- Produces:
  - `func candidateAPIBases(_ input: String) -> [URL]`: trims whitespace and trailing `/`. With a scheme: `[input + "/api", input]`, but `[input]` alone when the path already ends in `/api`. Without a scheme: the same for `https://`, then for `http://`. Empty or unparsable input → `[]`.
  - `protocol HTTPTransport: Sendable { func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) }`
  - `struct APIError: Error, Equatable { let message: String; let status: Int }`. `message` is the body's `error` field, or `"Une erreur est survenue"`.
  - `final class APIClient: Sendable`, `init(base: URL, transport: HTTPTransport, onUnauthorized: @Sendable () -> Void)`
    - `static func discover(_ input: String, transport: HTTPTransport) async throws -> URL`: first candidate whose `GET <base>/health` returns 200 with `{"ok":true}`. Otherwise throws `APIError(message: "Serveur Spotifiak introuvable à cette adresse", status: 0)`.
    - `authStatus() async throws -> AuthStatus`, `login(username:password:) async throws -> User`, `register(username:password:displayName:) async throws -> User`, `logout() async throws`
    - `albums() async throws -> [Album]` (`/albums?limit=200`), `album(_ id:) -> AlbumDetail`, `artists() -> [Artist]` (`/artists?limit=200`), `artist(_ id:) -> ArtistDetail`, `search(_ q:) -> SearchResults`
    - `streamURL(for track: Track) -> URL`: `/tracks/:id/stream`, with `?compat=1` when `track.format` is non-nil and not in `["mp3","m4a","aac","flac"]`
    - `coverURL(track:) -> URL?`, `coverURL(album:) -> URL?`, `pictureURL(artist:) -> URL?`: the external `coverUrl`/`pictureUrl` first, else `/tracks/:coverTrackId/cover`, else nil (same rule as `images` in `frontend/src/api.ts`)
  - A 401 on any path not starting with `/auth/` calls `onUnauthorized` and then throws.

- [ ] **Step 1: Write failing tests**

```swift
@Test(arguments: [
  ("music.example.com", ["https://music.example.com/api", "https://music.example.com", "http://music.example.com/api", "http://music.example.com"]),
  ("https://music.example.com/", ["https://music.example.com/api", "https://music.example.com"]),
  ("192.168.1.10:8080", ["https://192.168.1.10:8080/api", "https://192.168.1.10:8080", "http://192.168.1.10:8080/api", "http://192.168.1.10:8080"]),
  ("http://host/api/", ["http://host/api"]),
  ("  ", []),
])
func candidates(input: String, expected: [String]) {
  #expect(candidateAPIBases(input).map(\.absoluteString) == expected)
}
```

`APIClientTests` uses a `FakeTransport` (an actor holding canned `(status, body)` per URL path and recording requests):
- `discover` picks `https://h/api` when only `https://h/api/health` answers `{"ok":true}`, and skips a candidate answering 200 with HTML.
- `login` posts JSON `{"username","password"}` with `content-type: application/json` and returns the user.
- A 429 with `{"error":"Trop de tentatives, réessayez dans quelques minutes"}` throws `APIError` with that message and status 429.
- A 401 on `/albums` calls `onUnauthorized` once; a 401 on `/auth/login` does not.
- `streamURL` adds `compat=1` for `format: "ogg"`, not for `"flac"` or `nil`.
- `coverURL(album:)` prefers `coverUrl`, falls back to `/tracks/<coverTrackId>/cover`, and is nil without either.

- [ ] **Step 2: Run to verify failure**

Run: `cd ios/SpotifiakCore && swift test`
Expected: compile failure, `candidateAPIBases` not found.

- [ ] **Step 3: Implement `ServerAddress.swift` and `APIClient.swift`**

- [ ] **Step 4: Run to verify pass**

Run: `cd ios/SpotifiakCore && swift test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add ios/SpotifiakCore
git commit -m "iOS: server discovery and API client"
```

---

### Task 5: Queue model

**Files:**
- Create: `ios/SpotifiakCore/Sources/SpotifiakCore/QueueModel.swift`
- Create: `ios/SpotifiakCore/Tests/SpotifiakCoreTests/QueueModelTests.swift`

**Interfaces:**
- Consumes: `Track`.
- Produces `struct QueueModel: Codable, Sendable, Equatable`:
  - `enum Repeat: String, Codable { off, all, one }`
  - `private(set) var current: Track?`, `var upNext: [Track]` (computed: added tracks first, then the rest of the context in play order), `var shuffle: Bool { get }`, `var repeatMode: Repeat`
  - `mutating func play(_ tracks: [Track], startAt index: Int, shuffle: Bool)`: replaces context, clears added. With shuffle, `current` is `tracks[index]` and the rest are shuffled.
  - `mutating func add(_ tracks: [Track])`: appends to the "added" list. If nothing is playing, behaves like `play(tracks, startAt: 0, shuffle: false)`.
  - `mutating func setShuffle(_ on: Bool)`: keeps `current`; turning it off restores context order continuing after `current`'s original index.
  - `enum Advance { case track(Track), restart, stop }`
  - `mutating func next(auto: Bool) -> Advance`: added tracks are consumed first. `repeatMode == .one && auto` → `.restart`. End of context: `.all` wraps to the first track of the play order; otherwise `.stop` (current stays, position resets).
  - `mutating func previous(position: Double) -> Advance`: `position > 3` → `.restart`. At the first track without `.all` → `.restart`. Otherwise the previous context track.
  - `mutating func moveUpNext(from: Int, to: Int)` (indices into `upNext`; moving across the added/context boundary moves the track into the target section), `mutating func removeUpNext(at: Int)`
  - A random-source parameter `init(rng: some RandomNumberGenerator & Sendable)` isn't Codable-friendly. Instead, `play` and `setShuffle` take `using rng: inout some RandomNumberGenerator`, with overloads defaulting to `SystemRandomNumberGenerator`. Tests use a seeded generator.

- [ ] **Step 1: Write failing tests** (tracks `t(0)…t(4)` built by a helper)

```swift
@Test func addedTracksPlayBeforeTheRestOfTheContext() {
  var q = QueueModel(); q.play(ts, startAt: 0, shuffle: false); q.add([x])
  #expect(q.upNext.map(\.id) == ["x", "1", "2", "3", "4"])
  #expect(q.next(auto: true) == .track(x)); #expect(q.next(auto: true) == .track(ts[1]))
}
@Test func shuffleKeepsCurrentAndUnshuffleResumesInOrder() { /* play at 2 shuffled: current t2, upNext is a permutation of 0,1,3,4; setShuffle(false) → upNext == [3,4] */ }
@Test func repeatOneRestartsOnlyOnAuto() { /* .one: next(auto:true) == .restart, next(auto:false) == .track(t1) */ }
@Test func endOfContextStopsOrWraps() { /* at t4: .off → .stop; .all → .track(t0) */ }
@Test func previousRestartsAfterThreeSeconds() { /* at t2: previous(position: 3.5) == .restart, previous(position: 1) == .track(t1); at t0 with .off → .restart */ }
@Test func moveAndRemoveInUpNext() { /* move x from added to after t2 in context; remove index 0 */ }
@Test func roundTripsThroughCodable() { /* encode/decode equals */ }
@Test func emptyQueueIsSafe() { /* next on empty → .stop; previous → .stop; add on empty starts playback */ }
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ios/SpotifiakCore && swift test --filter QueueModel`
Expected: compile failure.

- [ ] **Step 3: Implement `QueueModel.swift`**

Store `context: [Track]`, `order: [Int]` (play order of context indices), `position: Int` (into `order`), `added: [Track]`, `playingAdded: Track?`. `current` is `playingAdded ?? context[order[position]]`.

- [ ] **Step 4: Run to verify pass**

Run: `cd ios/SpotifiakCore && swift test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add ios/SpotifiakCore
git commit -m "iOS: queue model"
```

---

### Task 6: App target, session, login, CI

**Files:**
- Create: `ios/project.yml`: app target `Spotifiak` (bundle id `dev.spotifiak.ios`, `DEVELOPMENT_TEAM` left empty so the user sets it locally), local package dependency `SpotifiakCore`, unit test target `SpotifiakTests`, `UIBackgroundModes: [audio]`, `NSAppTransportSecurity.NSAllowsArbitraryLoads: true`, `SWIFT_VERSION: 6.0`, `IPHONEOS_DEPLOYMENT_TARGET: 17.0`
- Create: `ios/.gitignore` (`*.xcodeproj`, `DerivedData/`, `.build/`)
- Create: `ios/Spotifiak/App/SpotifiakApp.swift`, `ios/Spotifiak/App/RootView.swift`
- Create: `ios/Spotifiak/Session/Session.swift`, `ios/Spotifiak/Session/URLSessionTransport.swift`
- Create: `ios/Spotifiak/Features/Login/LoginView.swift`
- Create: `ios/SpotifiakTests/SessionTests.swift`
- Create: `.github/workflows/ios.yml`
- Create: `ios/README.md`: `brew install xcodegen && cd ios && xcodegen && open Spotifiak.xcodeproj`, plus setting the team

**Interfaces:**
- Consumes: `APIClient`, `candidateAPIBases`, `AuthStatus`, `User`.
- Produces:
  - `URLSessionTransport: HTTPTransport`, built on `URLSession.shared` (shared cookie storage).
  - `@MainActor @Observable final class Session`: `enum State { case loggedOut(serverInput: String, status: AuthStatus?), loggedIn(User) }`; `var state`, `var api: APIClient?`; `func connect(serverInput: String) async throws` (discover, store the base under `UserDefaults` key `"apiBase"` and the raw input under `"serverInput"`, then load `authStatus`); `func login(username:password:) async throws`; `func register(username:password:displayName:) async throws`; `func logout() async`; `func restore() async` (at launch: uses the stored base, `authStatus()`, logged in when `user != nil`). `onUnauthorized` deletes the cookies for the base's host and switches to `.loggedOut` with `serverInput` prefilled.
  - `RootView`: `LoginView` or the main `TabView` (Task 8 fills the tabs; here it holds three placeholder tabs) depending on `session.state`.
  - `LoginView`: "Adresse du serveur" field, then username and password. Shows "Créer un compte" (with display name) when `status.needsSetup || status.signupOpen`. Errors show `APIError.message`.

- [ ] **Step 1: Write failing tests** (`SessionTests`, using a fake transport copied from the core tests into the app test target)

- `restore` with a stored base and `authStatus.user == nil` → `.loggedOut(serverInput: <stored>, ...)`.
- `connect("h")` then `login` → `.loggedIn(user)`, and `UserDefaults` holds `apiBase == "https://h/api"`.
- A 401 from `api.albums()` while logged in → `.loggedOut` with `serverInput == "h"`.

Tests use a dedicated `UserDefaults(suiteName:)` injected through `Session.init(defaults:transport:)`.

- [ ] **Step 2: Write `.github/workflows/ios.yml`**

Trigger on push and pull_request with `paths: ['ios/**', '.github/workflows/ios.yml']`. Two jobs:
- `core` on `ubuntu-latest`: `swift-actions/setup-swift` (Swift 6.x), `cd ios/SpotifiakCore && swift test`.
- `app` on `macos-latest`: `brew install xcodegen`, `cd ios && xcodegen`. The simulator is picked dynamically:

```bash
SIM=$(xcrun simctl list devices available -j | jq -r '[.devices[][] | select(.name | startswith("iPhone"))][0].udid')
xcodebuild test -project ios/Spotifiak.xcodeproj -scheme Spotifiak -destination "id=$SIM" CODE_SIGNING_ALLOWED=NO | xcpretty || exit ${PIPESTATUS[0]}
```

- [ ] **Step 3: Implement the files above**

- [ ] **Step 4: Verify**

Locally: `cd ios/SpotifiakCore && swift test` still passes. CI: push the branch (ask the user before the first push), then `gh run watch` on the iOS workflow.
Expected: `core` and `app` jobs green; the `app` job shows `SessionTests` passing.

- [ ] **Step 5: Commit**

```bash
git add ios .github/workflows/ios.yml
git commit -m "iOS: app target, login with server discovery, CI"
```

---

### Task 7: Player engine and player UI

**Files:**
- Create: `ios/Spotifiak/Player/PlayerEngine.swift`
- Create: `ios/Spotifiak/Player/NowPlaying.swift` (MPNowPlayingInfoCenter and MPRemoteCommandCenter wiring)
- Create: `ios/Spotifiak/Features/Player/MiniPlayer.swift`, `ios/Spotifiak/Features/Player/PlayerSheet.swift`
- Create: `ios/SpotifiakTests/PlayerEngineTests.swift`

**Interfaces:**
- Consumes: `QueueModel`, `APIClient.streamURL(for:)`, `APIClient.coverURL(track:)`.
- Produces:
  - `protocol AudioOutput: AnyObject { func load(_ url: URL, preload next: URL?); func play(); func pause(); func seek(to: Double); var position: Double { get }; var duration: Double? { get }; var onItemEnded: (() -> Void)? { get set }; var onFailed: ((Error) -> Void)? { get set } }`, with `AVQueuePlayerOutput` as the real implementation.
  - `@MainActor @Observable final class PlayerEngine`: `init(output: AudioOutput, api: @escaping () -> APIClient?, defaults: UserDefaults)`; `private(set) var queue: QueueModel`; `private(set) var isPlaying: Bool`; `var position: Double`; `func play(_ tracks: [Track], startAt: Int, shuffle: Bool = false)`; `func add(_ tracks: [Track])`; `func togglePlay()`; `func next()`; `func previous()`; `func seek(to: Double)`; `func setShuffle(_:)`; `func cycleRepeat()`; `private(set) var toast: String?`.
  - Behaviour: `.restart` from the queue → `seek(0)`. `.stop` → pause and `seek(0)`. A playback failure shows the toast "Lecture impossible, titre suivant" and skips; after 3 consecutive failures it stops instead. The queue is saved as JSON under `"playerQueue"` (throttled to at most once per 2 seconds, plus on background) and restored paused at init.
  - Audio session: `.playback`. On interruption began → `isPlaying = false`; ended with `.shouldResume` → `play()`. On route change `.oldDeviceUnavailable` → pause.
  - Now playing: title, artist, album, artwork (downloaded once per track via `URLSession.shared`), duration, elapsed, rate. Remote commands: play, pause, togglePlayPause, nextTrack, previousTrack, changePlaybackPosition.
  - `MiniPlayer` (cover, title, artist, play/pause, next) sits above the tab bar via `.safeAreaInset(edge: .bottom)`; tapping opens `PlayerSheet` (large cover, scrubber, previous/play/next, shuffle, repeat).

- [ ] **Step 1: Write failing tests** with a `FakeAudioOutput` recording calls

- `play(ts, startAt: 1)` loads `streamURL(ts[1])`, preloads `ts[2]`, and `isPlaying` is true.
- `onItemEnded` with repeat `.one` seeks to 0 and loads nothing new.
- `previous()` at position 5 seeks to 0; at position 1 loads `ts[0]`.
- Three consecutive `onFailed` calls → 2 skips, then stopped, with `toast` set; a success in between resets the count.
- A fresh `PlayerEngine` with the same `UserDefaults` restores `queue.current` with `isPlaying == false`.

- [ ] **Step 2: Run to verify failure (CI `app` job, or Xcode on the user's Mac)**

Expected: compile failure, `PlayerEngine` not found.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Verify**

CI `app` job green. Then add the player items to `ios/TESTING.md` (Task 8 creates the file; append if it already exists).

- [ ] **Step 5: Commit**

```bash
git add ios
git commit -m "iOS: player engine with background audio and lock screen controls"
```

---

### Task 8: Browse screens and manual checklist

**Files:**
- Create: `ios/Spotifiak/Support/ImageCache.swift`, `ios/Spotifiak/Support/RemoteImage.swift`, `ios/Spotifiak/Support/Format.swift`, `ios/Spotifiak/Support/Toast.swift`
- Create: `ios/Spotifiak/Features/Home/HomeView.swift`, `ios/Spotifiak/Features/Search/SearchView.swift`, `ios/Spotifiak/Features/Album/AlbumView.swift`, `ios/Spotifiak/Features/Artist/ArtistView.swift`, `ios/Spotifiak/Features/Common/TrackRow.swift`, `ios/Spotifiak/Features/Common/AlbumCard.swift`
- Modify: `ios/Spotifiak/App/RootView.swift` (real tabs: Accueil, Rechercher, Bibliothèque placeholder "Bientôt disponible"; each tab gets its own `NavigationStack` with `navigationDestination` for `Album` and `Artist` ids)
- Create: `ios/SpotifiakTests/FormatTests.swift`
- Create: `ios/TESTING.md`

**Interfaces:**
- Consumes: `Session.api`, `PlayerEngine.play`, `APIClient` cover URLs.
- Produces:
  - `func formatDuration(_ seconds: Double?) -> String`: `"3:07"`, `"1:02:03"`, `"–"` for nil.
  - `func greeting(at date: Date, calendar: Calendar) -> String`: `Bonsoir` before 5 h or from 18 h, `Bonjour` before 12 h, `Bon après-midi` otherwise (same as `HomePage.tsx`).
  - `ImageCache`: an actor with memory (`NSCache`) and disk (`Caches/Images/<sha256 of URL>`) layers, loading through `URLSession.shared` so cookie-protected `/tracks/:id/cover` works. `RemoteImage(url:)` is a view with a placeholder.
  - `HomeView`: greeting title; shelves "Albums" (`api.albums()`) and "Artistes" (`api.artists()`); empty state "Votre bibliothèque est vide" when both are empty.
  - `SearchView`: `.searchable`, debounced 300 ms, sections Titres / Albums / Artistes; tapping a track plays the search's track list from it.
  - `AlbumView`: cover, title, artist (link), year, play and shuffle buttons, track list. `ArtistView`: picture, albums grid, tracks.
  - Load errors show the inline message "Serveur injoignable" with a "Réessayer" button; toasts come from `PlayerEngine.toast` and API errors.

- [ ] **Step 1: Write failing tests**

```swift
@Test func durations() { #expect(formatDuration(187) == "3:07"); #expect(formatDuration(3723) == "1:02:03"); #expect(formatDuration(nil) == "–") }
@Test func greetings() { /* 04:59 → Bonsoir, 05:00 → Bonjour, 12:00 → Bon après-midi, 18:00 → Bonsoir */ }
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: implement**, then **Step 4: verify** the CI `app` job is green.

- [ ] **Step 5: Write `ios/TESTING.md`**: a device checklist for milestone 1:
  - log in with a bare hostname, with an `http://` LAN address, and with a wrong address (error shown);
  - browse Home, Search, Album, Artist; covers load;
  - play an album: lock the phone, playback continues; lock screen shows the cover and controls; AirPods double tap skips;
  - phone call interruption pauses and resumes; unplugging headphones pauses;
  - an `.ogg` track plays (first play may take a few seconds);
  - kill and relaunch: the last track is shown, paused;
  - revoke the session from the web (log out everywhere) → the app returns to Login with the server prefilled.

- [ ] **Step 6: Commit**

```bash
git add ios
git commit -m "iOS: home, search, album and artist screens"
```

---

## Milestone 1 done when

- `cd backend && npm test && npm run typecheck` pass; `cd ios/SpotifiakCore && swift test` passes; the iOS CI workflow is green on the branch.
- The user has run `ios/TESTING.md` on a device (requires Xcode on their Mac; I can't do this step).
