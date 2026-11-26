// Edge function: proxy autenticado hacia las APIs de Render (datos SAP).
// Solo usuarios con sesión válida de Supabase y correo @panovo.mx.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_DOMAIN = "@panovo.mx";

// Lista fija: el cliente solo manda una clave, nunca una URL (evita SSRF).
const RECURSOS: Record<string, string> = {
  inv_pal3: "https://api-inventarios-pw9d.onrender.com/inventarios/pal3",
  inv_pal4: "https://api-inventarios-pw9d.onrender.com/inventarios/pal4",
  ped_pal3: "https://pedidos-4c2n.onrender.com/Pedidos/pal3",
  ped_pal4: "https://pedidos-4c2n.onrender.com/Pedidos/pal4",
  materiales: "https://costeo-panovo.onrender.com/mm60",
  recetas: "https://api-recetas-ex5x.onrender.com/RECETAS",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // 1) Autenticación: token de sesión de Supabase
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return json({ error: "unauthorized" }, 401);

  // 2) Autorización: solo cuentas @panovo.mx (aquí sí se valida en el servidor)
  const email = (data.user.email ?? "").toLowerCase();
  if (!email.endsWith(ALLOWED_DOMAIN)) return json({ error: "forbidden" }, 403);

  // 3) Recurso solicitado, solo de la lista fija
  let recurso: unknown;
  try {
    ({ recurso } = await req.json());
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (typeof recurso !== "string" || !Object.hasOwn(RECURSOS, recurso)) {
    return json({ error: "bad_request" }, 400);
  }

  // 4) Llamada a Render con el secreto (si ya está configurado)
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = Deno.env.get("RENDER_API_KEY");
  if (apiKey) headers["X-Api-Key"] = apiKey;

  try {
    const upstream = await fetch(RECURSOS[recurso], { headers, redirect: "error" });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch {
    // Sin detalles: no filtrar URLs internas ni errores de red al cliente
    return json({ error: "upstream_error" }, 502);
  }
});
