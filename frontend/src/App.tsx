import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import { SearchPage } from './pages/SearchPage'
import { PlayerBar } from './player/PlayerBar'
import { PlayerProvider } from './player/PlayerContext'

export default function App() {
  return (
    <BrowserRouter>
      <PlayerProvider>
        <div className="layout">
          <nav className="sidebar">
            <h1>Spotifiak</h1>
            <NavLink to="/">Home</NavLink>
            <NavLink to="/search">Search</NavLink>
          </nav>
          <main className="content">
            <Routes>
              <Route path="/" element={<h2>Home</h2>} />
              <Route path="/search" element={<SearchPage />} />
            </Routes>
          </main>
          <PlayerBar />
        </div>
      </PlayerProvider>
    </BrowserRouter>
  )
}
