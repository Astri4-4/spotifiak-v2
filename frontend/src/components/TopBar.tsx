import { Link, useLocation, useNavigate } from 'react-router-dom'
import { BellIcon, ChevronLeftIcon, ChevronRightIcon, HomeFilledIcon, HomeIcon, JamIcon, LogoIcon } from '../icons'
import { useSocial } from '../social/context'
import { SearchInput } from './SearchInput'
import { UserMenu } from './UserMenu'

export function TopBar() {
  const navigate = useNavigate()
  const isHome = useLocation().pathname === '/'
  const { unread, friendRequests } = useSocial()

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
        <Link to="/friends" className="icon-button topbar-icon" aria-label={`Amis${friendRequests ? `, ${friendRequests} demandes` : ''}`} title="Amis">
          <JamIcon size={20} />
          {friendRequests > 0 && <span className="badge">{friendRequests}</span>}
        </Link>
        <Link to="/inbox" className="icon-button topbar-icon" aria-label={`Notifications${unread ? `, ${unread} non lues` : ''}`} title="Notifications">
          <BellIcon size={20} />
          {unread > 0 && <span className="badge">{unread}</span>}
        </Link>
        <UserMenu />
      </div>
    </header>
  )
}
