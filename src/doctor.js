// src/doctor.js
// Diagnóstico: comprueba que la IA gratis responde y reporta en español.
// Los chequeos de permisos/etiqueta los hace el workflow (bash + gh) y se juntan aquí.

import fs from "node:fs";
import { chat, availableProviders } from "./models.js";

async function main() {
  const lines = [];
  lines.push("## 🩺 Diagnóstico de agent-brain\n");

  // 1. ¿Responde la IA gratis de GitHub Models?
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
    lines.push(`- ❌ **La IA no respondió** (${e.message}). Revisa que el workflow tenga \`permissions: models: read\`.`);
  }

  // 2. Proveedores de respaldo configurados
  const provs = availableProviders();
  if (provs.length >= 2) {
    lines.push(`- ✅ **Verificación cruzada disponible**: ${provs.length} modelos (${provs.join(", ")}). El tribunal tendrá segundo par de ojos.`);
  } else {
    lines.push(`- ℹ️ Solo hay 1 modelo (GitHub Models). Para el 2º modelo del tribunal, añade el secret \`GROQ_API_KEY\` o \`GEMINI_API_KEY\` (opcional).`);
  }

  fs.writeFileSync("doctor_ai.md", lines.join("\n"));
  console.log(lines.join("\n"));
}

main().catch((e) => { fs.writeFileSync("doctor_ai.md", `- ❌ Error en el diagnóstico de IA: ${e.message}`); console.error(e); });
