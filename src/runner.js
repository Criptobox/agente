// src/runner.js
// Ejecuta UN turno de UN agente. Se invoca desde el workflow.
// Ciclo: cargar tarea -> construir contexto -> llamar modelo -> parsear salida
//        -> escribir memoria -> registrar handoff.

import fs from "node:fs";
import { chat } from "./models.js";
import { write } from "./memory.js";
import { loadAgent, loadMasterPrompt, buildContext, renderContext } from "./context.js";
import { safeId } from "./util.js";

const AGENT   = process.env.AGENT;
const TASK_ID = process.env.TASK_ID;

function loadTask(id) {
  const file = `tasks/${id}.json`;
  if (!fs.existsSync(file)) throw new Error(`tarea no encontrada: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function saveTask(task) {
  fs.writeFileSync(`tasks/${task.id}.json`, JSON.stringify(task, null, 2));
}

function tierFor(agent) {
  if (agent === "code" || agent === "logic" || agent === "security") return "code";
  if (agent === "orchestrator" || agent === "judge") return "strong";
  return "cheap";
}

// Extrae el primer objeto JSON de la respuesta del modelo, tolerante a ruido.
function parseJSON(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("el modelo no devolvió JSON");
  return JSON.parse(candidate.slice(start, end + 1));
}

async function main() {
  // TASK_ID/AGENT pueden venir de un workflow_dispatch manual: se validan
  // antes de usarlos para construir rutas de archivo (tasks/<id>.json, agents/<agent>.md).
  const task = loadTask(safeId(TASK_ID));
  const ctx = buildContext(task);
  const master = loadMasterPrompt();
  const role = loadAgent(safeId(AGENT));

  const system = `${master}\n\n## TU ROL ESPECÍFICO\n${role}`;
  const sandbox = process.env.SANDBOX_URL
    ? `\n\nSANDBOX_URL: ${process.env.SANDBOX_URL} (copia efímera ya sirviendo ahí; describe las peticiones/pasos concretos contra esta URL — no la ejecutas tú mismo, no hay tool-calling real en F0)`
    : "";
  const user = `${renderContext(ctx)}${sandbox}\n\nEjecuta tu ciclo y responde SOLO con el JSON del formato indicado.`;

  const out = await chat(
    [{ role: "system", content: system }, { role: "user", content: user }],
    { tier: tierFor(AGENT), json: true, max_tokens: 2500 }
  );

  let result;
  try {
    result = parseJSON(out.text);
  } catch (e) {
    console.error("No se pudo parsear la salida del agente:", e.message);
    console.error("Salida cruda:", out.text.slice(0, 500));
    task.status = "failed";
    task.error = "salida no parseable";
    saveTask(task);
    process.exit(1);
  }

  // Escribir memorias que el agente haya producido.
  const written = [];
  for (const w of (result.memory_writes || [])) {
    if (!w.id || !w.type) continue;
    const { id, type, body, ...meta } = w;
    meta.agent = AGENT;
    meta.updated = new Date().toISOString().slice(0, 10);
    const file = write(type, id, meta, body || meta.title || "");
    written.push(file);
  }

  // Registrar handoff en la tarea.
  task.handoffs = task.handoffs || [];
  task.handoffs.push({ agent: AGENT, at: new Date().toISOString(), route: result.route, handoff: result.handoff });
  task.last_result = result;
  if (result.needs_human) task.status = "waiting_human";
  saveTask(task);

  // Salida legible para el comentario del Issue (la lee el workflow).
  const summary = [
    `### 🤖 ${AGENT} — ruta: ${result.route}`,
    result.reused_memory?.length ? `Reutilizó: ${result.reused_memory.join(", ")}` : null,
    "",
    "**Hallazgos:**",
    ...(result.findings || []).map(f => `- (${f.kind}, conf ${f.confidence}) ${f.statement} — _${f.evidence || "sin evidencia"}_`),
    written.length ? `\n**Memoria escrita:** ${written.map(f => f.split("/").pop()).join(", ")}` : "",
    result.conflicts?.length ? `\n⚠️ **Conflictos:** ${result.conflicts.join("; ")}` : "",
    result.handoff ? `\n**Handoff → ${result.handoff.next_agent || "fin"}:** ${result.handoff.next_task || "-"}` : "",
    result.needs_human ? `\n🙋 **Requiere tu decisión.**` : "",
    `\n_modelo: ${out.provider}/${out.model}_`,
  ].filter(x => x !== null).join("\n");

  fs.writeFileSync("agent_output.md", summary);
  console.log(summary);
}

main().catch(e => { console.error(e); process.exit(1); });
