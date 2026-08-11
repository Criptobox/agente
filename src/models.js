// src/models.js
// MODEL ROUTER + FALLBACK.
// Primario: GitHub Models (gratis, usa el GITHUB_TOKEN del runner con permiso models:read).
// Secundarios opcionales: solo se usan si defines las variables de entorno.
// Regla: si un proveedor falla o borra el modelo, se pasa al siguiente sin romper el sistema.

const PROVIDERS = [
  {
    name: "github",
    url: "https://models.github.ai/inference/chat/completions",
    key: () => process.env.GITHUB_TOKEN,
    // IDs de modelo de GitHub Models. Si GitHub cambia el catálogo, edita aquí.
    models: {
      cheap:  "openai/gpt-4o-mini",
      strong: "openai/gpt-4o",
      code:   "openai/gpt-4o",
    },
    headers: (key) => ({
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      "Accept": "application/vnd.github+json",
    }),
  },
  // --- Secundarios: opcionales. Rellena los secrets si quieres usarlos. ---
  {
    name: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: () => process.env.GROQ_API_KEY,
    models: { cheap: "llama-3.1-8b-instant", strong: "llama-3.3-70b-versatile", code: "llama-3.3-70b-versatile" },
    headers: (key) => ({ "Authorization": `Bearer ${key}`, "Content-Type": "application/json" }),
  },
  {
    name: "gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    key: () => process.env.GEMINI_API_KEY,
    models: { cheap: "gemini-2.5-flash", strong: "gemini-2.5-flash", code: "gemini-2.5-flash" },
    headers: (key) => ({ "Authorization": `Bearer ${key}`, "Content-Type": "application/json" }),
  },
];

// tier: "cheap" | "strong" | "code"  -> el Model Router elige coste vs capacidad.
export async function chat(messages, { tier = "cheap", temperature = 0.2, max_tokens = 2000, json = false } = {}) {
  let lastErr;
  for (const p of PROVIDERS) {
    const key = p.key();
    if (!key) continue; // proveedor no configurado -> saltar
    const model = p.models[tier] || p.models.cheap;
    try {
      const body = { model, messages, temperature, max_tokens };
      if (json) body.response_format = { type: "json_object" };
      const res = await fetch(p.url, { method: "POST", headers: p.headers(key), body: JSON.stringify(body) });
      if (!res.ok) {
        lastErr = new Error(`${p.name} ${res.status}: ${(await res.text()).slice(0, 300)}`);
        // 429 = rate limit -> probar siguiente proveedor. Otros errores igual.
        continue;
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content ?? "";
      return { text, provider: p.name, model, usage: data?.usage || null };
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
      const res = await fetch(p.url, { method: "POST", headers: p.headers(key), body: JSON.stringify(body) });
      if (!res.ok) continue;
      const data = await res.json();
      return { text: data?.choices?.[0]?.message?.content ?? "", provider: p.name, model };
    } catch { continue; }
  }
  return null; // no hay segundo proveedor disponible
}

// Embeddings para la búsqueda semántica (mismo token gratis de GitHub Models).
export async function embed(text) {
  const key = process.env.GITHUB_TOKEN;
  const res = await fetch("https://models.github.ai/inference/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      "Accept": "application/vnd.github+json",
    },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text }),
  });
  if (!res.ok) throw new Error(`embed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.data[0].embedding;
}
