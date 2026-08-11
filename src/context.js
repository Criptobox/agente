// src/context.js
// CONTEXT ENGINE. La pieza más importante en el tier gratis: nunca mandamos
// un repo entero al modelo. Seleccionamos SOLO lo relevante para la tarea.

import fs from "node:fs";
import { search } from "./memory.js";

// Carga la definición declarativa del agente (agents/<name>.md).
export function loadAgent(name) {
  const file = `agents/${name}.md`;
  if (!fs.existsSync(file)) throw new Error(`agente no encontrado: ${file}`);
  return fs.readFileSync(file, "utf8");
}

// Carga el prompt maestro compartido por todos los agentes.
export function loadMasterPrompt() {
  return fs.readFileSync("agents/_master.md", "utf8");
}

// Extrae posibles nombres de archivo y símbolos mencionados en el texto de la tarea.
function extractHints(text) {
  const files = [...text.matchAll(/[\w./-]+\.(js|html|css|json|py|ts|jsx)/g)].map(m => m[0]);
  const symbols = [...text.matchAll(/\b([a-z][a-zA-Z0-9]+)\s*\(/g)].map(m => m[1]);
  return { files: [...new Set(files)], symbols: [...new Set(symbols)] };
}

// Construye el paquete de contexto que recibe el agente.
export function buildContext(task) {
  const { files, symbols } = extractHints(task.goal + " " + (task.detail || ""));
  const relevant = search(task.goal, { project: task.project, files, symbols, limit: 8 });

  // Separa lecciones (se declaran en pre-mortem) del resto de memorias.
  const lessons = relevant.filter(m => m.type === "lesson");
  const memories = relevant.filter(m => m.type !== "lesson");

  return {
    task,
    hints: { files, symbols },
    lessons,      // -> el agente DEBE declararlas antes de planificar
    memories,     // errores, decisiones, hechos relacionados
  };
}

// Formatea el contexto como texto compacto para meterlo en el prompt.
export function renderContext(ctx) {
  const fmt = (m) =>
    `[${m.id}] (${m.type}, conf ${m.confidence ?? "?"}${m.stale ? ", OBSOLETA-reverificar" : ""}) ` +
    `${m.title || m.statement || ""}`.trim();

  const lessons = ctx.lessons.length
    ? ctx.lessons.map(l => `- ${l.id}: ${l.rule} (evita: ${l.anti_pattern || "-"})`).join("\n")
    : "(ninguna)";

  const mems = ctx.memories.length
    ? ctx.memories.map(fmt).join("\n")
    : "(ninguna memoria previa relevante)";

  return `TAREA: ${ctx.task.goal}
PROYECTO: ${ctx.task.project || "-"}
ARCHIVOS PISTA: ${ctx.hints.files.join(", ") || "-"}

LECCIONES ACTIVAS (debes declararlas en pre-mortem antes de planificar):
${lessons}

MEMORIA RELEVANTE:
${mems}`;
}
