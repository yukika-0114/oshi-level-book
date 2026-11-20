// 推しレベル帳：プッシュ通知の登録・更新・削除を受け付ける
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const endpoint = String(body.endpoint || "");
  if (!endpoint.startsWith("https://")) return json({ error: "invalid endpoint" }, 400);

  if (body.action === "delete") {
    const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, deleted: true });
  }

  const p256dh = String(body.p256dh || "");
  const auth = String(body.auth || "");
  if (!p256dh || !auth) return json({ error: "missing keys" }, 400);

  const row = {
    endpoint,
    p256dh,
    auth,
    notify_time: /^\d{2}:\d{2}$/.test(String(body.notify_time || "")) ? String(body.notify_time) : "21:00",
    timezone: String(body.timezone || "Asia/Tokyo"),
    enabled: body.enabled !== false,
    has_pending: body.has_pending === true,
    notify_dates: Array.isArray(body.notify_dates) ? body.notify_dates.map(String).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [],
    pending_summary: body.pending_summary ? String(body.pending_summary).slice(0, 200) : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("push_subscriptions").upsert(row, { onConflict: "endpoint" });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
});
