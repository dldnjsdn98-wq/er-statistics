-- Preserve the interpretation used when a match was first normalized.
-- Existing rows cannot safely be inferred from the latest sync's policy.
BEGIN;
ALTER TABLE player_games ADD COLUMN IF NOT EXISTS timestamp_policy text NOT NULL DEFAULT 'unknown';
COMMIT;
