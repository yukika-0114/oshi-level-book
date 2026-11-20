-- 推しレベル帳：プッシュ通知の登録先
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  notify_time text not null default '21:00',
  timezone text not null default 'Asia/Tokyo',
  enabled boolean not null default true,
  has_pending boolean not null default false,
  notify_dates date[] not null default '{}',
  pending_summary text,
  last_sent_date date,
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
-- ポリシーは作らない（Edge Functions が service_role で読み書きする。anon/authenticated からは直接触れない）
