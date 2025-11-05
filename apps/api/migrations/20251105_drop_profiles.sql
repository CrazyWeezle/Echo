-- Drop deprecated profiles table and related columns
DO $$ BEGIN
  PERFORM 1 FROM information_schema.tables WHERE table_name = 'profiles';
  IF FOUND THEN
    EXECUTE 'DROP TABLE IF EXISTS profiles CASCADE';
  END IF;
END $$;

