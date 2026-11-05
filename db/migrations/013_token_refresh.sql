ALTER TABLE threads_accounts ADD COLUMN refresh_lease uuid;
ALTER TABLE threads_accounts ADD COLUMN refresh_lease_until timestamptz;
ALTER TABLE threads_accounts ADD COLUMN refresh_next_attempt_at timestamptz;
ALTER TABLE threads_accounts ADD COLUMN refresh_failures integer NOT NULL DEFAULT 0 CHECK (refresh_failures >= 0);
ALTER TABLE threads_accounts ADD COLUMN refresh_status text NOT NULL DEFAULT 'ok' CHECK (refresh_status IN ('ok','retry','reconnect'));
ALTER TABLE threads_accounts ADD COLUMN token_issued_at timestamptz;
