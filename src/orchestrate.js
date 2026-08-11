// src/orchestrate.js
// Convierte un Issue en una tarea: consulta memoria, define gates y elige el primer agente.

import fs from "node:fs";
import path from "node:path";
import { chat } from "./models.js";
import { search, loadAll } from "./memory.js";

const title = process.env.ISSUE_TITLE || "";
const body  = process.env.ISSUE_BODY  || "";
const issue = process.env.ISSUE_NUM   || "";

// Antes esto no existía: task.project nunca se fijaba, así que ni el
// scoring por proyecto en memory.search() ni (ahora) el checkout del repo
// real del proyecto en agent-run.yml tenían de dónde sacar el dato.
// Heurística simple: si el slug, nombre o algún tag de un memory/projects/*.md
// aparece en el texto de la tarea, esa es la tarea de ese proyecto.
function detectProject(goal) {
  const g = goal.toLowerCase();
  for (const p of loadAll().filter(m => m.type === "project")) {
    const slug = path.basename(p._file, ".md").toLowerCase();
    const name = String(p.name || "").toLowerCase();
    const tags = [].concat(p.tags || []).map(t => String(t).toLowerCase());
    if ((slug && g.includes(slug)) || (name && g.includes(name)) || tags.some(t => g.includes(t))) {
      return slug;
    }
  }
  return null;
}

function nextTaskId() {
  const dir = "tasks";
  const ids = fs.existsSync(dir)
    ? fs.readdirSync(dir).map(f => parseInt((f.match(/TASK-(\d+)/) || [])[1] || "0", 10))
    : [];
  const n = (ids.length ? Math.max(...ids) : 0) + 1;
  return "TASK-" + String(n).padStart(4, "0");
}

async function main() {
  const goal = `${title}. ${body}`.trim();
  const project = detectProject(goal);

  // 1. Consultar memoria ANTES de crear trabajo.
  const related = search(goal, { project, limit: 6 });

  // 2. Pedir al modelo un plan mínimo: gates + primer agente.
  const system = `Eres el ORCHESTRATOR de un sistema multi-agente. Tu trabajo aquí:
- Consultar la memoria relacionada (te la doy).
- Si ya hay trabajo previo, la tarea CONTINÚA desde ahí.
- Definir un Definition of Done con gates OBJETIVOS y verificables.
- Elegir el PRIMER agente. Agentes: code, logic, test, security, breaker, judge, research.
Responde SOLO con JSON:
{ "continues_from": ["BUG-XXX"] | [], "gates": [ {"id":"G1","check":"...","method":"test|assertion|diff_scan|security_scan","expect":"..."} ], "first_agent": "code", "plan_summary": "2-3 frases para el usuario" }`;

  const memText = related.length
    ? related.map(m => `[${m.id}] (${m.type}, conf ${m.confidence ?? "?"}${m.stale ? ", OBSOLETA" : ""}) ${m.title || m.statement || ""}`).join("\n")
    : "(sin memoria previa relevante)";

  const user = `PETICIÓN DEL USUARIO:\n${goal}\n\nMEMORIA RELACIONADA:\n${memText}`;

  let plan;
  try {
    const out = await chat(
      [{ role: "system", content: system }, { role: "user", content: user }],
      { tier: "strong", json: true, max_tokens: 1200 }
    );
    const t = out.text; const s = t.indexOf("{"); const e = t.lastIndexOf("}");
    plan = JSON.parse(t.slice(s, e + 1));
  } catch (err) {
    plan = { continues_from: [], gates: [], first_agent: "code", plan_summary: "No pude planificar automáticamente; asigno Code Agent para un primer análisis." };
  }

  const id = nextTaskId();
  const task = {
    id, issue: Number(issue) || null, goal, project,
    status: "queued",
    assigned: plan.first_agent || "code",
    continues_from: plan.continues_from || [],
    definition_of_done: plan.gates || [],
    budget: { max_attempts: 5, max_minutes: 25, max_tokens: 120000 },
    autonomy: "assisted",
    handoffs: [],
    created: new Date().toISOString(),
  };
  fs.writeFileSync(`tasks/${id}.json`, JSON.stringify(task, null, 2));

  const summary = [
    `### 🧠 Orchestrator — ${id} creada`,
    project ? `**Proyecto detectado:** ${project}` : `**Proyecto:** sin detectar (memoria general, sin checkout de código real)`,
    plan.continues_from?.length ? `**Continúa desde:** ${plan.continues_from.join(", ")} (no empiezo de cero)` : `**Nuevo** (sin trabajo previo relacionado)`,
    "",
    plan.plan_summary || "",
    "",
    `**Gates a cumplir:** ${(plan.gates || []).map(g => g.id + ": " + g.check).join(" · ") || "(a definir)"}`,
    `**Primer agente:** ${task.assigned}`,
    "",
    `> Para lanzarlo: Actions → agent-run → agent=\`${task.assigned}\`, task_id=\`${id}\`, issue=\`${issue}\``,
  ].join("\n");
  fs.writeFileSync("orch_output.md", summary);
  console.log(summary);
}

main().catch(e => { console.error(e); process.exit(1); });
