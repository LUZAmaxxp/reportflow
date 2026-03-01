CREATE TYPE embedding_status_enum AS ENUM ('pending','completed','failed','skipped');

CREATE TABLE evidence_block (
  block_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_version_id uuid NOT NULL REFERENCES document_version(document_version_id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  page_number integer NOT NULL,
  bbox float8[] NOT NULL,
  text text NOT NULL,
  block_type block_type NOT NULL,
  embedding vector(1536) NULL,
  low_confidence boolean NOT NULL DEFAULT false,
  ocr_confidence float8 NOT NULL,
  chunk_type chunk_type NOT NULL DEFAULT 'original',
  embedding_status embedding_status_enum NOT NULL DEFAULT 'pending',
  merged_block_ids uuid[] NULL,
  parent_block_id uuid NULL REFERENCES evidence_block(block_id) ON DELETE SET NULL,
  doc_date date NULL,
  period_start date NULL,
  period_end date NULL,
  site text NULL,
  supplier text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_block_bbox_len CHECK (array_length(bbox, 1) = 4),
  CONSTRAINT evidence_block_ocr_confidence_range CHECK (ocr_confidence BETWEEN 0.0 AND 1.0)
);
CREATE INDEX evidence_block_document_version_id_idx ON evidence_block (document_version_id);
CREATE INDEX evidence_block_company_id_idx ON evidence_block (company_id);
CREATE INDEX evidence_block_parent_block_partial_idx ON evidence_block (parent_block_id) WHERE parent_block_id IS NOT NULL;
CREATE INDEX evidence_block_merged_block_ids_idx ON evidence_block USING gin (merged_block_ids);
CREATE INDEX evidence_block_text_trgm_idx ON evidence_block USING gin (text gin_trgm_ops);

CREATE TABLE pipeline_run (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_version_id uuid NOT NULL REFERENCES document_version(document_version_id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES company(company_id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  status pipeline_run_status NOT NULL DEFAULT 'running',
  observations_created integer NOT NULL DEFAULT 0,
  observations_skipped integer NOT NULL DEFAULT 0
);
CREATE INDEX pipeline_run_document_version_idx ON pipeline_run (document_version_id);
CREATE INDEX pipeline_run_company_id_idx ON pipeline_run (company_id);
CREATE INDEX pipeline_run_running_partial_idx ON pipeline_run (status) WHERE status = 'running';

SET maintenance_work_mem = '1GB';
CREATE INDEX evidence_block_embedding_hnsw_idx ON evidence_block USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 128);
