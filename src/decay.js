// src/decay.js
// RELOJ DE DECAIMIENTO. Corre en el reindex nocturno.
// 1. Genera memory/index.json (para el dashboard).
// 2. Baja confianza y marca stale las memorias viejas o cuyo código pudo cambiar.
// 3. Detecta decisiones que cumplen su condición de "reconsiderar".
// No borra NADA. Solo marca y avisa.

import fs from "node:fs";
import path from "node:path";
import { loadAll } from "./memory.js";

const HALF_LIFE_DAYS = 90;      // a los 90 días una memoria no reconfirmada pierde peso
const STALE_AFTER_DAYS = 120;   // a los 120 días sin update -> stale

function daysSince(dateStr) {
  if (!dateStr) return 9999;
  const d = new Date(dateStr);
  if (isNaN(d)) return 9999;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function setMeta(file, key, value) {
  const raw = fs.readFileSync(file, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return;
  let fm = m[1];
  const line = new RegExp(`^${key}:.*$`, "m");
  const val = Array.isArray(value) ? `[${value.join(", ")}]` : value;
  fm = line.test(fm) ? fm.replace(line, `${key}: ${val}`) : `${fm}\n${key}: ${val}`;
  fs.writeFileSync(file, `---\n${fm}\n---\n${m[2]}`);
}

function main() {
  const all = loadAll();
  const alerts = [];
  const index = [];

  for (const m of all) {
    const age = daysSince(m.updated || m.created);

    // Decaimiento de confianza (no baja de 30, y nunca toca las verificadas por test).
    if (typeof m.confidence === "number" && !m.verified_by && age > HALF_LIFE_DAYS) {
      const decayed = Math.max(30, Math.round(m.confidence * Math.pow(0.5, age / HALF_LIFE_DAYS)));
      if (decayed < m.confidence) { setMeta(m._file, "confidence", decayed); m.confidence = decayed; }
    }

    // Marcar stale. Proyecto y criterio no caducan como un bug: son estado vivo.
    const NO_DECAY = ["criterio", "project"];
    if (age > STALE_AFTER_DAYS && m.stale !== true && !NO_DECAY.includes(m.type)) {
      setMeta(m._file, "stale", true);
      m.stale = true;
      alerts.push(`⏳ ${m.id} lleva ${age} días sin reconfirmar → marcada stale (reverificar contra código actual).`);
    }

    // Decisiones a reconsiderar (si el body contiene "reconsiderar" y ya pasó tiempo).
    if (m.type === "decision" && m.status === "active" && age > 60) {
      alerts.push(`🔁 ${m.id} (${m.title || ""}) tiene 60+ días. Revisa si su condición de "reconsiderar" ya se cumple.`);
    }

    index.push({
      id: m.id, type: m.type, title: m.title || m.statement || "",
      confidence: m.confidence ?? null, stale: m.stale === true, project: m.project || null,
    });
  }

  fs.mkdirSync("memory", { recursive: true });
  fs.writeFileSync(path.join("memory", "index.json"), JSON.stringify(index, null, 2));

  const report = alerts.length
    ? `### 🕰️ Reloj de decaimiento\n${alerts.map(a => "- " + a).join("\n")}`
    : `### 🕰️ Reloj de decaimiento\nNada que reportar. Memoria sana.`;
  fs.writeFileSync("decay_output.md", report);
  console.log(report);
  console.log(`\nindex.json: ${index.length} memorias.`);
}

main();
