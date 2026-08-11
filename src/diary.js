// src/diary.js
// Diario nocturno: junta tareas/memorias recientes y pide al DIARIST un resumen corto.

import fs from "node:fs";
import { chat } from "./models.js";
import { loadAll } from "./memory.js";
import { loadAgent, loadMasterPrompt } from "./context.js";

function recentTasks() {
  if (!fs.existsSync("tasks")) return [];
  return fs.readdirSync("tasks")
    .filter(f => f.endsWith(".json"))
    .map(f => JSON.parse(fs.readFileSync(`tasks/${f}`, "utf8")))
    .filter(t => (Date.now() - new Date(t.created).getTime()) < 2 * 86400000);
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const tasks = recentTasks();
  const mems = loadAll().filter(m => (m.updated || "").startsWith(today.slice(0, 7)));

  const digest = [
    `Fecha: ${today}`,
    `Tareas recientes: ${tasks.map(t => `${t.id}[${t.status}] ${t.goal.slice(0, 60)}`).join(" | ") || "ninguna"}`,
    `Memorias tocadas este mes: ${mems.map(m => m.id).join(", ") || "ninguna"}`,
    `Esperando decisión humana: ${tasks.filter(t => t.status === "waiting_human").map(t => t.id).join(", ") || "nada"}`,
  ].join("\n");

  const system = `${loadMasterPrompt()}\n\n## TU ROL\n${loadAgent("diarist")}`;
  const user = `Datos de hoy:\n${digest}\n\nEscribe el diario. Responde SOLO el texto del diario en el formato indicado, sin JSON.`;

  let body;
  try {
    const out = await chat([{ role: "system", content: system }, { role: "user", content: user }], { tier: "cheap", max_tokens: 500 });
    body = out.text.trim();
  } catch (e) {
    body = `### 📓 ${today}\nNo pude generar el diario (${e.message}). Tareas: ${tasks.length}.`;
  }
  fs.writeFileSync("diary_output.md", body);
  console.log(body);
}

main().catch(e => { console.error(e); process.exit(1); });
