ALTER TABLE publication_parts ADD COLUMN container_id text;
ALTER TABLE publication_parts ADD COLUMN provider_response_id text;

CREATE TABLE publication_reference_repairs (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL,
  position integer NOT NULL CHECK (position=0),
  previous_id text NOT NULL,
  corrected_id text NOT NULL,
  verified_permalink text NOT NULL,
  source text NOT NULL CHECK (source='server_cli'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (previous_id<>corrected_id),
  FOREIGN KEY (job_id,position) REFERENCES publication_parts(job_id,position)
);
