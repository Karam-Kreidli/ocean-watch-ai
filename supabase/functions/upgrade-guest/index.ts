// Turns the caller's guest (anonymous) account into a normal email + password account,
// keeping the same user id so their uploads and results stay theirs. Supabase's own
// updateUser() can't do this while email confirmation is off: it still mails a change link
// and refuses a password until it's clicked. The admin API sets a confirmed email directly.
import { createClient } from "npm:@supabase/supabase-js@2.105.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const reply = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user?.is_anonymous) return reply(403, { error: "Only a guest session can be upgraded." });

  const { email, password, data } = await req.json().catch(() => ({}));
  if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email.trim()))
    return reply(400, { error: "Enter a valid email address." });
  if (typeof password !== "string" || password.length < 6)
    return reply(400, { error: "Password must be at least 6 characters." });

  // auth answers a taken email with a bare "Error updating user"
  const addr = email.trim().toLowerCase();
  const { data: taken } = await admin.from("profiles").select("id").eq("email", addr).limit(1);
  if (taken?.length) return reply(409, { error: "This email already has an account. Log in instead.", code: "email_exists" });

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    email: addr,
    password,
    email_confirm: true,
    user_metadata: {   // only the sign-up fields; the trigger copies them into profiles
      phone: String(data?.phone ?? ""),
      gender: String(data?.gender ?? ""),
      organization: String(data?.organization ?? ""),
      accepted_terms: data?.accepted_terms === true,
    },
  });
  if (error) return reply(400, { error: error.message, code: error.code });
  return reply(200, { ok: true });
});
