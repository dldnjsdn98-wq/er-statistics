CREATE TABLE IF NOT EXISTS players (
  uid text PRIMARY KEY,
  nickname text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS players_nickname_seen_idx ON players (nickname, last_seen_at DESC);
CREATE TABLE IF NOT EXISTS player_games (
  uid text NOT NULL REFERENCES players(uid),
  game_id text NOT NULL,
  started_at timestamptz NOT NULL,
  character_code integer NOT NULL,
  matching_mode integer,
  game_rank integer,
  kills integer,
  assists integer,
  deaths integer,
  damage_to_player double precision,
  play_time_seconds integer,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (uid, game_id)
);
CREATE INDEX IF NOT EXISTS player_games_uid_started_idx ON player_games (uid, started_at DESC);
CREATE INDEX IF NOT EXISTS player_games_uid_character_started_idx ON player_games (uid, character_code, started_at DESC);
CREATE TABLE IF NOT EXISTS sync_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  uid text NOT NULL REFERENCES players(uid),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL,
  record_count integer NOT NULL DEFAULT 0,
  dropped_records integer NOT NULL DEFAULT 0,
  completeness text NOT NULL DEFAULT 'partial',
  timestamp_policy text,
  error_code text
);
CREATE INDEX IF NOT EXISTS sync_runs_uid_finished_idx ON sync_runs (uid, finished_at DESC);
