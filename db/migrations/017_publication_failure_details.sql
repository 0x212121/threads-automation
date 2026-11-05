ALTER TABLE publication_attempts ADD COLUMN failure_http_status integer CHECK (failure_http_status BETWEEN 100 AND 599);
ALTER TABLE publication_attempts ADD COLUMN failure_meta_code bigint;
ALTER TABLE publication_attempts ADD COLUMN failure_meta_subcode bigint;
ALTER TABLE publication_attempts ADD COLUMN failure_reason text CHECK (failure_reason IN ('provider_rejected','invalid_response','transport','persistence'));
