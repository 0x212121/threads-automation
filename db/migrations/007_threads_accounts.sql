CREATE TABLE threads_accounts (
  id uuid PRIMARY KEY,
  threads_user_id text NOT NULL UNIQUE,
  username text NOT NULL,
  connected_by uuid NOT NULL REFERENCES local_users(id),
  encrypted_token bytea,
  token_iv bytea,
  token_tag bytea,
  token_expires_at timestamptz,
  status text NOT NULL CHECK (status IN ('active', 'disconnected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'active' AND encrypted_token IS NOT NULL AND token_iv IS NOT NULL AND token_tag IS NOT NULL) OR
         (status = 'disconnected' AND encrypted_token IS NULL AND token_iv IS NULL AND token_tag IS NULL))
);
ALTER TABLE content_versions ADD CONSTRAINT content_destination_account_fk FOREIGN KEY (destination_account_id) REFERENCES threads_accounts(id);
