// Database migrations. Never edit an existing entry after release — append a new one instead.
// Timestamps are ISO-8601 UTC strings ("2026-10-22T18:00:00.000Z").

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

export const MIGRATIONS = [
  /* 1: initial schema */ `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE campaigns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  game_name TEXT,
  status TEXT NOT NULL DEFAULT 'aktiv',
  config TEXT NOT NULL DEFAULT '{}',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
INSERT INTO campaigns (id, name) VALUES (1, 'Launch');

-- One row per creator (a person), with one or more platform accounts.
CREATE TABLE creators (
  id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  language TEXT,                          -- ISO 639-1, e.g. 'de'
  language_source TEXT,                   -- platform|detected|manual|application
  country TEXT,
  age_group TEXT NOT NULL DEFAULT 'unbekannt',  -- unbekannt|u13|13-15|16-17|18+
  score INTEGER NOT NULL DEFAULT 0,       -- fit score 0..100
  score_details TEXT NOT NULL DEFAULT '{}',
  contact_channel TEXT,                   -- email|dm|discord|none (best legal contact path)
  contact_target TEXT,                    -- email address, profile URL or invite URL
  contact_platform TEXT,                  -- platform for dm (tiktok|instagram|x|twitch)
  contact_locked INTEGER NOT NULL DEFAULT 0,  -- 1 = set manually, do not recompute
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  discord_user_id TEXT UNIQUE,
  discord_tag TEXT,
  creator_code TEXT UNIQUE,
  share_link TEXT,                        -- Roblox share link for this creator
  is_member INTEGER NOT NULL DEFAULT 0,   -- accepted into the creator program
  founding INTEGER NOT NULL DEFAULT 0,
  paid_ok INTEGER NOT NULL DEFAULT 0,     -- may receive paid deals (18+ with agreement)
  parent_consent INTEGER NOT NULL DEFAULT 0,
  source TEXT,                            -- youtube|twitch|capture|import|manual|application
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX idx_creators_score ON creators(score DESC);

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  creator_id INTEGER NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,                 -- youtube|twitch|tiktok|instagram|x|kick
  external_id TEXT,                       -- YouTube channel id / Twitch user id
  handle TEXT,                            -- normalized: lowercase, no '@'
  display_handle TEXT,
  url TEXT,
  followers INTEGER,
  avg_views INTEGER,
  avg_live_viewers REAL,
  max_live_viewers INTEGER,
  times_seen_live INTEGER NOT NULL DEFAULT 0,
  video_count INTEGER,
  uploads_30d INTEGER,
  last_active_at TEXT,
  roblox_share REAL,
  live_share REAL,
  genres TEXT NOT NULL DEFAULT '[]',
  latest_title TEXT,
  latest_url TEXT,
  bio TEXT,
  platform_language TEXT,
  country TEXT,
  channel_created_at TEXT,
  fetched_at TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE UNIQUE INDEX ux_accounts_ext ON accounts(platform, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX ux_accounts_handle ON accounts(platform, handle) WHERE handle IS NOT NULL;
CREATE INDEX idx_accounts_creator ON accounts(creator_id);

CREATE TABLE contacts (
  id INTEGER PRIMARY KEY,
  creator_id INTEGER NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                     -- email|discord|tiktok|instagram|x|twitch|kick|youtube|website
  value TEXT NOT NULL,                    -- normalized value (email lowercase, handle lowercase, invite code)
  label TEXT,                             -- original text / URL
  source TEXT,                            -- e.g. youtube_description, twitch_bio, capture, manual
  is_business INTEGER NOT NULL DEFAULT 0, -- marked as business/collab contact
  dm_invited INTEGER NOT NULL DEFAULT 0,  -- profile explicitly invites business DMs
  created_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE(creator_id, type, value)
);

-- Pipeline state of a creator within a campaign.
CREATE TABLE outreach (
  id INTEGER PRIMARY KEY,
  creator_id INTEGER NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'neu',
  channel TEXT,
  channel_target TEXT,
  channel_platform TEXT,
  template_key TEXT,
  variant TEXT,
  contacted_at TEXT,
  followup_due_at TEXT,
  followups_sent INTEGER NOT NULL DEFAULT 0,
  last_followup_at TEXT,
  snoozed_until TEXT,
  replied_at TEXT,
  reply_sentiment TEXT,                   -- interessiert|fragen|kein_interesse
  invite_code TEXT,
  joined_discord_at TEXT,
  accepted_at TEXT,
  went_live_at TEXT,
  status_changed_at TEXT NOT NULL DEFAULT ${NOW},
  created_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE(creator_id, campaign_id)
);
CREATE INDEX idx_outreach_status ON outreach(campaign_id, status);

CREATE TABLE activity (
  id INTEGER PRIMARY KEY,
  creator_id INTEGER REFERENCES creators(id) ON DELETE CASCADE,
  campaign_id INTEGER,
  type TEXT NOT NULL,                     -- discovered|status|sent|followup_sent|reply|note|joined_discord|application|accepted|live|content|skipped
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX idx_activity_creator ON activity(creator_id, created_at);
CREATE INDEX idx_activity_type ON activity(type, created_at);

-- Opt-outs: only hashes of identifiers are kept so the person is never re-added.
CREATE TABLE suppression (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                     -- email|account
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE templates (
  key TEXT PRIMARY KEY,                   -- step.channel.language.variant, e.g. first.email.de.A
  step TEXT NOT NULL,                     -- first|followup
  channel TEXT NOT NULL,                  -- email|dm|discord
  language TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT 'A',
  subject TEXT,
  body TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  is_custom INTEGER NOT NULL DEFAULT 0,   -- edited by the user (defaults won't overwrite it)
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE api_usage (
  day TEXT NOT NULL,
  api TEXT NOT NULL,                      -- youtube_search|youtube_units|twitch
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, api)
);

CREATE TABLE discovery_runs (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,                   -- youtube|twitch
  params TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'laeuft',  -- laeuft|fertig|fehler|abgebrochen
  found INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  log TEXT NOT NULL DEFAULT '',
  error TEXT,
  started_at TEXT NOT NULL DEFAULT ${NOW},
  finished_at TEXT
);

-- ===== Discord side =====
CREATE TABLE applications (
  id INTEGER PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  discord_tag TEXT,
  creator_id INTEGER REFERENCES creators(id) ON DELETE SET NULL,
  platform TEXT,
  channel_url TEXT,
  followers INTEGER,
  language TEXT,
  age_group TEXT,
  other_links TEXT,
  intro TEXT,
  status TEXT NOT NULL DEFAULT 'offen',   -- offen|eltern_ausstehend|angenommen|abgelehnt|zurueckgezogen
  review_channel_id TEXT,
  review_message_id TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  reject_reason TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX idx_applications_user ON applications(discord_user_id);

CREATE TABLE testers (
  discord_user_id TEXT PRIMARY KEY,
  discord_tag TEXT,
  age_group TEXT,
  status TEXT NOT NULL DEFAULT 'aktiv',   -- aktiv|eltern_ausstehend|entfernt
  creator_id INTEGER REFERENCES creators(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  creator_id INTEGER REFERENCES creators(id) ON DELETE CASCADE,
  campaign_id INTEGER,
  channel_id TEXT,
  uses INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE points_log (
  id INTEGER PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  kind TEXT NOT NULL,                     -- creator|tester
  points INTEGER NOT NULL,
  reason TEXT,
  ref TEXT,                               -- dedupe key, e.g. 'playtest:3:attend'
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE UNIQUE INDEX ux_points_ref ON points_log(discord_user_id, ref) WHERE ref IS NOT NULL;
CREATE INDEX idx_points_kind ON points_log(kind, discord_user_id);

CREATE TABLE content_submissions (
  id INTEGER PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  creator_id INTEGER REFERENCES creators(id) ON DELETE SET NULL,
  url TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'video',     -- video|short|stream
  status TEXT NOT NULL DEFAULT 'offen',   -- offen|bestaetigt|abgelehnt
  review_channel_id TEXT,
  review_message_id TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'event',     -- launch|event
  title TEXT NOT NULL,
  description TEXT,
  starts_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 60,
  repeat_weekly INTEGER NOT NULL DEFAULT 0,
  game_link TEXT,
  channel_id TEXT,
  message_id TEXT,
  ccu_message_id TEXT,
  discord_event_id TEXT,
  ccu_peak INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'geplant', -- geplant|laeuft|beendet|abgesagt
  reminded_24h INTEGER NOT NULL DEFAULT 0,
  reminded_1h INTEGER NOT NULL DEFAULT 0,
  reminded_10m INTEGER NOT NULL DEFAULT 0,
  start_notified INTEGER NOT NULL DEFAULT 0,
  summary_posted INTEGER NOT NULL DEFAULT 0,
  parent_event_id INTEGER,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE ccu_samples (
  id INTEGER PRIMARY KEY,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  playing INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE live_sessions (
  id INTEGER PRIMARY KEY,
  discord_user_id TEXT,
  creator_id INTEGER REFERENCES creators(id) ON DELETE SET NULL,
  platform TEXT,
  url TEXT,
  title TEXT,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual',  -- manual|twitch
  started_at TEXT NOT NULL DEFAULT ${NOW},
  ended_at TEXT
);

CREATE TABLE playtests (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  starts_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 60,
  slots INTEGER,
  join_link TEXT,
  min_age INTEGER NOT NULL DEFAULT 13,
  channel_id TEXT,
  message_id TEXT,
  discord_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'geplant', -- geplant|laeuft|beendet|abgesagt
  reminded_24h INTEGER NOT NULL DEFAULT 0,
  reminded_1h INTEGER NOT NULL DEFAULT 0,
  start_notified INTEGER NOT NULL DEFAULT 0,
  feedback_requested INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE playtest_signups (
  playtest_id INTEGER NOT NULL REFERENCES playtests(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'angemeldet', -- angemeldet|warteliste|abgemeldet|teilgenommen
  created_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (playtest_id, discord_user_id)
);

CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  playtest_id INTEGER REFERENCES playtests(id) ON DELETE SET NULL,
  discord_user_id TEXT NOT NULL,
  fun_rating INTEGER,
  liked TEXT,
  disliked TEXT,
  bugs TEXT,
  other TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE UNIQUE INDEX ux_feedback ON feedback(playtest_id, discord_user_id) WHERE playtest_id IS NOT NULL;

CREATE TABLE bugs (
  id INTEGER PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  steps TEXT,
  device TEXT,
  status TEXT NOT NULL DEFAULT 'neu',     -- neu|bestaetigt|duplikat|kein_bug|behoben
  channel_id TEXT,
  message_id TEXT,
  thread_id TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
`,
];
