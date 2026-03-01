CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE user_role AS ENUM ('admin','editor','viewer');
CREATE TYPE detected_doc_type AS ENUM ('sustainability_report','energy_bill','hr_report','financial_statement','other');
CREATE TYPE pipeline_status AS ENUM ('uploaded','ocr_processing','ocr_done','embedding','embedded','extracting','review_ready','failed');
CREATE TYPE block_type AS ENUM ('paragraph','table_cell','header','list_item','figure_caption','other');
CREATE TYPE chunk_type AS ENUM ('original','merged','split','superseded');
CREATE TYPE observation_status AS ENUM ('candidate','approved','rejected','superseded','invalidated');
CREATE TYPE data_type_enum AS ENUM ('numeric','percentage','text','boolean');
CREATE TYPE time_behavior_enum AS ENUM ('periodic','point_in_time','none');
CREATE TYPE provenance_type_enum AS ENUM ('document','manual');
CREATE TYPE derivation_operation AS ENUM ('sum','average','delta','ratio','count');
CREATE TYPE conflict_match_method AS ENUM ('exact','semantic');
CREATE TYPE conflict_resolution_status AS ENUM ('auto_resolved','user_reviewed','user_overridden');
CREATE TYPE report_status AS ENUM ('draft','final');
CREATE TYPE pipeline_run_status AS ENUM ('running','completed','failed');
CREATE TYPE notification_type AS ENUM ('pipeline_completed','pipeline_failed','conflict_detected','report_ready','manual_obs_requested');
CREATE TYPE chat_role AS ENUM ('user','assistant','tool');
CREATE TYPE chat_message_type AS ENUM ('user_text','agent_text','agent_tool_call','manual_obs_request','report_ready','error');
CREATE TYPE key_equivalence_result AS ENUM ('SAME_KEY','DIFFERENT_KEY');
CREATE TYPE pending_obs_status AS ENUM ('pending','confirmed','skipped','timed_out');

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE company (
  company_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "user" (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role user_role NOT NULL DEFAULT 'viewer',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_company_id_idx ON "user" (company_id);

CREATE TABLE client (
  client_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES "user"(user_id) ON DELETE SET NULL
);
CREATE INDEX client_company_id_idx ON client (company_id);

CREATE TRIGGER company_set_updated_at BEFORE UPDATE ON company FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER user_set_updated_at BEFORE UPDATE ON "user" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER client_set_updated_at BEFORE UPDATE ON client FOR EACH ROW EXECUTE FUNCTION set_updated_at();
