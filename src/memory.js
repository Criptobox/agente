// src/memory.js
// La memoria son archivos markdown con frontmatter YAML, versionados en git.
// No hay base de datos: el repo ES la base de datos, y git log es la auditoría.

import fs from "node:fs";
import path from "node:path";

const ROOT = "memory";
const DIRS = ["errors", "decisions", "facts", "lessons", "projects"];

// --- Parser mínimo de frontmatter (sin dependencias) ---
function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    let [, k, v] = kv;
    v = v.trim();
    if (v.startsWith("[") && v.endsWith("]")) {
      v = v.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else if (v === "true") v = true;
    else if (v === "false") v = false;
    else if (v === "null" || v === "") v = null;
    else if (/^-?\d+$/.test(v)) v = parseInt(v, 10);
    else v = v.replace(/^["']|["']$/g, "");
    meta[k] = v;
  }
  return { meta, body: m[2] };
}

export function loadAll() {
  const items = [];
  for (const dir of DIRS) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const file of fs.readdirSync(full)) {
      if (!file.endsWith(".md")) continue;
      const raw = fs.readFileSync(path.join(full, file), "utf8");
      const { meta, body } = parseFrontmatter(raw);
      items.push({ ...meta, body, _file: path.join(full, file) });
    }
  }
  return items;
}

// Búsqueda LÉXICA híbrida (F0: sin embeddings todavía).
// Puntúa por: proyecto, archivos/símbolos mencionados, tags, y palabras del texto.
export function search(query, { project = null, files = [], symbols = [], limit = 8 } = {}) {
  const items = loadAll();
  const q = query.toLowerCase();
  const qWords = new Set(q.split(/\W+/).filter(w => w.length > 3));
  const scored = items.map(it => {
    let score = 0;
    if (project && it.project === project) score += 3;
    const itFiles = [].concat(it.files || []);
    const itSyms  = [].concat(it.symbols || []);
    const itTags  = [].concat(it.tags || []);
    for (const f of files)   if (itFiles.some(x => String(x).includes(f))) score += 5;
    for (const s of symbols) if (itSyms.some(x  => String(x).includes(s))) score += 5;
    for (const t of itTags)  if (q.includes(String(t).toLowerCase())) score += 2;
    const hay = `${it.title || ""} ${it.statement || ""} ${it.body || ""}`.toLowerCase();
    for (const w of qWords) if (hay.includes(w)) score += 1;
    // Penaliza memorias marcadas obsoletas (ver invalidación).
    if (it.stale === true) score *= 0.5;
    return { it, score };
  }).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map(x => x.it);
}

// Escribe una memoria estructurada. type: error|decision|fact|lesson
export function write(type, id, meta, body) {
  const dir = { error: "errors", decision: "decisions", fact: "facts", lesson: "lessons" }[type];
  if (!dir) throw new Error(`tipo de memoria desconocido: ${type}`);
  const lines = ["---"];
  for (const [k, v] of Object.entries(meta)) {
    const val = Array.isArray(v) ? `[${v.join(", ")}]` : v;
    lines.push(`${k}: ${val}`);
  }
  lines.push("---", "", body.trim(), "");
  const file = path.join(ROOT, dir, `${id}.md`);
  fs.writeFileSync(file, lines.join("\n"));
  return file;
}
