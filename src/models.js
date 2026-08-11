// src/models.js
// MODEL ROUTER + FALLBACK.
// GitHub Models (el proveedor original, gratis vía GITHUB_TOKEN) se RETIRÓ
// por completo el 30 de julio de 2026 — no es un fallo temporal, ya no
// existe el servicio. Por eso ya no está en PROVIDERS: sin GROQ_API_KEY o
// GEMINI_API_KEY configurados, el sistema no tiene ningún proveedor y
// chat() falla de inmediato con un mensaje claro (mejor eso que gastar un
// timeout completo contra un endpoint que sabemos muerto).
// Regla: si un proveedor falla o retira el modelo, se pasa al siguiente sin romper el sistema.

const REQUEST_TIMEOUT_MS = 55000;

// fetch() sin timeout puede colgar el job de Actions (y su cuota) si un
// proveedor no responde. AbortController lo acota; el error resultante cae
// en el mismo camino de fallback que un 429 o un 5xx.
async function fetchWithTimeout(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

const PROVIDERS = [
  // Groq: gratis con límites generosos, la opción a configurar primero.
  // llama-3.1-8b-instant/llama-3.3-70b-versatile (los IDs que usaba este
  // archivo) fueron retirados por Groq el 17-jun-2026; estos son los
  // reemplazos vigentes recomendados por Groq (ambos con tool-calling).
  {
    name: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: () => process.env.GROQ_API_KEY,
    models: { cheap: "openai/gpt-oss-20b", strong: "openai/gpt-oss-120b", code: "openai/gpt-oss-120b" },
    headers: (key) => ({ "Authorization": `Bearer ${key}`, "Content-Type": "application/json" }),
  },
  // Gemini: gemini-2.5-flash (el ID que usaba este archivo) se retira el
  // 16-oct-2026; gemini-3.6-flash / gemini-3.5-flash-lite son la
  // generación vigente (GA) a esa fecha.
  {
    name: "gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    key: () => process.env.GEMINI_API_KEY,
    models: { cheap: "gemini-3.5-flash-lite", strong: "gemini-3.6-flash", code: "gemini-3.6-flash" },
    headers: (key) => ({ "Authorization": `Bearer ${key}`, "Content-Type": "application/json" }),
  },
];

// tier: "cheap" | "strong" | "code"  -> el Model Router elige coste vs capacidad.
// tools: lista de function-schemas (formato OpenAI) para tool-calling real.
// Si un proveedor no soporta "tools" (o el modelo no lo usa), simplemente
// responde texto y seguimos igual que antes: el tool-calling es opcional,
// nunca un requisito para que el sistema funcione.
export async function chat(messages, { tier = "cheap", temperature = 0.2, max_tokens = 2000, json = false, tools = null } = {}) {
  if (availableProviders().length === 0) {
    throw new Error("ningún proveedor de IA configurado: agrega el secret GROQ_API_KEY o GEMINI_API_KEY (GitHub Models se retiró el 30-jul-2026)");
  }
  let lastErr;
  for (const p of PROVIDERS) {
    const key = p.key();
    if (!key) continue; // proveedor no configurado -> saltar
    const model = p.models[tier] || p.models.cheap;
    try {
      const body = { model, messages, temperature, max_tokens };
      if (json) body.response_format = { type: "json_object" };
      if (tools && tools.length) body.tools = tools;
      const res = await fetchWithTimeout(p.url, { method: "POST", headers: p.headers(key), body: JSON.stringify(body) });
      if (!res.ok) {
        lastErr = new Error(`${p.name} ${res.status}: ${(await res.text()).slice(0, 300)}`);
        // 429 = rate limit, o "tools" no soportado -> probar siguiente proveedor.
        continue;
      }
      const data = await res.json();
      const msg = data?.choices?.[0]?.message || {};
      return {
        text: msg.content ?? "",
        tool_calls: msg.tool_calls || null,
        provider: p.name, model, usage: data?.usage || null,
      };
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw new Error(`Todos los proveedores fallaron. Último error: ${lastErr?.message || "desconocido"}`);
}

// Lista de proveedores realmente configurados (tienen key). Para saber si hay 2+ modelos.
export function availableProviders() {
  return PROVIDERS.filter(p => p.key()).map(p => p.name);
}

// SEGUNDA OPINIÓN: fuerza usar un proveedor DISTINTO al indicado en `exclude`.
// Sirve para verificación cruzada: otro modelo, otra arquitectura, atrapa el error que el primero no ve.
// Si no hay un segundo proveedor configurado, devuelve null (el llamador decide qué hacer).
export async function chatExcluding(exclude, messages, { tier = "strong", temperature = 0.2, max_tokens = 1500, json = false } = {}) {
  for (const p of PROVIDERS) {
    if (p.name === exclude) continue;
    const key = p.key();
    if (!key) continue;
    const model = p.models[tier] || p.models.cheap;
    try {
      const body = { model, messages, temperature, max_tokens };
      if (json) body.response_format = { type: "json_object" };
      const res = await fetchWithTimeout(p.url, { method: "POST", headers: p.headers(key), body: JSON.stringify(body) });
      if (!res.ok) continue;
      const data = await res.json();
      return { text: data?.choices?.[0]?.message?.content ?? "", provider: p.name, model };
    } catch { continue; }
  }
  return null; // no hay segundo proveedor disponible
}
