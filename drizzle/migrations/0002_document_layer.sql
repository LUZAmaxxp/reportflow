CREATE TABLE document_category (
  category_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NULL,
  parent_category_id uuid NULL REFERENCES document_category(category_id) ON DELETE RESTRICT,
  path text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES "user"(user_id) ON DELETE SET NULL,
  CONSTRAINT document_category_path_non_empty CHECK (path <> '')
);
CREATE INDEX document_category_company_id_idx ON document_category (company_id);
CREATE INDEX document_category_parent_id_idx ON document_category (parent_category_id);
CREATE INDEX document_category_path_trgm_idx ON document_category USING gin (path gin_trgm_ops);
CREATE TRIGGER document_category_set_updated_at BEFORE UPDATE ON document_category FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE document (
  document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  category_id uuid NULL REFERENCES document_category(category_id) ON DELETE SET NULL,
  title text NOT NULL,
  detected_type detected_doc_type NOT NULL DEFAULT 'other',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES "user"(user_id) ON DELETE SET NULL
);
CREATE INDEX document_company_id_idx ON document (company_id);
CREATE INDEX document_category_id_idx ON document (category_id);
CREATE INDEX document_title_trgm_idx ON document USING gin (title gin_trgm_ops);
CREATE TRIGGER document_set_updated_at BEFORE UPDATE ON document FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE document_version (
  document_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES document(document_id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  file_hash text NOT NULL,
  object_key text NOT NULL,
  original_filename text NOT NULL,
  page_count integer NOT NULL,
  file_size_bytes bigint NOT NULL,
  pipeline_status pipeline_status NOT NULL DEFAULT 'uploaded',
  pipeline_status_updated_at timestamptz NOT NULL DEFAULT now(),
  pipeline_error_message text NULL,
  ocr_quality_warning boolean NOT NULL DEFAULT false,
  detected_type detected_doc_type NOT NULL DEFAULT 'other',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES "user"(user_id) ON DELETE SET NULL
);
CREATE INDEX document_version_document_id_idx ON document_version (document_id);
CREATE INDEX document_version_company_id_idx ON document_version (company_id);
CREATE INDEX document_version_pipeline_status_partial_idx ON document_version (pipeline_status) WHERE pipeline_status NOT IN ('review_ready','failed');
