-- send-due を毎分呼ぶ（<PROJECT_REF> / <CRON_SECRET> / <ANON_KEY> は実際の値に置き換えて実行済み）
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('oshi-send-due', '* * * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-due',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <ANON_KEY>',
      'apikey', '<ANON_KEY>',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
$$);
