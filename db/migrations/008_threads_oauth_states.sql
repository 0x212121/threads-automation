CREATE TABLE threads_oauth_states (
  state_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES local_users(id),
  session_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX threads_oauth_states_expiry_idx ON threads_oauth_states (expires_at);
