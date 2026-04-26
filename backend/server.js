const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// 1. Load environment variables at the ABSOLUTE START
const envPath = path.join(__dirname, '.env');
const envProdPath = path.join(__dirname, '.env.production');

// Load .env if it exists
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Load .env.production IF NOT ALREADY SET (or as override if you prefer)
// On Render, we want the Dashboard secrets to win, then .env, then .env.production
if (fs.existsSync(envProdPath)) {
  const envConfig = dotenv.parse(fs.readFileSync(envProdPath));
  for (const k in envConfig) {
    if (!process.env[k]) {
      process.env[k] = envConfig[k];
    }
  }
  console.log('◇ Loaded production defaults from .env.production');
}

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const cookieParser = require('cookie-parser');

// 2. Import Database
const db = require('./db');

const app = express();

// Security and Logging middleware
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "script-src": ["'self'", "'unsafe-inline'"],
      "script-src-attr": ["'self'", "'unsafe-inline'"],
      "style-src": ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      "font-src": ["'self'", "fonts.gstatic.com"],
      "img-src": ["'self'", "data:", "blob:"]
    }
  }
}));

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Trust Render's proxy
app.set('trust proxy', 2);

// Multi-domain CORS
const frontendEnv = (process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
const baseEnv     = (process.env.BASE_URL || '').trim().replace(/\/$/, '');

const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  frontendEnv,
  baseEnv,
  'https://trainers.blcompiler.com', // Explicitly allow GoDaddy domain
  process.env.RENDER_EXTERNAL_URL,
  (process.env.BACKEND_URL || '').trim().replace(/\/$/, '')
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    const host = (process.env.BACKEND_URL || '').replace(/\/$/, '');
    const isSelf = host && origin === host;
    const exactMatch = allowedOrigins.includes(origin);
    const domainMatch = frontendEnv && origin.includes(frontendEnv.split('://')[1]);
    
    if (isSelf || exactMatch || domainMatch) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

const rateLimit = require('express-rate-limit');
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// API Routes
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/admin',    require('./routes/admin'));

// SPA fallback
app.get(/(.*)/, (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: `API endpoint ${req.path} not found` });
  }
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 3. START SERVER
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    console.log('⏳ Initializing SQLite database connection...');
    await db.initialize();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🚀 BLC Invoice Portal running at http://localhost:${PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'production'}`);
      console.log(`   Internal Port: ${PORT}`);
      if (!process.env.JWT_SECRET) {
        console.error('   ⚠️ WARNING: JWT_SECRET is not set! Authentication will fail.');
      } else {
        console.log(`   ✅ JWT_SECRET is set (Length: ${process.env.JWT_SECRET.length})`);
      }
      console.log('');
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

start();
