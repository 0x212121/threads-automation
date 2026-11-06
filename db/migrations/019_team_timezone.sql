CREATE TABLE team_settings (
  id uuid PRIMARY KEY CHECK (id='00000000-0000-4000-8000-000000000001'),
  time_zone text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0)
);
INSERT INTO team_settings(id,time_zone) VALUES ('00000000-0000-4000-8000-000000000001','Asia/Makassar');
ALTER TABLE audit_events DROP CONSTRAINT audit_events_subject_type_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_subject_type_check CHECK (subject_type IN ('post','member','invitation','threads_account','team_settings'));
