// src/tools.js
// Implementación real de las "tools" que los agentes ya declaraban en
// agents/*.md (antes eran solo prosa: el modelo nunca podía llamarlas de
// verdad). Cada tool está acotada a propósito:
//   - lectura de archivos: solo dentro del checkout del proyecto (./target,
//     ver agent-run.yml), nunca del propio cerebro ni del filesystem del runner.
//   - tests: se ejecuta un comando FIJO declarado por el proyecto
//     (memory/projects/<slug>.md: test_cmd), nunca texto libre del modelo.
//     Así una tarea manipulada (prompt injection en un Issue) no puede
//     convertirse en ejecución de comandos arbitrarios.
//   - peticiones HTTP: solo contra el propio SANDBOX_URL del job, para
//     evitar SSRF hacia cualquier otro host.

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { search as memorySearch } from "./memory.js";

const MAX_FILE_BYTES = 20000;
const MAX_LIST_ENTRIES = 300;
const MAX_HTTP_BYTES = 20000;

function projectRoot() {
  const dir = process.env.PROJECT_DIR;
  if (!dir || !fs.existsSync(dir)) return null;
  return path.resolve(dir);
}

// Evita que "path" salga de la raíz del proyecto (../../etc/passwd, etc.).
function resolveInRoot(root, rel) {
  const target = path.resolve(root, rel || ".");
  const relCheck = path.relative(root, target);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    throw new Error("ruta fuera del proyecto");
  }
  return target;
}

function readFileTool({ path: relPath }) {
  const root = projectRoot();
  if (!root) return { error: "sin repo de proyecto asociado a esta tarea (no hay checkout de código)" };
  const full = resolveInRoot(root, relPath);
  const stat = fs.statSync(full);
  if (!stat.isFile()) return { error: "no es un archivo" };
  let content = fs.readFileSync(full, "utf8");
  let truncated = false;
  if (content.length > MAX_FILE_BYTES) { content = content.slice(0, MAX_FILE_BYTES); truncated = true; }
  return { path: relPath, content, truncated };
}

function listFilesTool({ dir }) {
  const root = projectRoot();
  if (!root) return { error: "sin repo de proyecto asociado a esta tarea (no hay checkout de código)" };
  const start = resolveInRoot(root, dir || ".");
  const out = [];
  const walk = (d) => {
    if (out.length >= MAX_LIST_ENTRIES) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(d, entry.name);
      out.push(path.relative(root, full) + (entry.isDirectory() ? "/" : ""));
      if (out.length >= MAX_LIST_ENTRIES) return;
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(start);
  return { entries: out, truncated: out.length >= MAX_LIST_ENTRIES };
}

function memorySearchTool({ query }) {
  const results = memorySearch(query || "", { limit: 6 });
  return {
    results: results.map(m => ({
      id: m.id, type: m.type,
      title: m.title || m.statement || m.rule || m.name || "",
      confidence: m.confidence ?? null, stale: m.stale === true,
    })),
  };
}

function testingRunTool() {
  const root = projectRoot();
  if (!root) return Promise.resolve({ error: "sin repo de proyecto asociado a esta tarea" });
  const projFile = process.env.PROJECT_META_FILE; // memory/projects/<slug>.md, lo resuelve el workflow
  let cmdLine = null;
  if (projFile && fs.existsSync(projFile)) {
    const m = fs.readFileSync(projFile, "utf8").match(/^test_cmd:\s*(.+)$/m);
    if (m) cmdLine = m[1].trim();
  }
  if (!cmdLine) {
    return Promise.resolve({ error: "el proyecto no tiene 'test_cmd' configurado en su memory/projects/*.md" });
  }
  const [cmd, ...args] = cmdLine.split(/\s+/);
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: root, timeout: 90000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        cmd: cmdLine,
        exit_code: err ? (err.code ?? 1) : 0,
        stdout: String(stdout || "").slice(-4000),
        stderr: String(stderr || "").slice(-2000),
      });
    });
  });
}

