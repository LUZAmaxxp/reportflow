CREATE TABLE pending_manual_observation (
  pending_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES chat_session(session_id) ON DELETE CASCADE,
  status pending_obs_status NOT NULL DEFAULT 'pending',
  prefilled jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + INTERVAL '10 minutes')
);

-- Keep expires_at in sync if created_at is set explicitly
CREATE OR REPLACE FUNCTION set_pending_obs_expires_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.expires_at := NEW.created_at + INTERVAL '10 minutes';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER pending_obs_set_expires_at BEFORE INSERT ON pending_manual_observation FOR EACH ROW EXECUTE FUNCTION set_pending_obs_expires_at();
CREATE INDEX pending_manual_observation_session_idx ON pending_manual_observation (session_id);
CREATE INDEX pending_manual_observation_expiry_pending_partial_idx ON pending_manual_observation (expires_at) WHERE status = 'pending';
CREATE INDEX pending_manual_observation_company_idx ON pending_manual_observation (company_id);

CREATE TABLE audit_log (
  log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  actor_id uuid NULL REFERENCES "user"(user_id) ON DELETE SET NULL,
  "timestamp" timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE RULE no_update_audit_log AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_audit_log AS ON DELETE TO audit_log DO INSTEAD NOTHING;
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_actor_partial_idx ON audit_log (actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX audit_log_timestamp_desc_idx ON audit_log ("timestamp" DESC);

ALTER TABLE company ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE client ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE document ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_block ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE attestation_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE derivation_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_equivalence_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE conflict_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE conflict_resolution ENABLE ROW LEVEL SECURITY;
ALTER TABLE report ENABLE ROW LEVEL SECURITY;
ALTER TABLE preference_memory_pointer ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_manual_observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_client ON client USING (company_id = current_setting('app.current_company_id')::uuid) WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);
CREATE POLICY tenant_isolation_document_category ON document_category USING (company_id = current_setting('app.current_company_id')::uuid) WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);
CREATE POLICY tenant_isolation_document ON document USING (company_id = current_setting('app.current_company_id')::uuid) WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);
CREATE POLICY tenant_isolation_document_version ON document_version USING (company_id = current_setting('app.current_company_id')::uuid) WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);
CREATE POLICY tenant_isolation_evidence_block ON evidence_block USING (company_id = current_setting('app.current_company_id')::uuid) WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);
CREATE POLICY tenant_isolation_pipeline_run ON pipeline_run USING (company_id = current_setting('app.current_company_id')::uuid) WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);
CREATE POLICY tenant_isolation_attestation_record ON attestation_record USING (company_id = current_setting('app.current_company_id')::uuid) WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);
CREATE POLICY tenant_isolation_observation ON observation USING (company_id = current_setting('app.current_company_id')::uuid) WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);
CREATE POLICY tenant_isolation_derivation_result ON derivation_result USING (company_id = current_setting('app.current_company_id')::uuid) WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);
CREATE POLICY tenant_isolation_key_equivalence_cache ON key_equivalence_cache USING (company_id = current_setting('app.current_company_id')::uuid) WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);
CREATE POLICY tenant_isolation_conflict_case ON conflict_case USING (company_id = current_setting('app.current_company_id')::uuid) WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);
CREATE POLICY tenant_isolation_conflict_resolution ON conflict_resolution USING (EXISTS (SELECT 1 FROM conflict_case cc WHERE cc.conflict_id = conflict_resolution.conflict_id AND cc.company_id = current_setting('app.current_company_id')::uuid));
CREATE POLICY tenant_isolation_report ON report USING (company_id = current_setting('app.current_company_id')::uuid) WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);
CREATE POLICY tenant_isolation_preference_memory_pointer ON preference_memory_pointer USING (company_id = current_setting('app.current_company_id')::uuid) WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);
CREATE POLICY tenant_isolation_chat_session ON chat_session USING (company_id = current_setting('app.current_company_id')::uuid) WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);
CREATE POLICY tenant_isolation_chat_message ON chat_message USING (EXISTS (SELECT 1 FROM chat_session cs WHERE cs.session_id = chat_message.session_id AND cs.company_id = current_setting('app.current_company_id')::uuid));
CREATE POLICY tenant_isolation_notification ON notification USING (company_id = current_setting('app.current_company_id')::uuid) WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);
CREATE POLICY tenant_isolation_pending_manual_observation ON pending_manual_observation USING (company_id = current_setting('app.current_company_id')::uuid) WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);
CREATE POLICY tenant_isolation_audit_log ON audit_log USING (company_id = current_setting('app.current_company_id')::uuid) WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);
