
create table if not exists public.image_index (
  id bigint generated always as identity primary key,
  sha256 text unique not null,
  telegram_chat_id text not null,
  telegram_message_id bigint not null,
  telegram_file_id text not null,
  filename text not null,
  mime_type text not null,
  file_size bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists image_index_created_at_idx
  on public.image_index (created_at desc);

alter table public.image_index enable row level security;

-- No public policies. Access is through the trusted backend only.
