CREATE TABLE report (
  report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  client_id uuid NULL REFERENCES client(client_id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  source_report_id uuid NULL REFERENCES report(report_id) ON DELETE SET NULL,
  language text NOT NULL,
  status report_status NOT NULL DEFAULT 'draft',
  reporting_period_start date NULL,
  reporting_period_end date NULL,
  html_snapshot_r2_key text NOT NULL,
  style_snapshot jsonb NULL,
  pdf_r2_key text NULL,
  observation_ids uuid[] NOT NULL DEFAULT '{}',
  derivation_result_ids uuid[] NOT NULL DEFAULT '{}',
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid NULL REFERENCES "user"(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_company_id_idx ON report (company_id);
CREATE INDEX report_client_partial_idx ON report (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX report_source_partial_idx ON report (source_report_id) WHERE source_report_id IS NOT NULL;
CREATE INDEX report_observation_ids_idx ON report USING gin (observation_ids);
CREATE INDEX report_derivation_ids_idx ON report USING gin (derivation_result_ids);
CREATE INDEX report_company_generated_desc_idx ON report (company_id, generated_at DESC);
CREATE TRIGGER report_set_updated_at BEFORE UPDATE ON report FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE preference_memory_pointer (
  pointer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
  client_id uuid NULL REFERENCES client(client_id) ON DELETE CASCADE,
  mem0_scope_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT preference_pointer_company_user_client_unique UNIQUE (company_id, user_id, client_id)
);
CREATE UNIQUE INDEX preference_pointer_company_user_null_client_unique_idx ON preference_memory_pointer (company_id, user_id) WHERE client_id IS NULL;
CREATE INDEX preference_pointer_user_idx ON preference_memory_pointer (user_id);

CREATE TABLE chat_session (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_session_title_len CHECK (char_length(title) <= 200)
);
CREATE INDEX chat_session_user_created_desc_idx ON chat_session (user_id, created_at DESC);
CREATE INDEX chat_session_company_idx ON chat_session (company_id);
CREATE TRIGGER chat_session_set_updated_at BEFORE UPDATE ON chat_session FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE chat_message (
  message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES chat_session(session_id) ON DELETE CASCADE,
  role chat_role NOT NULL,
  type chat_message_type NOT NULL,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_message_session_created_asc_idx ON chat_message (session_id, created_at ASC);

CREATE TABLE notification (
  notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  user_id uuid NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_unread_partial_idx ON notification (company_id, user_id, read) WHERE read = false;
CREATE INDEX notification_company_created_desc_idx ON notification (company_id, created_at DESC);
