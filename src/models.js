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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ante un 429, Groq (y otros) suelen decir exactamente cuánto esperar
// ("Please try again in 6.3s" o el header Retry-After). Antes de esto se
// saltaba directo al siguiente proveedor sin intentar esperar ese ratito,
// perdiendo la llamada aunque el límite fuera a liberarse en segundos.
// Tope de 15s para no comerse el timeout completo por un solo reintento.
function retryDelayMs(res, bodyText) {
  const header = res.headers?.get?.("retry-after");
  const n = header ? Number(header) : NaN;
  if (!Number.isNaN(n)) return Math.min(Math.max(n, 0), 15) * 1000;
  const m = bodyText.match(/try again in ([\d.]+)s/i);
  if (m) return Math.min(parseFloat(m[1]), 15) * 1000;
  return null; // sin pista clara -> no reintentamos, pasamos al siguiente proveedor
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
    // gpt-oss-20b/120b son modelos de razonamiento: por defecto gastan parte
    // del max_tokens "pensando" antes de escribir la respuesta visible. Con
    // reasoning_effort alto (el default) y un max_tokens ajustado, el
    // razonamiento puede consumirlo TODO y dejar "content" vacío aunque la
    // llamada haya sido exitosa. "low" reduce ese riesgo en cada llamada.
    extraBody: { reasoning_effort: "low" },
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
  // OpenRouter: pasarela única a decenas de proveedores. "openrouter/free"
  // es su ROUTER gratis: elige automáticamente, en cada llamada, un modelo
  // gratis disponible AHORA MISMO que soporte lo que pidas (tool-calling,
  // JSON). Los IDs concretos de modelos ":free" (ej. openai/gpt-oss-120b:free)
  // rotan sin aviso -la misma trampa en la que ya caímos con GitHub Models/
  // Groq/Gemini, ver arriba-, así que aquí es mejor dejar que OpenRouter
  // decida en vez de fijar uno.
  {
    name: "openrouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    key: () => process.env.OPENROUTER_API_KEY,
    models: { cheap: "openrouter/free", strong: "openrouter/free", code: "openrouter/free" },
    headers: (key) => ({ "Authorization": `Bearer ${key}`, "Content-Type": "application/json" }),
  },
  // Z.ai (GLM): API propia OpenAI-compatible. Endpoint, auth y formato
  // confirmados con una petición real del usuario contra este mismo
  // endpoint (usaba "glm-5.2"). GLM-5.2 es el modelo flagship de pago:
  // créditos gratis iniciales y luego cobra (~$0.95-1.40 / $3-4.40 por
  // millón de tokens), con el tier gratis limitado a ~50 peticiones/día.
  // GLM-4.5-Flash / GLM-4.7-Flash, en cambio, son gratis de verdad para
  // este mismo endpoint (~1000 peticiones/día) según varias fuentes
  // independientes -aunque, a diferencia de "glm-5.2", esto no lo pude
  // confirmar con una petición real, solo por búsqueda-. Se usan estos
  // por defecto, coherente con el resto del archivo (proveedor gratis
  // primero); si fallan con "model not found", cambia a "glm-5.2" (más
  // capaz, pero de pago) o confirma el ID vigente en https://docs.z.ai.
  {
    name: "zai",
    url: "https://api.z.ai/api/paas/v4/chat/completions",
    key: () => process.env.ZAI_API_KEY,
    models: { cheap: "glm-4.5-flash", strong: "glm-4.7-flash", code: "glm-4.7-flash" },
    // Los GLM son modelos de razonamiento (thinking). Con reasoning_effort
    // alto pueden repetir el mismo problema que ya vimos en Groq: gastar el
    // max_tokens pensando y devolver "content" vacío. "low" lo evita.
    extraBody: { thinking: { type: "enabled" }, reasoning_effort: "low" },
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
    throw new Error("ningún proveedor de IA configurado: agrega GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY o ZAI_API_KEY como secret (GitHub Models se retiró el 30-jul-2026)");
  }
  let lastErr;
  for (const p of PROVIDERS) {
    const key = p.key();
    if (!key) continue; // proveedor no configurado -> saltar
    const model = p.models[tier] || p.models.cheap;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const body = { model, messages, temperature, max_tokens, ...(p.extraBody || {}) };
        if (json) body.response_format = { type: "json_object" };
        if (tools && tools.length) body.tools = tools;
        const res = await fetchWithTimeout(p.url, { method: "POST", headers: p.headers(key), body: JSON.stringify(body) });
        if (!res.ok) {
          const bodyText = (await res.text()).slice(0, 300);
          lastErr = new Error(`${p.name} ${res.status}: ${bodyText}`);
          if (res.status === 429 && attempt === 0) {
            const wait = retryDelayMs(res, bodyText);
            if (wait != null) { await sleep(wait); continue; } // reintenta el MISMO proveedor una vez
          }
          break; // sin pista de espera, o ya reintentado -> probar siguiente proveedor
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
        break;
      }
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
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const body = { model, messages, temperature, max_tokens, ...(p.extraBody || {}) };
        if (json) body.response_format = { type: "json_object" };
        const res = await fetchWithTimeout(p.url, { method: "POST", headers: p.headers(key), body: JSON.stringify(body) });
        if (!res.ok) {
          if (res.status === 429 && attempt === 0) {
            const bodyText = await res.text();
            const wait = retryDelayMs(res, bodyText);
            if (wait != null) { await sleep(wait); continue; }
          }
          break;
        }
        const data = await res.json();
        return { text: data?.choices?.[0]?.message?.content ?? "", provider: p.name, model };
      } catch { break; }
    }
  }
  return null; // no hay segundo proveedor disponible
}
