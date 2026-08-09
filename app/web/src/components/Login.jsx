import React, { useState } from 'react';
import api from '../api.js';

/**
 * Login. The demo-credential shortcuts exist so that during a recording you
 * are not typing an email address on camera - one tap switches persona.
 */
const DEMO = [
  { label: 'Farmer (Amina, Kano)', email: 'amina.yusuf@example.ng' },
  { label: 'Buyer (Sahel Mills)', email: 'procurement@sahelmills.example' },
  { label: 'Field agent (Ibadan)', email: 'agent@agribridge.example' },
];
const DEMO_PASSWORD = 'HarvestMonday2025!';

export default function Login({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login(email, password);
      onSignedIn(user);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function useDemo(demoEmail) {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    setError(null);
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="brand">AgriBridge <span>Market</span></div>
        <div className="tagline">
          Connecting smallholder farmers to institutional grain buyers.
        </div>

        {error && (
          <div className="notice error">
            {error.message}
            {error.requestId && <><br /><code>request {error.requestId}</code></>}
          </div>
        )}

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="demo-creds">
          <strong>Demo accounts</strong>
          <code>password: {DEMO_PASSWORD}</code>
          <div className="actions" style={{ marginTop: '.5rem' }}>
            {DEMO.map((d) => (
              <button
                key={d.email}
                type="button"
                className="secondary small"
                onClick={() => useDemo(d.email)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
