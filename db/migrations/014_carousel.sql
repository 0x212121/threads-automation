CREATE TABLE content_version_media (
  post_id uuid NOT NULL,
  version integer NOT NULL,
  position integer NOT NULL CHECK (position >= 0 AND position < 10),
  media_id uuid NOT NULL REFERENCES media_assets(id),
  PRIMARY KEY (post_id, version, position),
  UNIQUE (post_id, version, media_id),
  FOREIGN KEY (post_id, version) REFERENCES content_versions(post_id, version)
);
INSERT INTO content_version_media (post_id,version,position,media_id)
  SELECT post_id,version,0,media_id FROM content_versions WHERE media_id IS NOT NULL;
CREATE TABLE publication_carousel_items (
  job_id uuid NOT NULL REFERENCES publication_jobs(id),
  position integer NOT NULL CHECK (position >= 0 AND position < 10),
  media_id uuid NOT NULL REFERENCES media_assets(id),
  container_id text NOT NULL,
  PRIMARY KEY (job_id,position)
);
