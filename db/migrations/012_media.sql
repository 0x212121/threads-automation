CREATE TABLE media_assets (
  id uuid PRIMARY KEY,
  uploaded_by uuid NOT NULL REFERENCES local_users(id),
  kind text NOT NULL CHECK (kind IN ('IMAGE','VIDEO')),
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  width integer NOT NULL,
  height integer NOT NULL,
  duration_seconds double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE media_storage_lock (id integer PRIMARY KEY CHECK (id=1));
INSERT INTO media_storage_lock VALUES (1);
ALTER TABLE content_versions ADD COLUMN media_id uuid REFERENCES media_assets(id);
ALTER TABLE content_versions DROP CONSTRAINT content_versions_body_check;
ALTER TABLE content_versions ADD CONSTRAINT content_versions_body_check CHECK (length(trim(body)) > 0 OR media_id IS NOT NULL);
ALTER TABLE publication_jobs ADD COLUMN status_check_failures integer NOT NULL DEFAULT 0 CHECK (status_check_failures >= 0);
