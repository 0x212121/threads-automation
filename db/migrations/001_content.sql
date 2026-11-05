CREATE TABLE content_posts (
  id uuid PRIMARY KEY,
  created_by uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  current_version integer NOT NULL CHECK (current_version > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content_versions (
  post_id uuid NOT NULL REFERENCES content_posts(id),
  version integer NOT NULL CHECK (version > 0),
  body text NOT NULL CHECK (length(trim(body)) > 0),
  destination_account_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, version)
);

ALTER TABLE content_posts ADD CONSTRAINT content_current_version_fk
  FOREIGN KEY (id, current_version) REFERENCES content_versions(post_id, version)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE content_reviews (
  id uuid PRIMARY KEY,
  post_id uuid NOT NULL,
  content_version integer NOT NULL,
  reviewer_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (post_id, content_version) REFERENCES content_versions(post_id, version)
);

CREATE INDEX content_reviews_post_idx ON content_reviews (post_id, created_at);
