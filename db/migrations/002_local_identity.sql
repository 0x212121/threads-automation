CREATE TABLE local_users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'reviewer', 'editor')),
  email_verified_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bootstrap_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  initial_admin_id uuid NOT NULL REFERENCES local_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
