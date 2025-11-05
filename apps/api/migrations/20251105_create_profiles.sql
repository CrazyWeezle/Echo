-- Profiles table for canonical user profile data
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  banner_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Optional: backfill from users table
-- INSERT INTO profiles(id, user_id, display_name, bio, avatar_url, banner_url)
-- SELECT gen_random_uuid(), u.id, u.name, u.bio, u.avatar_url, u.banner_url
-- FROM users u
-- LEFT JOIN profiles p ON p.user_id = u.id
-- WHERE p.user_id IS NULL;

