import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeftIcon, ChevronRightIcon, HomeFilledIcon, HomeIcon, LogoIcon } from '../icons'
import { SearchInput } from './SearchInput'
import { UserMenu } from './UserMenu'

export function TopBar() {
  const navigate = useNavigate()
  const isHome = useLocation().pathname === '/'

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link to="/" className="logo" aria-label="Spotifiak">
          <LogoIcon size={32} />
        </Link>
        <button className="nav-arrow" onClick={() => navigate(-1)} aria-label="Retour">
          <ChevronLeftIcon />
        </button>
        <button className="nav-arrow" onClick={() => navigate(1)} aria-label="Avancer">
          <ChevronRightIcon />
        </button>
      </div>

      <div className="topbar-center">
        <Link to="/" className="home-button" aria-label="Accueil">
          {isHome ? <HomeFilledIcon size={24} /> : <HomeIcon size={24} />}
        </Link>
        <SearchInput />
      </div>

      <div className="topbar-right">
        <UserMenu />
      </div>
    </header>
  )
}
