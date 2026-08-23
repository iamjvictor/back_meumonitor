alter table public.document_blocks
  add column if not exists is_complete boolean not null default true,
  add column if not exists incomplete_reason text;

create index if not exists document_blocks_complete_chunking_idx
  on public.document_blocks (document_id, document_text_id, is_complete, block_index);

alter table public.monitor_documents
  drop constraint if exists monitor_documents_processing_version_check;

alter table public.monitor_documents
  alter column processing_version set default 4;

alter table public.monitor_documents
  add constraint monitor_documents_processing_version_check
  check (processing_version in (1, 2, 3, 4));
