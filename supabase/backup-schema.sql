-- 推しレベル帳：アプリデータのバックアップ保存先
create table if not exists public.app_backups (
  key text primary key,
  data jsonb not null,
  client_ts bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.app_backups enable row level security;
grant all privileges on table public.app_backups to service_role;
