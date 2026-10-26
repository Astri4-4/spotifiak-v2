import { useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { PlayerBar } from './components/PlayerBar'
import { QueuePanel } from './components/QueuePanel'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { AlbumPage } from './pages/AlbumPage'
import { ArtistPage } from './pages/ArtistPage'
import { HomePage } from './pages/HomePage'
import { ScanPage } from './pages/ScanPage'
import { SearchPage } from './pages/SearchPage'
import { PlayerProvider } from './player/PlayerProvider'
import { ScrollToTop } from './components/ScrollToTop'

export default function App() {
  const [queueOpen, setQueueOpen] = useState(false)

  return (
    <BrowserRouter>
      <PlayerProvider>
        <div className={`app${queueOpen ? ' with-queue' : ''}`}>
          <TopBar />
          <Sidebar />
          <main className="main-view panel" id="main-view">
            <ScrollToTop />
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/search/:query" element={<SearchPage />} />
              <Route path="/album/:id" element={<AlbumPage />} />
              <Route path="/artist/:id" element={<ArtistPage />} />
              <Route path="/scan" element={<ScanPage />} />
            </Routes>
          </main>
          {queueOpen && <QueuePanel />}
          <PlayerBar queueOpen={queueOpen} onToggleQueue={() => setQueueOpen(!queueOpen)} />
        </div>
      </PlayerProvider>
    </BrowserRouter>
  )
}
