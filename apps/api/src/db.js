import pkg from 'pg';
import { DATABASE_URL } from './config.js';

const { Pool } = pkg;

export const pool = new Pool({ connectionString: DATABASE_URL });

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar_url TEXT,
      bio TEXT,
      pronouns TEXT,
      location TEXT,
      website TEXT,
      banner_url TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // New columns for profiles on existing deployments
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT`);
  // Presence vs activity: keep existing `status` for presence mode; add `activity` for mini status text
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS activity TEXT`);
  // Optional structured profile fields
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS skills JSONB`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS socials JSONB`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tone_url TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name_color TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_ring_color TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_ring_enabled BOOLEAN`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pronouns TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS location TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS website TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ`);
  // Email-related columns used by auth flows; make email nullable
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
  try { await pool.query(`ALTER TABLE users ALTER COLUMN email DROP NOT NULL`); } catch {}
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_code TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_expires TIMESTAMPTZ`);
  // Ensure email uniqueness when provided (case-insensitive)
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (LOWER(email)) WHERE email IS NOT NULL`);

  // Profiles table removed; users.* is canonical now

  // Favorites: per-user pinned items (channels, lists, etc.) stored by opaque target_id
  await pool.query(`
    CREATE TABLE IF NOT EXISTS favorites (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (user_id, target_id)
    );
  `);
  // No profile backfill; legacy table is deprecated

  // Friends tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS friendships (
      user_id_a UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_id_b UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (user_id_a, user_id_b)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS friendships_b_idx ON friendships(user_id_b)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id UUID PRIMARY KEY,
      from_user UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(from_user, to_user)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS friend_requests_to_idx ON friend_requests(to_user)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS friend_requests_from_idx ON friend_requests(from_user)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      refresh_token_hash TEXT NOT NULL,
      user_agent TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);

  // Core chat data
  await pool.query(`
    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE spaces ADD COLUMN IF NOT EXISTS avatar_url TEXT`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT,
      linked_gallery_id TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS type TEXT`);
  await pool.query(`ALTER TABLE channels ALTER COLUMN type SET DEFAULT 'text'`);
  await pool.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS linked_gallery_id TEXT`);
  // Preferred default channel per space
  await pool.query(`ALTER TABLE spaces ADD COLUMN IF NOT EXISTS home_channel_id TEXT`);

  // Kanban tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kanban_lists (
      id UUID PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      pos INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kanban_items (
      id UUID PRIMARY KEY,
      list_id UUID NOT NULL REFERENCES kanban_lists(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      pos INT NOT NULL DEFAULT 0,
      done BOOLEAN DEFAULT false,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Forms
  await pool.query(`
    CREATE TABLE IF NOT EXISTS form_questions (
      id UUID PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      kind TEXT DEFAULT 'text',
      pos INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS form_answers (
      question_id UUID NOT NULL REFERENCES form_questions(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      answer TEXT,
      updated_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (question_id, user_id)
    );
  `);

  // Habit tracker tables (best-effort)
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS habit_defs (
        id UUID PRIMARY KEY,
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        pos INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS habit_trackers (
        id UUID PRIMARY KEY,
        habit_id UUID NOT NULL REFERENCES habit_defs(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_public BOOLEAN NOT NULL DEFAULT true,
        UNIQUE(habit_id, user_id),
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS habit_entries (
        id UUID PRIMARY KEY,
        tracker_id UUID NOT NULL REFERENCES habit_trackers(id) ON DELETE CASCADE,
        day DATE NOT NULL,
        done BOOLEAN NOT NULL DEFAULT true,
        UNIQUE(tracker_id, day)
      );
    `);
  } catch {}

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      is_spoiler BOOLEAN DEFAULT FALSE,
      reply_to UUID REFERENCES messages(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ
    );
  `);
  // Ensure reply_to exists on existing deployments
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to UUID REFERENCES messages(id) ON DELETE SET NULL`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS message_attachments (
      id UUID PRIMARY KEY,
      message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      content_type TEXT,
      name TEXT,
      size_bytes INT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS message_reads (
      message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      seen_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (message_id, user_id)
    );
  `);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_spoiler BOOLEAN DEFAULT FALSE`);
  // Last seen for users
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ`);

  // Per-space user metadata (e.g., nickname per space)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_space_meta (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      nickname TEXT,
      PRIMARY KEY (user_id, space_id)
    );
  `);

  // Reactions per message
  await pool.query(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reaction TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (message_id, user_id, reaction)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS space_members (
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      PRIMARY KEY (space_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invites (
      code TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      max_uses INT DEFAULT 1,
      uses INT DEFAULT 0,
      expires_at TIMESTAMPTZ
    );
  `);

  // Push device tokens for mobile notifications
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_devices (
      token TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS push_devices_user_idx ON push_devices(user_id)`);

  // Web Push subscriptions (VAPID)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS web_push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS web_push_user_idx ON web_push_subscriptions(user_id)`);

  // Ensure default space/channel exist
  await pool.query(`INSERT INTO spaces (id, name)
                    VALUES ('home','Home')
                    ON CONFLICT (id) DO NOTHING`);
  await pool.query(`INSERT INTO channels (id, space_id, name)
                    VALUES ('home:general','home','general')
                    ON CONFLICT (id) DO NOTHING`);
}
