// 推しレベル帳：pg_cron から毎分呼ばれ、指定時刻になった登録へプッシュ通知を送る
// テスト送信: { "test": true, "endpoint": "..." } でその登録先にだけ即時送信する
// 送信ライブラリは WebCrypto ベースの @daaku/webpush（npm:web-push は Edge Runtime で起動できなかったため）
import { createClient } from "jsr:@supabase/supabase-js@2";
// @ts-ignore JSR specifier
import { send } from "jsr:@daaku/webpush@0.2.0";

/* Supabase Edge Runtime には Uint8Array の base64 変換メソッドが無いため補う
 * （@daaku/webpush が内部で使う。呼び出し時点までに定義されていればよい） */
if (typeof (Uint8Array as unknown as Record<string, unknown>).fromBase64 !== "function") {
  (Uint8Array as unknown as Record<string, unknown>).fromBase64 = (input: string) => {
    let s = String(input).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  };
}
if (typeof (Uint8Array.prototype as unknown as Record<string, unknown>).toBase64 !== "function") {
  (Uint8Array.prototype as unknown as Record<string, unknown>).toBase64 = function (opts?: { alphabet?: string; omitPadding?: boolean }) {
    let bin = "";
    for (const b of this as Uint8Array) bin += String.fromCharCode(b);
    let out = btoa(bin);
    if (opts?.alphabet === "base64url") out = out.replace(/\+/g, "-").replace(/\//g, "_");
    if (opts?.omitPadding) out = out.replace(/=+$/, "");
    return out;
  };
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function localNow(tz: string) {
  const now = new Date();
  let hm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  if (hm.startsWith("24")) hm = "00" + hm.slice(2);
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return { hm, ymd };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* 空bodyは通常モード */ }

  const isTest = body.test === true;
  if (!isTest && req.headers.get("x-cron-secret") !== Deno.env.get("PUSH_CRON_SECRET")) {
    return json({ error: "unauthorized" }, 401);
  }

  // VAPID_PRIVATE_KEY には JWK（JSON文字列）を入れてある
  const vapid = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
  if (!vapid) return json({ error: "vapid key not set" }, 500);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let query = supabase.from("push_subscriptions").select("*");
  if (isTest) query = query.eq("endpoint", String(body.endpoint || ""));
  else query = query.eq("enabled", true);
  const { data: subs, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const results: Record<string, unknown>[] = [];
  for (const s of subs || []) {
    const { hm, ymd } = localNow(s.timezone || "Asia/Tokyo");
    if (!isTest) {
      const dueDay = s.has_pending || (Array.isArray(s.notify_dates) && s.notify_dates.includes(ymd));
      if (s.notify_time !== hm || !dueDay || s.last_sent_date === ymd) continue;
    }
    const payload = JSON.stringify(isTest
      ? { title: "増加の確認", body: "サーバーからのテスト通知です。届いていれば成功です。", tag: "oshi-test", url: "./?openPending=1" }
      : { title: "増加の確認", body: s.pending_summary || "増加の確認があります", tag: `oshi-pending-${ymd}`, url: "./?openPending=1" });
    try {
      await send(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { vapid, subscriber: subject, ttl: 86400 },
      );
      if (!isTest) await supabase.from("push_subscriptions").update({ last_sent_date: ymd }).eq("endpoint", s.endpoint);
      results.push({ endpoint: s.endpoint.slice(0, 60), sent: true });
    } catch (e) {
      const err = e as { statusCode?: number; permanent?: boolean; message?: string };
      const code = err?.statusCode;
      if (code === 404 || code === 410 || err?.permanent) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        results.push({ endpoint: s.endpoint.slice(0, 60), sent: false, removed: true, statusCode: code || null });
      } else {
        results.push({ endpoint: s.endpoint.slice(0, 60), sent: false, statusCode: code || null, error: String(err?.message || e).slice(0, 200) });
      }
    }
  }
  return json({ ok: true, test: isTest, checked: (subs || []).length, results });
});
