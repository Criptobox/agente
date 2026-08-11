// src/resolve-project.js
// Se corre ANTES del agente. Mira si la tarea tiene un proyecto con repo
// conocido (memory/projects/<slug>.md: repo: owner/repo) y expone ese dato
// al workflow (vía GITHUB_OUTPUT) para que pueda hacer un segundo checkout
// (./target) con el código real. Sin esto, los agentes solo podían razonar
// sobre texto de memoria y nunca sobre el código actual, aunque sus tools
// (github.read_file, testing.run) ya existieran declaradas.

import fs from "node:fs";
import { safeId } from "./util.js";

function emit(k, v) {
  const out = process.env.GITHUB_OUTPUT;
  if (out) fs.appendFileSync(out, `${k}=${v}\n`);
}

try {
  const taskId = safeId(process.env.TASK_ID);
  const task = JSON.parse(fs.readFileSync(`tasks/${taskId}.json`, "utf8"));
  const slug = task.project;
  if (slug) {
    safeId(slug); // valida antes de construir la ruta
    const metaFile = `memory/projects/${slug}.md`;
    if (fs.existsSync(metaFile)) {
      const m = fs.readFileSync(metaFile, "utf8").match(/^repo:\s*(\S+)/m);
      if (m) {
        emit("repo", m[1].trim());
        emit("meta_file", metaFile);
        console.log(`Proyecto detectado: ${slug} -> ${m[1].trim()}`);
        process.exit(0);
      }
    }
  }
  console.log("Sin repo de proyecto asociado a esta tarea (o proyecto sin 'repo:' en memory/projects/*.md). Los agentes trabajarán solo con memoria de texto, sin código real.");
} catch (e) {
  console.log("No se pudo resolver el proyecto de la tarea:", e.message);
}
