CREATE TABLE app_sessions (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamptz(6) NOT NULL
);
CREATE INDEX app_sessions_expire_idx ON app_sessions (expire);
