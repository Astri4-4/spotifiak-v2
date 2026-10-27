import { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { useAuth } from './auth/context'
import { LoginScreen } from './auth/LoginScreen'
import { CollectionProvider } from './collection/CollectionProvider'
import { JamProvider } from './jam/JamProvider'
import { JamPage } from './components/Jam'
import { BottomNav, MobileBackButton, MobilePlayer } from './components/Mobile'
import { PlayerBar } from './components/PlayerBar'
import { QueuePanel } from './components/QueuePanel'
import { ScrollToTop } from './components/ScrollToTop'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { useIsMobile } from './hooks'
import { AccountPage } from './pages/AccountPage'
import { AlbumPage } from './pages/AlbumPage'
import { ArtistPage } from './pages/ArtistPage'
import { HomePage } from './pages/HomePage'
import { LikedPage } from './pages/LikedPage'
import { PlaylistPage } from './pages/PlaylistPage'
import { ScanPage } from './pages/ScanPage'
import { SearchPage } from './pages/SearchPage'
import { SpotifyImportPage } from './pages/SpotifyImportPage'
import { UsersPage } from './pages/UsersPage'
import { PlayerProvider } from './player/PlayerProvider'

function MainApp() {
  const [queueOpen, setQueueOpen] = useState(false)
  const isMobile = useIsMobile()

  return (
    // Order matters: the Jam shows toasts (collection) and drives the player.
    <CollectionProvider>
      <JamProvider>
        <PlayerProvider>
          <div className={`app${isMobile ? ' mobile' : queueOpen ? ' with-queue' : ''}`}>
            {!isMobile && <TopBar />}
            {!isMobile && <Sidebar />}
            <main className="main-view panel" id="main-view">
              <ScrollToTop />
              {isMobile && <MobileBackButton />}
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/search/:query" element={<SearchPage />} />
                {/* The library is the sidebar on desktop, its own tab on phones. */}
                <Route path="/library" element={isMobile ? <Sidebar mobile /> : <Navigate to="/" replace />} />
                <Route path="/album/:id" element={<AlbumPage />} />
                <Route path="/artist/:id" element={<ArtistPage />} />
                <Route path="/playlist/:id" element={<PlaylistPage />} />
                <Route path="/collection/tracks" element={<LikedPage />} />
                <Route path="/import/spotify" element={<SpotifyImportPage />} />
                <Route path="/scan" element={<ScanPage />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="/admin/users" element={<UsersPage />} />
                <Route path="/jam/:id" element={<JamPage />} />
              </Routes>
            </main>
            {isMobile ? (
              <div className="mobile-dock">
                <MobilePlayer />
                <BottomNav />
              </div>
            ) : (
              <>
                {queueOpen && <QueuePanel />}
                <PlayerBar queueOpen={queueOpen} onToggleQueue={() => setQueueOpen(!queueOpen)} />
              </>
            )}
          </div>
        </PlayerProvider>
      </JamProvider>
    </CollectionProvider>
  )
}

function Gate() {
  const { user } = useAuth()
  // Keyed by user: signing out unmounts the player (stops playback) and nothing
  // (queue, page state) carries over to the next account.
  return user ? <MainApp key={user.id} /> : <LoginScreen />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  )
}
