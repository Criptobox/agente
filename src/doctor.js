// src/doctor.js
// Diagnóstico: comprueba que la IA gratis responde y reporta en español.
// Los chequeos de permisos/etiqueta los hace el workflow (bash + gh) y se juntan aquí.

import fs from "node:fs";
import { chat, availableProviders } from "./models.js";

async function main() {
  const lines = [];
  lines.push("## 🩺 Diagnóstico de agent-brain\n");

  // 1. ¿Hay algún proveedor de IA configurado y responde?
  // GitHub Models (el proveedor original, gratis vía GITHUB_TOKEN) se retiró
  // por completo el 30-jul-2026: ya no es una opción, ni principal ni de
  // respaldo. GROQ_API_KEY o GEMINI_API_KEY son OBLIGATORIOS ahora.
  try {
    // max_tokens generoso a propósito: los modelos "cheap" actuales de Groq
    // (openai/gpt-oss-20b) son modelos de razonamiento — gastan parte del
    // presupuesto de tokens en pensar antes de responder. Con un límite
    // muy ajustado (antes: 5) el texto visible podía salir vacío aunque la
    // IA conectara bien, lo que parecía un fallo cuando no lo era.
    const out = await chat(
      [{ role: "user", content: "Responde solo con la palabra: OK" }],
      { tier: "cheap", max_tokens: 40 }
    );
    if (/ok/i.test(out.text)) {
      lines.push(`- ✅ **IA gratis funciona** (respondió \`${out.provider}/${out.model}\`). El cerebro puede pensar.`);
    } else {
      lines.push(`- ⚠️ La IA respondió algo raro (\`${out.text.slice(0, 40)}\`), pero conecta.`);
    }
  } catch (e) {
    lines.push(`- ❌ **La IA no respondió** (${e.message}). GitHub Models ya no existe (retirado 30-jul-2026): añade alguno de estos secrets en Settings → Secrets and variables → Actions: \`GROQ_API_KEY\` (groq.com), \`GEMINI_API_KEY\`, \`MISTRAL_API_KEY\` (mistral.ai), \`OPENROUTER_API_KEY\` (openrouter.ai) o \`ZAI_API_KEY\` (z.ai).`);
  }

  // 2. ¿Hay un segundo proveedor para la verificación cruzada del tribunal?
  const provs = availableProviders();
  if (provs.length >= 2) {
    lines.push(`- ✅ **Verificación cruzada disponible**: ${provs.length} modelos (${provs.join(", ")}). El tribunal tendrá segundo par de ojos.`);
  } else if (provs.length === 1) {
    lines.push(`- ℹ️ Solo hay 1 modelo (\`${provs[0]}\`). Para la verificación cruzada del tribunal (2º par de ojos), añade otro secret más (\`GROQ_API_KEY\`, \`GEMINI_API_KEY\`, \`MISTRAL_API_KEY\`, \`OPENROUTER_API_KEY\` o \`ZAI_API_KEY\`).`);
  } else {
    lines.push(`- ❌ **Ningún proveedor configurado.** El sistema no puede pensar sin al menos uno. Añade \`GROQ_API_KEY\`, \`GEMINI_API_KEY\`, \`MISTRAL_API_KEY\`, \`OPENROUTER_API_KEY\` o \`ZAI_API_KEY\`.`);
  }

  fs.writeFileSync("doctor_ai.md", lines.join("\n"));
  console.log(lines.join("\n"));
}

main().catch((e) => { fs.writeFileSync("doctor_ai.md", `- ❌ Error en el diagnóstico de IA: ${e.message}`); console.error(e); });
