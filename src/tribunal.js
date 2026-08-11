// src/tribunal.js
// MODO TRIBUNAL. Se activa para decisiones importantes.
// Sobre UNA tarea que ya tiene una solución propuesta:
//   1) DEFENSOR argumenta que cumple los gates (con evidencia).
//   2) FISCAL intenta demostrar que falla (con pruebas ejecutables).
//   3) JUEZ decide sobre las PRUEBAS, no sobre quién argumentó mejor.
//   4) Verificación cruzada: un segundo modelo revisa el veredicto del juez.
// El juez es el único que cierra. Defensor y fiscal solo aportan evidencia.

import fs from "node:fs";
import { chatExcluding, availableProviders } from "./models.js";
import { loadAgent, loadMasterPrompt, buildContext, renderContext } from "./context.js";
import { safeId } from "./util.js";
import { runTurnSafe, parseJSON } from "./agentLoop.js";

const TASK_ID = process.env.TASK_ID;

function loadTask(id) {
  const f = `tasks/${id}.json`;
  if (!fs.existsSync(f)) throw new Error(`tarea no encontrada: ${f}`);
  return JSON.parse(fs.readFileSync(f, "utf8"));
}
function saveTask(t) { fs.writeFileSync(`tasks/${t.id}.json`, JSON.stringify(t, null, 2)); }

// Defensor/fiscal/juez declaran github.read_file, testing.run y
// sandbox.request en sus agents/*.md: con el ciclo con herramientas pueden
// verificar contra código y tests reales, no solo argumentar sobre texto.
async function runRole(role, task, extraContext) {
  const agentMarkdown = loadAgent(role);
  const system = `${loadMasterPrompt()}\n\n## TU ROL\n${agentMarkdown}`;
  const ctx = renderContext(buildContext(task));
  const user = `${ctx}\n\n${extraContext}\n\nResponde SOLO con el JSON de tu formato.`;
  const { result, out, toolLog } = await runTurnSafe({ system, user, tier: "strong", agentMarkdown, max_tokens: 2000 });
  return { json: result, provider: out.provider, model: out.model, toolLog };
}

async function main() {
  // TASK_ID puede venir de un comentario "/tribunal TASK-XXXX" en un Issue
  // público -> cualquiera en internet controla este string. Se valida antes
  // de usarlo como ruta de archivo (evita leer/escribir fuera de tasks/).
  const task = loadTask(safeId(TASK_ID));
  const solution = task.last_result
    ? JSON.stringify(task.last_result, null, 2)
    : "(no hay solución propuesta en task.last_result)";

  // 1) DEFENSA
  const defense = await runRole("defender", task,
    `SOLUCIÓN PROPUESTA A DEFENDER:\n${solution}`);

  // 2) FISCALÍA (ve la defensa y ataca)
  const prosecution = await runRole("prosecutor", task,
    `SOLUCIÓN PROPUESTA:\n${solution}\n\nDEFENSA PRESENTADA:\n${JSON.stringify(defense.json, null, 2)}\n\nAtácala. Encuentra el defecto real con prueba concreta.`);

  // 3) JUEZ (decide sobre pruebas)
  const judgeInput =
    `DEFENSA:\n${JSON.stringify(defense.json, null, 2)}\n\n` +
    `FISCALÍA:\n${JSON.stringify(prosecution.json, null, 2)}\n\n` +
    `Decide sobre la EVIDENCIA, no sobre quién argumentó mejor. ` +
    `Si el fiscal presentó una prueba ejecutable de un defecto blocker/major, el veredicto es RED. ` +
    `Si solo hay sospechas sin prueba, no bastan para RED.`;
  const verdict = await runRole("judge", task, judgeInput);

  // 4) VERIFICACIÓN CRUZADA: segundo modelo revisa el veredicto del juez.
  let crossCheck = null;
  const providers = availableProviders();
  if (providers.length >= 2) {
    const second = await chatExcluding(verdict.provider, [
      { role: "system", content: "Eres un revisor independiente. Otro juez emitió un veredicto. Tu trabajo NO es re-juzgar desde cero, sino detectar si el veredicto tiene un fallo de lógica o ignoró una prueba. Responde JSON: {\"agrees\": true|false, \"discrepancy\": \"...\", \"confidence\": 0}" },
      { role: "user", content: `VEREDICTO A REVISAR:\n${JSON.stringify(verdict.json, null, 2)}\n\nPRUEBAS DEL FISCAL:\n${JSON.stringify(prosecution.json, null, 2)}` },
    ], { tier: "strong", json: true, max_tokens: 800 });
    if (second) {
      try { crossCheck = { ...parseJSON(second.text), provider: second.provider }; }
      catch { crossCheck = null; }
    }
  }

  // Persistir el juicio en la tarea.
  task.tribunal = {
    at: new Date().toISOString(),
    verdict: verdict.json.verdict,
    defense: defense.json,
    prosecution: prosecution.json,
    judge: verdict.json,
    cross_check: crossCheck,
    judge_model: `${verdict.provider}/${verdict.model}`,
    tool_calls: {
      defense: defense.toolLog.map(t => t.name),
      prosecution: prosecution.toolLog.map(t => t.name),
      judge: verdict.toolLog.map(t => t.name),
    },
  };
  // Si el segundo modelo NO está de acuerdo, no cerramos: sube a decisión humana.
  const crossConflict = crossCheck && crossCheck.agrees === false;
  if (verdict.json.verdict === "GREEN" && !crossConflict) task.status = "verified";
  else if (crossConflict) task.status = "waiting_human";
  else task.status = "needs_rework";
  saveTask(task);

  // Informe legible para el Issue.
  const lines = [
    `## ⚖️ Tribunal — ${task.id}`,
    ``,
    `**Veredicto del juez:** ${verdict.json.verdict === "GREEN" ? "🟢 GREEN" : "🔴 RED"}  _(${verdict.provider}/${verdict.model})_`,
    verdict.json.reason ? `> ${verdict.json.reason}` : "",
    verdict.toolLog.length ? `_Verificado con: ${verdict.toolLog.map(t => t.name).join(", ")}_` : "",
    ``,
    `**Ataque más fuerte del fiscal:** ${prosecution.json.honest_verdict === "could_not_break_it"
      ? "no logró romperla (buena señal)"
      : (prosecution.json.attacks?.[prosecution.json.strongest_attack]?.claim || "ver detalle")}`,
    prosecution.json.honest_verdict === "found_real_defect"
      ? `Prueba: ${prosecution.json.attacks?.[prosecution.json.strongest_attack]?.proof || "-"}`
      : "",
    ``,
    defense.json.conceded?.length ? `**La defensa concedió:** ${defense.json.conceded.join("; ")}` : "",
    ``,
  ];
  if (crossCheck) {
    lines.push(crossCheck.agrees
      ? `**Verificación cruzada (${crossCheck.provider}):** ✅ de acuerdo con el veredicto.`
      : `**⚠️ Verificación cruzada (${crossCheck.provider}): EN DESACUERDO.** ${crossCheck.discrepancy} → sube a tu decisión.`);
  } else if (providers.length < 2) {
    lines.push(`_Verificación cruzada desactivada: configura GROQ_API_KEY o GEMINI_API_KEY para un segundo par de ojos._`);
  }
  lines.push(``, `**Estado de la tarea:** ${task.status}`);

  const report = lines.filter(x => x !== "").join("\n");
  fs.writeFileSync("tribunal_output.md", report);
  console.log(report);
}

main().catch(e => { console.error(e); process.exit(1); });
