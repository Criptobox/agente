// src/runner.js
// Ejecuta UN turno de UN agente. Se invoca desde el workflow.
// Ciclo: cargar tarea -> construir contexto -> llamar modelo (con tool-calling
//        real si el agente tiene tools implementadas, ver agentLoop.js) ->
//        parsear salida -> escribir memoria -> registrar handoff.

import fs from "node:fs";
import { write } from "./memory.js";
import { loadAgent, loadMasterPrompt, buildContext, renderContext } from "./context.js";
import { safeId } from "./util.js";
import { runTurnSafe } from "./agentLoop.js";

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

async function main() {
  // TASK_ID/AGENT pueden venir de un workflow_dispatch manual: se validan
  // antes de usarlos para construir rutas de archivo (tasks/<id>.json, agents/<agent>.md).
  const task = loadTask(safeId(TASK_ID));
  const ctx = buildContext(task);
  const master = loadMasterPrompt();
  const agentMarkdown = loadAgent(safeId(AGENT));

  const system = `${master}\n\n## TU ROL ESPECÍFICO\n${agentMarkdown}`;
  const sandbox = process.env.SANDBOX_URL
    ? `\n\nSANDBOX_URL: ${process.env.SANDBOX_URL} (copia efímera ya sirviendo ahí; si tienes la tool sandbox_request, úsala para probarla de verdad)`
    : "";
  const user = `${renderContext(ctx)}${sandbox}\n\nEjecuta tu ciclo y responde SOLO con el JSON del formato indicado.`;

  let turn;
  try {
    turn = await runTurnSafe({ system, user, tier: tierFor(AGENT), agentMarkdown });
  } catch (e) {
    console.error("El agente falló incluso en modo texto:", e.message);
    task.status = "failed";
    task.error = e.message;
    saveTask(task);
    process.exit(1);
  }

  const { result, out, toolLog } = turn;

  // Escribir memorias que el agente haya producido.
  const written = [];
  for (const w of (result.memory_writes || [])) {
    if (!w.id || !w.type) continue;
    const { id, type, body, ...meta } = w;
    meta.agent = AGENT;
    meta.updated = new Date().toISOString().slice(0, 10);
    try {
      written.push(write(type, id, meta, body || meta.title || ""));
    } catch (e) {
      console.error(`memory_write rechazado (${id}):`, e.message);
    }
  }

  // Registrar handoff en la tarea.
  task.handoffs = task.handoffs || [];
  task.handoffs.push({ agent: AGENT, at: new Date().toISOString(), route: result.route, handoff: result.handoff, tool_calls: toolLog.length });
  task.last_result = result;

  // El presupuesto (task.budget) se definía al crear la tarea pero nadie lo
  // comprobaba nunca: una tarea podía encadenar handoffs o gastar tokens sin
  // límite real. Se acumula aquí, donde ya sabemos cuánto costó este turno.
  task.attempts = (task.attempts || 0) + 1;
  task.usage_tokens = (task.usage_tokens || 0) + (out.totalTokens || 0);
  const budget = task.budget || {};
  const overAttempts = budget.max_attempts && task.attempts > budget.max_attempts;
  const overTokens = budget.max_tokens && task.usage_tokens > budget.max_tokens;

  if (result.needs_human || overAttempts || overTokens) {
    task.status = "waiting_human";
  }
  if (overAttempts || overTokens) {
    task.budget_exceeded = {
      reason: overTokens ? "max_tokens" : "max_attempts",
      attempts: task.attempts, usage_tokens: task.usage_tokens, budget,
    };
  }
  saveTask(task);

  // Salida legible para el comentario del Issue (la lee el workflow).
  const summary = [
    `### 🤖 ${AGENT} — ruta: ${result.route}`,
    result.reused_memory?.length ? `Reutilizó: ${result.reused_memory.join(", ")}` : null,
    "",
    "**Hallazgos:**",
    ...(result.findings || []).map(f => `- (${f.kind}, conf ${f.confidence}) ${f.statement} — _${f.evidence || "sin evidencia"}_`),
    written.length ? `\n**Memoria escrita:** ${written.map(f => f.split("/").pop()).join(", ")}` : "",
    toolLog.length ? `\n**Herramientas usadas:** ${toolLog.map(t => t.name).join(", ")}` : "",
    result.conflicts?.length ? `\n⚠️ **Conflictos:** ${result.conflicts.join("; ")}` : "",
    result.handoff ? `\n**Handoff → ${result.handoff.next_agent || "fin"}:** ${result.handoff.next_task || "-"}` : "",
    result.needs_human ? `\n🙋 **Requiere tu decisión.**` : "",
    (overAttempts || overTokens)
      ? `\n🚨 **Presupuesto agotado** (${task.attempts}/${budget.max_attempts || "∞"} intentos, ${task.usage_tokens}/${budget.max_tokens || "∞"} tokens) — pausada, requiere tu decisión.`
      : "",
    `\n_modelo: ${out.provider}/${out.model} · tokens de esta tarea: ${task.usage_tokens}_`,
  ].filter(x => x !== null).join("\n");

  fs.writeFileSync("agent_output.md", summary);
  console.log(summary);
}

main().catch(e => { console.error(e); process.exit(1); });
