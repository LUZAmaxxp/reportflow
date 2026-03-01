CREATE TABLE attestation_record (
  attestation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES "user"(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  note text NULL,
  source_reference text NULL,
  upgraded_by_observation_id uuid NULL,
  CONSTRAINT attestation_note_len CHECK (char_length(note) <= 1000),
  CONSTRAINT attestation_source_ref_len CHECK (char_length(source_reference) <= 500)
);
CREATE INDEX attestation_company_id_idx ON attestation_record (company_id);
CREATE INDEX attestation_upgraded_partial_idx ON attestation_record (upgraded_by_observation_id) WHERE upgraded_by_observation_id IS NOT NULL;

CREATE TABLE observation (
  observation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  label text NOT NULL,
  normalized_key text NOT NULL,
  value text NOT NULL,
  numeric_value numeric NULL,
  unit text NOT NULL DEFAULT '',
  data_type data_type_enum NOT NULL,
  time_behavior time_behavior_enum NOT NULL,
  period_start date NULL,
  period_end date NULL,
  category_id uuid NULL REFERENCES document_category(category_id) ON DELETE SET NULL,
  source_document_version_id uuid NULL REFERENCES document_version(document_version_id) ON DELETE RESTRICT,
  status observation_status NOT NULL DEFAULT 'candidate',
  provenance_type provenance_type_enum NOT NULL,
  evidence_block_ids uuid[] NOT NULL DEFAULT '{}',
  attestation_record_id uuid NULL REFERENCES attestation_record(attestation_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  confidence_score float8 NULL,
  extraction_run_id uuid NULL REFERENCES pipeline_run(run_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES "user"(user_id) ON DELETE SET NULL,
  CONSTRAINT observation_confidence_range CHECK (confidence_score BETWEEN 0.0 AND 1.0),
  CONSTRAINT observation_document_requires_evidence CHECK (provenance_type <> 'document' OR array_length(evidence_block_ids,1) > 0),
  CONSTRAINT observation_manual_requires_attestation CHECK (provenance_type <> 'manual' OR attestation_record_id IS NOT NULL)
);
CREATE INDEX observation_company_key_status_idx ON observation (company_id, normalized_key, status);
CREATE INDEX observation_company_period_idx ON observation (company_id, period_start, period_end);
CREATE INDEX observation_source_doc_partial_idx ON observation (source_document_version_id) WHERE source_document_version_id IS NOT NULL;
CREATE INDEX observation_category_partial_idx ON observation (category_id) WHERE category_id IS NOT NULL;
CREATE INDEX observation_attestation_partial_idx ON observation (attestation_record_id) WHERE attestation_record_id IS NOT NULL;
CREATE INDEX observation_evidence_ids_idx ON observation USING gin (evidence_block_ids);
CREATE INDEX observation_normalized_key_trgm_idx ON observation USING gin (normalized_key gin_trgm_ops);
CREATE TRIGGER observation_set_updated_at BEFORE UPDATE ON observation FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE attestation_record
  ADD CONSTRAINT attestation_upgraded_by_observation_fk
  FOREIGN KEY (upgraded_by_observation_id) REFERENCES observation(observation_id)
  ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
