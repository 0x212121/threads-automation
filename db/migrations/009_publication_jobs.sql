CREATE TABLE publication_jobs (
  id uuid PRIMARY KEY,
  post_id uuid NOT NULL,
  content_version integer NOT NULL,
  account_id uuid NOT NULL REFERENCES threads_accounts(id),
  requested_by uuid NOT NULL REFERENCES local_users(id),
  scheduled_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('scheduled', 'preparing', 'prepared', 'publishing', 'published', 'uncertain', 'needs_action', 'cancelled')),
  lease_token uuid,
  lease_until timestamptz,
  container_id text,
  published_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (post_id, content_version) REFERENCES content_versions(post_id, version),
  CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  CHECK (status <> 'published' OR published_id IS NOT NULL)
);
CREATE UNIQUE INDEX publication_jobs_single_active_post ON publication_jobs(post_id)
  WHERE status IN ('scheduled', 'preparing', 'prepared', 'publishing', 'published', 'uncertain');
CREATE INDEX publication_jobs_due_idx ON publication_jobs(status, next_attempt_at);

CREATE TABLE publication_attempts (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES publication_jobs(id),
  stage text NOT NULL CHECK (stage IN ('prepare', 'publish')),
  outcome text NOT NULL CHECK (outcome IN ('started', 'succeeded', 'safe_failure', 'uncertain')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX publication_attempts_job_idx ON publication_attempts(job_id, created_at);
