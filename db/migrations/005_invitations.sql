CREATE TABLE team_invitations (
  id uuid PRIMARY KEY,
  email text NOT NULL CHECK (email = lower(email)),
  role text NOT NULL CHECK (role IN ('admin', 'reviewer', 'editor')),
  token_hash text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES local_users(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX team_invitations_active_email_idx ON team_invitations(email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
