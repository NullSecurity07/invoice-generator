const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  let token;
  // Debug Log
  const hasCookie = !!(req.cookies && req.cookies.token);
  // console.log(`[Auth Middleware] Request: ${req.method} ${req.path} | Cookie present: ${hasCookie}`);

  if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  } else {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      token = auth.slice(7);
    }
  }

  if (!token) {
    if (req.path !== '/me') { // Quiet down noise for standard session check
       console.warn(`[Auth Middleware] No token provided for ${req.path}`);
    }
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    console.error(`[Auth Middleware] Token verification failed for ${req.path}: ${err.message}`);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
