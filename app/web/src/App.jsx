import React, { useEffect, useState } from 'react';
import api from './api.js';
import Login from './components/Login.jsx';
import Dashboard from './components/Dashboard.jsx';
import FarmerView from './components/FarmerView.jsx';
import BuyerView from './components/BuyerView.jsx';
import OrdersView from './components/OrdersView.jsx';

/**
 * Root component. View state is held here rather than pulling in a router -
 * four views do not justify the bundle cost on a 240 kbps connection.
 *
 * The footer shows the running commit, read from /version. That is deliberate:
 * during the recording it lets you prove which build is serving the page
 * without leaving the browser.
 */
export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState('dashboard');
  const [build, setBuild] = useState(null);

  // Restore an existing session on load - the cookie is httpOnly, so asking
  // the API is the only way to know whether we are signed in.
  useEffect(() => {
    api.me()
      .then(({ user: found }) => setUser(found))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));

    api.version().then(setBuild).catch(() => {});
  }, []);

  async function signOut() {
    await api.logout().catch(() => {});
    setUser(null);
    setView('dashboard');
  }

  function signedIn(found) {
    setUser(found);
    setView(found.role === 'buyer' ? 'browse' : found.role === 'farmer' ? 'produce' : 'dashboard');
  }

  if (checking) return <div className="spinner">Loading AgriBridge…</div>;
  if (!user) return <Login onSignedIn={signedIn} />;

  const tabs = [
    { key: 'dashboard', label: 'Dashboard' },
    ...(user.role === 'farmer' || user.role === 'agent' ? [{ key: 'produce', label: 'My produce' }] : []),
    ...(user.role === 'buyer' || user.role === 'agent' ? [{ key: 'browse', label: 'Open lots' }] : []),
    { key: 'orders', label: 'Orders' },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">AgriBridge <span>Market</span></div>
        <div className="spacer" />
        <div className="who">{user.name} · {user.role}</div>
        <button type="button" className="secondary small" onClick={signOut}>Sign out</button>
      </header>

      <nav className="nav">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={view === tab.key ? 'active' : ''}
            onClick={() => setView(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main>
        {view === 'dashboard' && <Dashboard />}
        {view === 'produce' && <FarmerView user={user} />}
        {view === 'browse' && <BuyerView />}
        {view === 'orders' && <OrdersView user={user} />}
      </main>

      <footer>
        AgriBridge Technologies Ltd. · Lagos
        {build && (
          <>
            {' · '}
            <code className="mono">
              {build.version} @ {String(build.gitSha).slice(0, 7)} · {build.environment}
            </code>
          </>
        )}
      </footer>
    </div>
  );
}
