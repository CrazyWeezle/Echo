Echo — Persistent Login, Chat, and Identity

Echo is a minimal but complete real-time chat stack: username/password auth with short‑lived JWT access tokens, httpOnly refresh cookies, Socket.IO realtime, spaces/channels, messages with reactions and attachments, presence, typing indicators, and optional S3/MinIO uploads — all backed by Postgres.

Features
- Auth: JWT access (15m) + httpOnly refresh cookie (30d)
- Realtime: Socket.IO (WebSocket with polling fallback)
- Chat: spaces, channels, backlog, edit/delete, reactions, read receipts
- Presence: space- and channel-level presence, typing indicators
- Storage: Postgres for state; S3/MinIO for attachments (presigned PUT)
- Web app: React + Vite (TypeScript), optional Capacitor push

Architecture
- API server: `apps/api/src/main.js`
  - Node `http` server with minimal routing (no Express)
  - Postgres via `pg` pool; schema bootstraps on startup
  - JWT auth; refresh rotation via cookie
  - Socket.IO `auth.token` handshake + per-space/channel rooms
  - Optional S3/MinIO presigned uploads; optional FCM push
- Web client: `apps/web`
  - React + Vite + Tailwind
  - Socket.IO client with resilient reconnect (`src/lib/socket.ts`)
  - Token storage + refresh handling in `src/lib/api.ts`
  - Capacitor push registration (no-op on web) in `src/lib/push.ts`
- Hosting: `hosting/`
  - Dockerfiles for API/Web, Nginx config, `docker-compose.yml`
  - Services: api, web, db, minio(+mc bootstrap), mailhog, adminer

Repo Layout
- `apps/api` — HTTP API + Socket.IO server (ESM)
- `apps/web` — React client (Vite, TS)
- `hosting` — Dockerfiles, docker-compose, Nginx config
- `hosting/env` — example env files for API and MinIO

Requirements
- Node 20+, pnpm 10+
- Postgres 14+ (local or via Docker compose)
- Optional: MinIO/S3 for attachments; SMTP for verification

Quickstart (Local Dev)
- Install deps: `pnpm i`
- Start Postgres locally or use Docker compose (below)
- Set environment:
  - `DATABASE_URL=postgresql://echo:echo@localhost:5432/echo`
  - `JWT_SECRET=replace-with-strong-secret`
- API: `pnpm --filter ./apps/api dev` (or `node apps/api/src/main.js`)
- Web: `cd apps/web && pnpm dev`
- App: open `http://localhost:5173`

Run with Docker Compose
- `cd hosting`
- Copy and edit envs:
  - `cp env/api.env.example env/api.env`
  - `cp env/minio.env.example env/minio.env`
- Start: `docker compose up --build`
- Web: `http://localhost:3000`
- API: proxied at `/api`
- Socket.IO: `/socket.io`
- Files: `/files/<bucket>/<key>` (proxied to MinIO)

Environment (API)
- Required
  - `DATABASE_URL` — Postgres DSN
  - `JWT_SECRET` — JWT signing secret (required in production)
- CORS
  - `ALLOWED_ORIGINS` — CSV list of allowed origins (recommended for prod)
- Uploads (optional, for S3/MinIO)
  - `STORAGE_S3_REGION`, `STORAGE_S3_BUCKET`, `STORAGE_S3_ENDPOINT`
  - `STORAGE_S3_ACCESS_KEY`, `STORAGE_S3_SECRET_KEY`, `STORAGE_S3_FORCE_PATH_STYLE`
  - `STORAGE_PUBLIC_BASE` — public base (e.g., `/files/echo-app`)
- Email verification (optional)
  - `SIGNUP_REQUIRE_VERIFY=true` to enforce email on signup
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`
  - `FROM_EMAIL`, `PUBLIC_WEB_URL`
- Push (optional, FCM)
  - `FCM_SERVICE_ACCOUNT_JSON` — JSON string of service account

Web Client Env
- Build-time (in Dockerfile.web): `VITE_API_URL=/api`
- Local dev (optional): set `VITE_API_URL` to same-origin `/api` or full API URL

HTTP API (Selected)
- Auth
  - `POST /api/auth/signup` — `{ username, password }` (email optional unless enforced)
  - `POST /api/auth/login` — `{ username, password }` → `{ token, user }`
  - `POST /api/auth/refresh` — cookie-based → `{ token }`
  - `POST /api/auth/logout` — clears current refresh session
  - `POST /api/auth/logout-all` — clears all sessions
- Profile
  - `GET /api/users/me` — current user profile
  - `PATCH /api/users/me` — update profile fields
- Spaces/Channels
  - `GET /api/spaces/members?spaceId=...`
  - `POST /api/spaces` / `PATCH /api/spaces` / `DELETE /api/spaces` / `POST /api/spaces/leave`
  - `POST /api/channels` / `POST /api/channels/delete` / `POST /api/channels/rename`
- Invites
  - `POST /api/spaces/invite` — create
  - `POST /api/invites/accept` — accept
- Files
  - `POST /api/files/sign` — `{ filename, contentType, size }` → presigned PUT

Socket.IO Events (Summary)
- Handshake: `auth: { token }`
- Server emits on connect: `auth:accepted { userId, name, avatarUrl }`
- Spaces/channels:
  - Client: `void:list`, `void:switch { voidId }`, `channel:list { voidId }`, `channel:switch { channelId }`
  - Server: `void:list { voids }`, `channel:list { voidId, channels }`, `channel:backlog { voidId, channelId, messages }`
- Messages:
  - Send: `message:send { voidId, channelId, content, tempId?, attachments? }`
  - Broadcast: `message:new { ... }`
  - Edit/Delete: `message:edit`, `message:delete` → `message:edited`, `message:deleted`
  - Reads: `read:up_to { channelId, lastMessageId }` → `message:seen { ... }`
- Reactions:
  - `reaction:add { messageId, emoji }`, `reaction:remove { messageId, emoji }` → `message:reactions { ... }`
- Presence/Typing:
  - Room presence: `presence:room`, space-wide `presence:space`, and global presence
  - Typing: `typing:set { voidId, channelId, isTyping }` → `typing:start|typing:stop`

Data Model (Core Tables)
- `users`, `sessions`, `spaces`, `space_members`, `channels`, `messages`,
  `message_attachments`, `message_reads`, `message_reactions`, `invites`
- Optional/feature tables: `push_devices`, `kanban_lists`, `kanban_items`, `form_questions`, `form_answers`, `habit_defs`, `habit_trackers`, `habit_entries`

Security Notes
- Always set `JWT_SECRET` and `ALLOWED_ORIGINS` in production.
- Refresh cookie is `HttpOnly; SameSite=Lax; Secure` in production.
- Consider rate-limiting auth endpoints and CSRF hardening for cookie endpoints.
- Lock down DB and MinIO in production (no public ports unless necessary).

Secrets Management
- Never commit real secrets. Keep only `*.env.example` files in git and load actual secrets via environment or a secret manager.
- Rotate any tokens or keys that were previously committed.
- Ensure `.dockerignore` excludes `.env` and `hosting/env/*.env` so secrets don’t enter images via build context.

Troubleshooting
- 401 after idle: browser lost refresh cookie or session rotation failed
- CORS/WS issues: confirm `path: '/socket.io'` and Nginx route
- Uploads fail: validate MinIO is healthy and env values match bucket/endpoint

License
This repository uses the MIT License. See `LICENSE`.

Contributing
See `CONTRIBUTING.md` for guidelines on environment setup, coding standards, and submitting changes.
