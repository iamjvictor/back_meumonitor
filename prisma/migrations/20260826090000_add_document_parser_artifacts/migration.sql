-- Fase 3: persistência versionada dos artefatos do parser visual.
-- Estas tabelas são internas do worker. RLS fica habilitado sem policies
-- públicas; o backend usa a service_role para ler/escrever os artefatos.

CREATE TABLE "document_parse_runs" (
  "id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "parser_name" TEXT NOT NULL,
  "parser_version" TEXT,
  "parser_backend" TEXT,
  "model_version" TEXT,
  "configuration_hash" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "layout_schema_version" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "quality_score" DOUBLE PRECISION,
  "artifact_manifest_path" TEXT,
  "raw_output_path" TEXT,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "duration_ms" INTEGER,
  "error_code" TEXT,
  "error_message" TEXT,
  "metrics" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "document_parse_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_parse_runs_idempotency_key_key" UNIQUE ("idempotency_key"),
  CONSTRAINT "document_parse_runs_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "monitor_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "document_parse_runs_document_id_created_at_idx"
  ON "document_parse_runs"("document_id", "created_at");
CREATE INDEX "document_parse_runs_document_id_status_idx"
  ON "document_parse_runs"("document_id", "status");
CREATE INDEX "document_parse_runs_document_id_content_hash_configuration_hash_idx"
  ON "document_parse_runs"("document_id", "content_hash", "configuration_hash");

CREATE TABLE "document_layout_elements" (
  "id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "parse_run_id" UUID NOT NULL,
  "external_id" TEXT,
  "page_number" INTEGER NOT NULL,
  "reading_order" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "raw_text" TEXT,
  "normalized_text" TEXT,
  "latex" TEXT,
  "html" TEXT,
  "bbox" JSONB NOT NULL,
  "column_index" INTEGER,
  "confidence" DOUBLE PRECISION,
  "parent_element_id" UUID,
  "asset_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "parser_metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "document_layout_elements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_layout_elements_parse_run_id_external_id_key"
    UNIQUE ("parse_run_id", "external_id"),
  CONSTRAINT "document_layout_elements_parse_run_id_page_number_reading_order_key"
    UNIQUE ("parse_run_id", "page_number", "reading_order"),
  CONSTRAINT "document_layout_elements_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "monitor_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_layout_elements_parse_run_id_fkey"
    FOREIGN KEY ("parse_run_id") REFERENCES "document_parse_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_layout_elements_parent_element_id_fkey"
    FOREIGN KEY ("parent_element_id") REFERENCES "document_layout_elements"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "document_layout_elements_document_id_page_number_reading_order_idx"
  ON "document_layout_elements"("document_id", "page_number", "reading_order");
CREATE INDEX "document_layout_elements_parse_run_id_category_idx"
  ON "document_layout_elements"("parse_run_id", "category");
CREATE INDEX "document_layout_elements_parent_element_id_idx"
  ON "document_layout_elements"("parent_element_id");

CREATE TABLE "document_visual_assets" (
  "id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "parse_run_id" UUID NOT NULL,
  "layout_element_id" UUID,
  "page_number" INTEGER NOT NULL,
  "asset_type" TEXT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "mime_type" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "bbox" JSONB,
  "checksum" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "document_visual_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_visual_assets_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "monitor_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_visual_assets_parse_run_id_fkey"
    FOREIGN KEY ("parse_run_id") REFERENCES "document_parse_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_visual_assets_layout_element_id_fkey"
    FOREIGN KEY ("layout_element_id") REFERENCES "document_layout_elements"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "document_visual_assets_document_id_page_number_asset_type_idx"
  ON "document_visual_assets"("document_id", "page_number", "asset_type");
CREATE INDEX "document_visual_assets_parse_run_id_asset_type_idx"
  ON "document_visual_assets"("parse_run_id", "asset_type");
CREATE INDEX "document_visual_assets_layout_element_id_idx"
  ON "document_visual_assets"("layout_element_id");

CREATE TABLE "document_block_elements" (
  "block_id" UUID NOT NULL,
  "layout_element_id" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "confidence" DOUBLE PRECISION,

  CONSTRAINT "document_block_elements_pkey" PRIMARY KEY ("block_id", "layout_element_id"),
  CONSTRAINT "document_block_elements_block_id_fkey"
    FOREIGN KEY ("block_id") REFERENCES "document_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_block_elements_layout_element_id_fkey"
    FOREIGN KEY ("layout_element_id") REFERENCES "document_layout_elements"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "document_block_elements_layout_element_id_position_idx"
  ON "document_block_elements"("layout_element_id", "position");
CREATE INDEX "document_block_elements_block_id_position_idx"
  ON "document_block_elements"("block_id", "position");

CREATE TABLE "document_evidence_relations" (
  "id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "source_entity_type" TEXT NOT NULL,
  "source_entity_id" UUID NOT NULL,
  "target_entity_type" TEXT NOT NULL,
  "target_entity_id" UUID NOT NULL,
  "relation_type" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "association_method" TEXT,
  "reasons" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "document_evidence_relations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_evidence_relations_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "monitor_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "document_evidence_relations_document_id_relation_type_idx"
  ON "document_evidence_relations"("document_id", "relation_type");
CREATE INDEX "document_evidence_relations_source_entity_type_source_entity_id_idx"
  ON "document_evidence_relations"("source_entity_type", "source_entity_id");
CREATE INDEX "document_evidence_relations_target_entity_type_target_entity_id_idx"
  ON "document_evidence_relations"("target_entity_type", "target_entity_id");

ALTER TABLE "document_parse_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_layout_elements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_visual_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_block_elements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_evidence_relations" ENABLE ROW LEVEL SECURITY;

-- Artefatos do parser são privados e acessados somente pelo worker/service_role.
-- Não criamos policies para anon/authenticated nesta fase.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'document-parser-artifacts',
      'document-parser-artifacts',
      false,
      52428800,
      ARRAY[
        'application/json',
        'text/markdown',
        'application/pdf',
        'image/png',
        'image/jpeg',
        'text/html'
      ]::text[]
    )
    ON CONFLICT (id) DO UPDATE SET
      public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;
