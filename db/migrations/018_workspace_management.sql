ALTER TABLE content_posts ADD COLUMN deleted_at timestamptz;
ALTER TABLE content_posts ADD COLUMN deleted_by uuid;
CREATE INDEX content_posts_visible_idx ON content_posts(created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  action text NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('post','member','invitation','threads_account')),
  subject_id uuid NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_time_idx ON audit_events(created_at DESC,id DESC);
CREATE INDEX audit_events_subject_idx ON audit_events(subject_type,subject_id,created_at DESC);
