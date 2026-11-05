CREATE TABLE content_version_replies (
  post_id uuid NOT NULL,
  version integer NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 9),
  body text NOT NULL CHECK (length(trim(body)) > 0),
  PRIMARY KEY (post_id,version,position),
  FOREIGN KEY (post_id,version) REFERENCES content_versions(post_id,version)
);
ALTER TABLE publication_jobs ADD COLUMN part_index integer NOT NULL DEFAULT 0 CHECK (part_index BETWEEN 0 AND 9);
ALTER TABLE publication_jobs ADD COLUMN reply_to_id text;
CREATE TABLE publication_parts (
  job_id uuid NOT NULL REFERENCES publication_jobs(id),
  position integer NOT NULL CHECK (position BETWEEN 0 AND 9),
  status text NOT NULL CHECK (status IN ('publishing','published','uncertain','not_published')),
  published_id text,
  PRIMARY KEY (job_id,position)
);
CREATE TABLE publication_resumptions (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES publication_jobs(id),
  resumed_by uuid NOT NULL REFERENCES local_users(id),
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
