import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { HOME_TILES } from '../lib/homeTiles'
import './Home.css'

function Home() {
  const { employee } = useAuth()
  const tiles = HOME_TILES[employee?.role] ?? []

  return (
    <main className="home">
      <div className="home-header">
        <h1>Home</h1>
        <p>Welcome back, {employee?.name}.</p>
      </div>

      {tiles.length === 0 ? (
        <p className="home-empty">No shortcuts set up for your role yet.</p>
      ) : (
        <div className="home-tiles">
          {tiles.map((tile) => (
            <Link key={tile.to} to={tile.to} className="home-tile">
              <span className="home-tile-title">{tile.label}</span>
              <span className="home-tile-desc">{tile.desc}</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}

export default Home
