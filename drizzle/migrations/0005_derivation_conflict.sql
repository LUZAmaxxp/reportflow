CREATE TABLE derivation_result (
  result_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  label text NULL,
  operation derivation_operation NOT NULL,
  result_value numeric NOT NULL,
  unit text NOT NULL,
  input_observation_ids uuid[] NOT NULL,
  coverage jsonb NOT NULL,
  fingerprint_hash text NOT NULL,
  stale boolean NOT NULL DEFAULT false,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT derivation_coverage_shape CHECK (coverage ? 'present_periods' AND coverage ? 'expected_periods' AND coverage ? 'fraction'),
  CONSTRAINT derivation_company_fingerprint_unique UNIQUE (company_id, fingerprint_hash)
);
CREATE INDEX derivation_company_idx ON derivation_result (company_id);
CREATE INDEX derivation_fingerprint_idx ON derivation_result (fingerprint_hash);
CREATE INDEX derivation_stale_partial_idx ON derivation_result (company_id, stale) WHERE stale = true;
CREATE INDEX derivation_input_ids_idx ON derivation_result USING gin (input_observation_ids);

CREATE TABLE key_equivalence_cache (
  cache_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  key_pair_hash text NOT NULL UNIQUE,
  key_a text NOT NULL,
  key_b text NOT NULL,
  result key_equivalence_result NOT NULL,
  rationale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX key_equivalence_cache_created_at_idx ON key_equivalence_cache (created_at);

CREATE TABLE conflict_case (
  conflict_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  normalized_key text NOT NULL,
  conflict_group_id uuid NOT NULL,
  match_method conflict_match_method NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  observation_ids uuid[] NOT NULL,
  winning_observation_id uuid NULL REFERENCES observation(observation_id) ON DELETE SET NULL,
  auto_resolved boolean NOT NULL DEFAULT false,
  resolution_status conflict_resolution_status NOT NULL DEFAULT 'auto_resolved',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conflict_case_company_id_idx ON conflict_case (company_id);
CREATE INDEX conflict_case_company_key_idx ON conflict_case (company_id, normalized_key);
CREATE INDEX conflict_case_group_idx ON conflict_case (conflict_group_id);
CREATE INDEX conflict_case_resolution_idx ON conflict_case (company_id, resolution_status);
CREATE INDEX conflict_case_observation_ids_idx ON conflict_case USING gin (observation_ids);
CREATE TRIGGER conflict_case_set_updated_at BEFORE UPDATE ON conflict_case FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE conflict_resolution (
  resolution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_id uuid NOT NULL REFERENCES conflict_case(conflict_id) ON DELETE CASCADE,
  chosen_observation_id uuid NOT NULL REFERENCES observation(observation_id) ON DELETE RESTRICT,
  resolved_by uuid NOT NULL REFERENCES "user"(user_id) ON DELETE RESTRICT,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  reason text NULL,
  CONSTRAINT conflict_resolution_reason_len CHECK (char_length(reason) <= 500)
);
CREATE INDEX conflict_resolution_conflict_id_idx ON conflict_resolution (conflict_id);
