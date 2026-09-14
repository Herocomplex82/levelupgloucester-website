-- migrations/0001_init.sql

CREATE TABLE baskets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  image_path TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE raffle_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  basket_id INTEGER NOT NULL REFERENCES baskets(id),
  donor_name TEXT NOT NULL,
  donor_email TEXT NOT NULL,
  ticket_count INTEGER NOT NULL,
  entry_method TEXT NOT NULL CHECK (entry_method IN ('paid', 'free_mail_in')),
  stripe_session_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE workshop_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,
  location TEXT NOT NULL,
  price_full_cents INTEGER NOT NULL,
  price_half_cents INTEGER NOT NULL,
  capacity INTEGER NOT NULL,
  seats_taken INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workshop_day_id INTEGER NOT NULL REFERENCES workshop_days(id),
  child_name TEXT NOT NULL,
  child_dob TEXT NOT NULL,
  parent_name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  emergency_contact_name TEXT NOT NULL,
  emergency_contact_phone TEXT NOT NULL,
  allergies_medical TEXT,
  waiver_accepted INTEGER NOT NULL,
  waiver_signature_name TEXT NOT NULL,
  waiver_timestamp TEXT NOT NULL,
  photo_release INTEGER NOT NULL,
  registration_type TEXT NOT NULL CHECK (registration_type IN ('full','half')),
  promo_code_used TEXT,
  amount_paid_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','expired')),
  stripe_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  donor_name TEXT NOT NULL,
  donor_email TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  designation TEXT NOT NULL CHECK (designation IN ('general','sponsor_a_child')),
  stripe_session_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_address TEXT NOT NULL,
  attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_login_attempts_ip_time ON login_attempts(ip_address, attempted_at);
