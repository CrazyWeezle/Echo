// Centralized configuration for API
// Provide sensible dev defaults so `pnpm run dev:stack` works without extra env.
const NODE_ENV = String(process.env.NODE_ENV || 'development');
export const DATABASE_URL = process.env.DATABASE_URL || (
  NODE_ENV !== 'production' ? 'postgresql://echo:echo@localhost:5432/echo' : ''
);

// JWT secret: require it in production; allow dev default
let secret = process.env.JWT_SECRET;
if (!secret) {
  if (NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.error('FATAL: JWT_SECRET is not set in production');
    process.exit(1);
  } else {
    secret = 'dev-secret-change-me';
    // eslint-disable-next-line no-console
    console.warn('[dev] Using insecure default JWT secret');
  }
}
export const JWT_SECRET = secret;

// Allowed origins for CORS and Socket.IO (comma-separated)
const rawOrigins = process.env.ALLOWED_ORIGINS || process.env.APP_ORIGIN || (
  NODE_ENV !== 'production' ? 'http://localhost:3000' : ''
);
export const ALLOWED_ORIGINS = rawOrigins
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export const PORT = process.env.PORT ? Number(process.env.PORT) : 5000;
