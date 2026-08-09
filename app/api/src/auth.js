/**
 * Session authentication.
 *
 * A signed JWT carried in an httpOnly cookie. Not because JWTs are fashionable
 * but because it keeps the API stateless, which is what lets you scale the
 * Deployment from two replicas to six without a shared session store.
 *
 * The signing secret comes from the environment, which comes from a Kubernetes
 * Secret, which comes from AWS Secrets Manager. It is never in Git, never in
 * the image, and rotating it is demonstrated in the recording.
 */
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import config from './config.js';
import { queryOne } from './db.js';
import { failedLogins } from './metrics.js';
import logger from './logger.js';
import { requestContext } from './logger.js';

export async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, config.auth.bcryptRounds);
}

export function issueToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, name: user.full_name },
    config.auth.jwtSecret,
    { expiresIn: config.auth.tokenTtlSeconds, issuer: 'agribridge-api' },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, config.auth.jwtSecret, { issuer: 'agribridge-api' });
}

export function setSessionCookie(res, token) {
  res.cookie(config.auth.cookieName, token, {
    httpOnly: true,                     // not readable from JavaScript
    secure: config.auth.cookieSecure,   // HTTPS only outside local dev
    sameSite: 'lax',
    maxAge: config.auth.tokenTtlSeconds * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(config.auth.cookieName, { path: '/' });
}

/**
 * Verify an email and password against the users table.
 * Returns the user row, or null. Increments the failed-login counter on
 * failure - that metric feeds alert A-16.
 */
export async function authenticate(email, password) {
  const user = await queryOne(
    'auth_lookup_user',
    'SELECT id, email, password_hash, full_name, role, organisation, state FROM users WHERE email = $1',
    [String(email).toLowerCase().trim()],
  );

  if (!user) {
    // Hash anyway so a missing account and a wrong password take roughly the
    // same time. Cheap defence against user enumeration by timing.
    await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    failedLogins.inc();
    logger.warn('login failed: unknown account', { email });
    return null;
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    failedLogins.inc();
    logger.warn('login failed: bad password', { user_id: user.id });
    return null;
  }

  delete user.password_hash;
  return user;
}

/* --------------------------------------------------------------- middleware */

/** Populate req.user if a valid session cookie or bearer token is present. */
export function loadUser(req, _res, next) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const token = req.cookies?.[config.auth.cookieName] ?? bearer;

  if (token) {
    try {
      const claims = verifyToken(token);
      req.user = {
        id: claims.sub, role: claims.role, email: claims.email, name: claims.name,
      };
      const store = requestContext.getStore();
      if (store) store.userId = claims.sub;
    } catch {
      // An expired or tampered token is simply an anonymous request.
      req.user = null;
    }
  }
  next();
}

/** Reject anonymous requests. */
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'authentication required' });
  }
  return next();
}

/** Reject requests from the wrong role. Agents are permitted everywhere. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication required' });
    if (!roles.includes(req.user.role) && req.user.role !== 'agent') {
      return res.status(403).json({
        error: `this action requires one of: ${roles.join(', ')}`,
      });
    }
    return next();
  };
}
