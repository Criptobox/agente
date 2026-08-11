// src/selfimprove.js
// Auto-mejora: lee tareas y lecciones, busca patrones de fallo repetido,
// y genera improve_patch.md (cuerpo del PR). Aplica el cambio propuesto al
// archivo del agente SOLO en la rama del PR (el workflow lo commitea aparte).

import fs from "node:fs";
import { chat } from "./models.js";
import { loadAll } from "./memory.js";
import { loadAgent, loadMasterPrompt } from "./context.js";

function allTasks() {
  if (!fs.existsSync("tasks")) return [];
  return fs.readdirSync("tasks")
    .filter(f => f.endsWith(".json"))
    .map(f => { try { return JSON.parse(fs.readFileSync(`tasks/${f}`, "utf8")); } catch { return null; } })
    .filter(Boolean);
}

async function main() {
  const tasks = allTasks();
  const lessons = loadAll().filter(m => m.type === "lesson");

  // Resumen compacto del historial para el modelo.
  const taskSummary = tasks.map(t => {
    const failedGates = (t.last_result?.gates || []).filter(g => g.status === "FAIL").map(g => g.id);
    return `${t.id}[${t.status}] agente=${t.assigned} gates_fallidos=${failedGates.join(",") || "-"} obj=${t.goal.slice(0, 50)}`;
  }).join("\n");

  const lessonSummary = lessons.map(l =>
    `${l.id} applied=${l.times_applied ?? 0} prevented=${l.times_prevented_failure ?? 0} ignored=${l.times_ignored ?? 0} rule="${l.rule}"`
  ).join("\n");

  const system = `${loadMasterPrompt()}\n\n## TU ROL\n${loadAgent("selfimprove")}`;
  const user = `HISTORIAL DE TAREAS:\n${taskSummary || "(vacío)"}\n\nLECCIONES:\n${lessonSummary || "(vacío)"}\n\nSi encuentras un patrón claro de fallo repetido que justifique cambiar UN prompt de agente, responde con el JSON del formato. Si NO hay patrón claro, responde exactamente: {"pattern_found": null}`;

  let proposal;
  try {
    const out = await chat([{ role: "system", content: system }, { role: "user", content: user }], { tier: "strong", json: true, max_tokens: 1200 });
    const t = out.text; proposal = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
  } catch (e) {
    console.log("Sin propuesta (error o sin datos):", e.message);
    return; // no crea improve_patch.md -> el workflow no abre PR
  }

  if (!proposal || !proposal.pattern_found || !proposal.proposed_change) {
    console.log("Sin patrón claro esta semana. No se abre PR.");
    return;
  }

  // Aplicar el cambio propuesto al archivo del agente (añade la regla al final).
  const ch = proposal.proposed_change;
  if (ch.file && ch.add_rule && fs.existsSync(ch.file)) {
    fs.appendFileSync(ch.file, `\n\n## Regla aprendida (auto-mejora ${new Date().toISOString().slice(0, 10)})\n${ch.add_rule}\n`);
  }

  const body = [
    `## 🔧 Propuesta de auto-mejora`,
    ``,
    `**Patrón detectado:** ${proposal.pattern_found}`,
    `**Evidencia:** ${(proposal.evidence || []).join(", ")}`,
    ``,
    `**Cambio propuesto:** \`${ch.file}\``,
    `> ${ch.add_rule}`,
    ``,
    `**Efecto esperado:** ${proposal.expected_effect || "-"}`,
    `**Riesgo:** ${proposal.risk || "-"}`,
    ``,
    `---`,
    `_Este PR lo generó el sistema leyendo su propio historial. Apruébalo, edítalo o ciérralo._`,
    `_Métrica a vigilar: intentos promedio hasta el primer gate verde. Si no baja tras este cambio, revierte._`,
  ].join("\n");

  fs.writeFileSync("improve_patch.md", body);
  console.log(body);
}

main().catch(e => { console.error(e); process.exit(1); });
