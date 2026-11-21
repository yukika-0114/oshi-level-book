// 推しレベル帳：アプリデータ（localStorage の内容）のバックアップ保存・復元
// action: "save" { data, client_ts } / "load" → { data, client_ts }
// client_ts（端末側の最終更新時刻）より古い保存は受け付けない（新しいデータを守る）
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

  const keyRaw = String(body.key || "main");
  const key = /^[a-zA-Z0-9-]{1,64}$/.test(keyRaw) ? keyRaw : "main";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (body.action === "load") {
    const { data: row, error } = await supabase
      .from("app_backups").select("data, client_ts").eq("key", key).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, data: row?.data ?? null, client_ts: row?.client_ts ?? 0 });
  }

  if (body.action === "save") {
    const data = body.data as { users?: unknown } | null;
    if (!data || typeof data !== "object" || !Array.isArray(data.users)) {
      return json({ error: "invalid data" }, 400);
    }
    if (JSON.stringify(data).length > 2_000_000) return json({ error: "too large" }, 413);
    const clientTs = Number(body.client_ts) || 0;

    const { data: existing, error: selErr } = await supabase
      .from("app_backups").select("client_ts").eq("key", key).maybeSingle();
    if (selErr) return json({ error: selErr.message }, 500);
    if (existing && Number(existing.client_ts) > clientTs) {
      return json({ ok: true, saved: false, reason: "newer-exists", client_ts: Number(existing.client_ts) });
    }
    const { error } = await supabase.from("app_backups").upsert(
      { key, data, client_ts: clientTs, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, saved: true, client_ts: clientTs });
  }

  return json({ error: "unknown action" }, 400);
});