async function sandboxRequestTool({ path: relPath = "/", method = "GET", body = null }) {
  const base = process.env.SANDBOX_URL;
  if (!base) return { error: "SANDBOX_URL no está definido (esta tarea no corre en el sandbox efímero)" };
  let url, baseOrigin;
  try { url = new URL(relPath, base); baseOrigin = new URL(base).origin; } catch { return { error: "URL inválida" }; }
  if (url.origin !== baseOrigin) return { error: "solo se permiten peticiones al propio sandbox (SANDBOX_URL)" };
  const m = String(method || "GET").toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(m)) return { error: "método no permitido" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: m,
      headers: body != null ? { "Content-Type": "application/json" } : undefined,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = (await res.text()).slice(0, MAX_HTTP_BYTES);
    return { status: res.status, body: text };
  } catch (e) {
    return { error: e.message };
  } finally {
    clearTimeout(t);
  }
}

function guard(fn) {
  return async (args) => {
    try { return await fn(args); } catch (e) { return { error: e.message }; }
  };
}

// Nombre declarado en "tools:" de agents/*.md -> schema (function-calling) + implementación.
const REGISTRY = {
  "github.read_file": {
    schema: {
      type: "function",
      function: {
        name: "github_read_file",
        description: "Lee el contenido de un archivo del repo del proyecto (checkout de solo lectura, ./target).",
        parameters: { type: "object", properties: { path: { type: "string", description: "ruta relativa del archivo" } }, required: ["path"] },
      },
    },
    run: guard(readFileTool),
  },
  "github.list_files": {
    schema: {
      type: "function",
      function: {
        name: "github_list_files",
        description: "Lista archivos y carpetas del repo del proyecto (recursivo, acotado a 300 entradas).",
        parameters: { type: "object", properties: { dir: { type: "string", description: "carpeta relativa, por defecto la raíz" } } },
      },
    },
    run: guard(listFilesTool),
  },
  "memory.search": {
    schema: {
      type: "function",
      function: {
        name: "memory_search",
        description: "Busca en la memoria compartida (errores, decisiones, hechos, lecciones) por texto libre. Úsala si necesitas afinar más allá de lo que ya viene en el contexto.",
        parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
    },
    run: guard(memorySearchTool),
  },
  "testing.run": {
    schema: {
      type: "function",
      function: {
        name: "testing_run",
        description: "Ejecuta el comando de test declarado por el proyecto (memory/projects/*.md: test_cmd) y devuelve exit code + salida. No acepta comandos libres.",
        parameters: { type: "object", properties: {} },
      },
    },
    run: guard(testingRunTool),
  },
  "sandbox.request": {
    schema: {
      type: "function",
      function: {
        name: "sandbox_request",
        description: "Hace una petición HTTP contra el sandbox efímero (SANDBOX_URL). Solo funciona dentro de sandbox-breaker.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "ruta (o URL completa) dentro del sandbox, ej. /carrito" },
            method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
            body: { type: "object" },
          },
        },
      },
    },
    run: guard(sandboxRequestTool),
  },
};

// Extrae la lista declarada en "tools: [a, b, c]" del markdown del agente.
export function declaredTools(agentMarkdown) {
  const m = agentMarkdown.match(/^tools:\s*\[(.*)\]\s*$/m);
  if (!m) return [];
  return m[1].split(",").map(s => s.trim()).filter(Boolean);
}

// Solo se ofrecen al modelo las tools que el agente declara Y que están
// implementadas aquí. El resto (web.search, browser.*, task.*, github.create_pr...)
// no está disponible todavía: el agente sigue funcionando en modo texto para esas.
export function toolsForAgent(agentMarkdown) {
  const names = declaredTools(agentMarkdown).filter(n => REGISTRY[n]);
  const byFunctionName = {};
  for (const n of names) byFunctionName[REGISTRY[n].schema.function.name] = REGISTRY[n];
  return {
    schemas: names.map(n => REGISTRY[n].schema),
    async run(functionName, argsJson) {
      const entry = byFunctionName[functionName];
      if (!entry) return { error: `tool desconocida: ${functionName}` };
      let args = {};
      if (argsJson) {
        try { args = JSON.parse(argsJson); } catch { return { error: "argumentos no parseables" }; }
      }
      return entry.run(args);
    },
  };
}
