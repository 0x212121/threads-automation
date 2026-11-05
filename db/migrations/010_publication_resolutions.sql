ALTER TABLE publication_jobs DROP CONSTRAINT publication_jobs_status_check;
ALTER TABLE publication_jobs ADD CONSTRAINT publication_jobs_status_check CHECK (status IN ('scheduled', 'preparing', 'prepared', 'publishing', 'published', 'confirmed_published', 'uncertain', 'needs_action', 'cancelled'));
DROP INDEX publication_jobs_single_active_post;
CREATE UNIQUE INDEX publication_jobs_single_active_post ON publication_jobs(post_id)
  WHERE status IN ('scheduled', 'preparing', 'prepared', 'publishing', 'published', 'confirmed_published', 'uncertain');

CREATE TABLE publication_resolutions (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES publication_jobs(id),
  resolved_by uuid NOT NULL REFERENCES local_users(id),
  decision text NOT NULL CHECK (decision IN ('published', 'not_published')),
  created_at timestamptz NOT NULL DEFAULT now()
);
