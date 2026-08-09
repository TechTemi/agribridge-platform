import { Router } from 'express';
import {
  authenticate, issueToken, setSessionCookie, clearSessionCookie, requireAuth,
} from '../auth.js';
import { asyncRoute } from '../middleware.js';
import logger from '../logger.js';

export const authRouter = Router();

authRouter.post('/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body ?? {};

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = await authenticate(email, password);
  if (!user) {
    // One generic message for both unknown-account and wrong-password, so the
    // response cannot be used to enumerate who has an account.
    return res.status(401).json({ error: 'invalid email or password' });
  }

  setSessionCookie(res, issueToken(user));
  logger.info('login succeeded', { user_id: user.id, role: user.role });

  // Return the SAME shape as GET /api/auth/me, which is built from the JWT
  // claims and so uses `name` rather than the database column `full_name`.
  // They diverged, and the effect was subtle: the header rendered "· buyer"
  // with a blank name immediately after signing in, then corrected itself on
  // the next page load once the session was restored from the token. Two
  // endpoints describing the same object must agree on its shape.
  return res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.full_name,
      role: user.role,
      organisation: user.organisation,
      state: user.state,
    },
  });
}));

authRouter.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

/** Who am I? Used by the web app on load to restore a session. */
authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default authRouter;
