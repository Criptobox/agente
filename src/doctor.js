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
    const out = await chat(
      [{ role: "user", content: "Responde solo con la palabra: OK" }],
      { tier: "cheap", max_tokens: 5 }
    );
    if (/ok/i.test(out.text)) {
      lines.push(`- ✅ **IA gratis funciona** (respondió \`${out.provider}/${out.model}\`). El cerebro puede pensar.`);
    } else {
      lines.push(`- ⚠️ La IA respondió algo raro (\`${out.text.slice(0, 40)}\`), pero conecta.`);
    }
  } catch (e) {
    lines.push(`- ❌ **La IA no respondió** (${e.message}). GitHub Models ya no existe (retirado 30-jul-2026): añade el secret \`GROQ_API_KEY\` (gratis en groq.com) o \`GEMINI_API_KEY\` en Settings → Secrets and variables → Actions.`);
  }

  // 2. ¿Hay un segundo proveedor para la verificación cruzada del tribunal?
  const provs = availableProviders();
  if (provs.length >= 2) {
    lines.push(`- ✅ **Verificación cruzada disponible**: ${provs.length} modelos (${provs.join(", ")}). El tribunal tendrá segundo par de ojos.`);
  } else if (provs.length === 1) {
    lines.push(`- ℹ️ Solo hay 1 modelo (\`${provs[0]}\`). Para la verificación cruzada del tribunal (2º par de ojos), añade también el otro secret (\`GROQ_API_KEY\` o \`GEMINI_API_KEY\`).`);
  } else {
    lines.push(`- ❌ **Ningún proveedor configurado.** El sistema no puede pensar sin al menos uno. Añade \`GROQ_API_KEY\` o \`GEMINI_API_KEY\`.`);
  }

  fs.writeFileSync("doctor_ai.md", lines.join("\n"));
  console.log(lines.join("\n"));
}

main().catch((e) => { fs.writeFileSync("doctor_ai.md", `- ❌ Error en el diagnóstico de IA: ${e.message}`); console.error(e); });
