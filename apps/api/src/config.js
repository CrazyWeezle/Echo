// Centralized configuration for API
export const DATABASE_URL = process.env.DATABASE_URL || '';

// JWT secret: require it in production; allow dev default
let secret = process.env.JWT_SECRET;
if (!secret) {
  if (String(process.env.NODE_ENV || 'development') === 'production') {
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
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || process.env.APP_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export const PORT = process.env.PORT ? Number(process.env.PORT) : 5000;
