// tests/vigilancia.test.mjs — prueba end-to-end del centinela SIN internet:
// levanta una web local (finge ser axontech92.github.io/AXONTECH) y un
// Supabase local (finge ser gdzsqwyedzrfituewdtt.supabase.co), y verifica:
// seed, diff (nuevo, agotado, repuesto, comisión, precio), consulta barata
// "sin cambios" (sin reescritura), deploy desactualizado, caída/restablecido
// de la web, historial y digest con fallback determinista.
// Ejecutar: node tests/vigilancia.test.mjs

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main as vigilar } from "../src/vigilancia.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vig-test-"));
const VIG = path.join(TMP, "vigilancia");
fs.mkdirSync(VIG, { recursive: true });

// ── "Supabase" local: productos con updated_at (como la tabla productos de AXONTECH) ──
let sbClock = "2026-08-22T10:00:00.000Z";
let sbProductos = [
  { id: "p1", nombre: "CARGADOR INTELIGENTE 20A", stock: 5, comision: 10, precioActual: 45, precioOriginal: 0, descuento: 0 },
  { id: "p2", nombre: "ROUTER WIFI 6", stock: 8, comision: 5, precioActual: 12, precioOriginal: 0, descuento: 0 },
  { id: "p3", nombre: "LÁMPARA LED 12W", stock: 0, comision: 1500, precioActual: 2200, precioOriginal: 0, descuento: 0 },
];
const sbServer = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (!u.pathname.endsWith("/rest/v1/productos")) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": "application/json" });
  if ((u.searchParams.get("select") || "").includes("updated_at") && u.searchParams.get("limit") === "1") {
    res.end(JSON.stringify([{ updated_at: sbClock }]));
    return;
  }
  res.end(JSON.stringify(sbProductos.map(p => ({ id: p.id, data: p, updated_at: sbClock }))));
});

// ── "Página" local: index + productos.json servido (para checks y deploy) ──
let sitioOk = true;
let siteProductos = JSON.stringify(sbProductos); // lo que "sirve" la web
const catFile = path.join(TMP, "productos.json");
fs.writeFileSync(catFile, siteProductos);

const webServer = http.createServer((req, res) => {
  if (!sitioOk) { res.writeHead(503); res.end("down"); return; }
  const ruta = req.url.split("?")[0];
  if (ruta === "/") { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<html><title>AXONTECH · Gestión de Ventas</title><body>AXONTECH ok</body></html>"); return; }
  if (ruta === "/productos.json") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(siteProductos); return; }
  if (ruta === "/data.json") { res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}"); return; }
  if (ruta === "/manifest.json") { res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}"); return; }
  if (ruta === "/sw.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end("const CACHE='AXONTECH-v1';"); return; }
  res.writeHead(404); res.end("nope");
});

const config = {
  web: [{
    nombre: "AXONTECH (prueba)", url: "http://127.0.0.1:{PORT}", tiempoMaximoMs: 5000,
    checks: [
      { path: "/", debeContener: "AXONTECH", noContener: "(?i)404 Not Found|error interno" },
      { path: "/productos.json", tipo: "json", esCatalogo: true },
      { path: "/data.json", tipo: "json" },
      { path: "/manifest.json", tipo: "json" },
      { path: "/sw.js", debeContener: "AXONTECH" },
    ],
    deploy: { fileLocal: catFile, archivo: "productos.json" },
  }],
  catalogos: [{
    nombre: "AXONTECH (prueba)",
    supabase: { url: "http://127.0.0.1:{SB_PORT}", key: "k", tabla: "productos" },
    fileLocal: catFile, // fallback para pruebas
    umbralStockBajo: 2,
    campos: ["id", "nombre", "stock", "comision", "precioActual", "precioOriginal", "descuento"],
  }],
  telegram: { habilitado: false },
  historial: { mantenerRuns: 576 },
  alertas: { mantenerEnReporte: 120 },
  heartbeatMin: 60,
};

const PORT = 4799, SB_PORT = 4798;
const cfgFile = path.join(TMP, "config.json");
fs.writeFileSync(cfgFile, JSON.stringify(config, null, 2)
  .replace("{PORT}", String(PORT)).replace("{SB_PORT}", String(SB_PORT)));

const reporte = () => JSON.parse(fs.readFileSync(path.join(VIG, "reporte.json"), "utf8"));
const alertasDe = (tipo) => reporte().alertas.filter(a => a.tipo === tipo);
const run = () => vigilar([cfgFile, `--workdir=${TMP}`, "--no-telegram"]);
const bump = () => { sbClock = new Date(Date.now()).toISOString(); };

let failures = 0;
const check = (nombre, cond, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${nombre}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
};

await new Promise(r => sbServer.listen(SB_PORT, "127.0.0.1", r));
await new Promise(r => webServer.listen(PORT, "127.0.0.1", r));
try {
  // 1) Seed: primera foto desde Supabase
  await run();
  let rep = reporte();
  check("seed: web ok", rep.web.every(w => w.ok));
  check("seed: catálogo leído desde Supabase (3)", rep.catalogos?.[0]?.n === 3, `n=${rep.catalogos?.[0]?.n}`);
  check("seed: sin alertas críticas", !rep.alertas.some(a => a.severidad === "critica"));
  check("seed: agotados contados (1)", rep.catalogos[0].agotados === 1, `agotados=${rep.catalogos[0].agotados}`);
  check("seed: stats en catalogos[] y catalogo (compat)", rep.catalogo?.n === 3);

  // 2) Cambios en Supabase: nuevo + agotado + comisión + precio + repuesto
  sbProductos = [
    ...sbProductos,
    { id: "p4", nombre: "INVERSOR HÍBRIDO 5kW", stock: 3, comision: 12, precioActual: 89, precioOriginal: 0, descuento: 0 },
  ];
  sbProductos.find(p => p.id === "p2").stock = 0;        // agotado
  sbProductos.find(p => p.id === "p1").comision = 15;    // comisión 10 → 15
  sbProductos.find(p => p.id === "p1").precioActual = 49;// precio 45 → 49
  sbProductos.find(p => p.id === "p3").stock = 6;        // repuesto 0 → 6
  siteProductos = JSON.stringify(sbProductos);
  bump();
  await run();
  rep = reporte();
  check("diff: producto nuevo detectado", alertasDe("nuevo").some(a => a.idProducto === "p4"));
  check("diff: agotado detectado", alertasDe("agotado").some(a => a.idProducto === "p2"), alertasDe("agotado").map(a => a.detalle).join(";"));
  check("diff: repuesto detectado", alertasDe("repuesto").some(a => a.idProducto === "p3" && a.detalle.includes("0 → 6")));
  check("diff: comisión detectada", alertasDe("comision").some(a => a.detalle.includes("10 → 15")));
  check("diff: precio detectado", alertasDe("precio").some(a => a.detalle.includes("45 → 49")));
  check("diff: alerta lleva el nombre del catálogo", alertasDe("agotado")[0].catalogo === "AXONTECH (prueba)");

  // 3) Consulta barata: sin cambios en Supabase → no reescribe nada
  const mtime = fs.statSync(path.join(VIG, "reporte.json")).mtimeMs;
  await run();
  check("sin cambios: no se reescribe el reporte", Math.abs(fs.statSync(path.join(VIG, "reporte.json")).mtimeMs - mtime) < 1000);

  // 4) Deploy desactualizado: el repo (catFile) avanza, la web sirve lo viejo
  fs.writeFileSync(catFile, JSON.stringify([...sbProductos, { id: "p9", nombre: "EXTRA", stock: 1, comision: 1, precioActual: 1 }]));
  bump(); // nota: el catálogo vive en Supabase; este cambio es solo del archivo del repo
  await run();
  rep = reporte();
  check("deploy: desactualizado detectado", alertasDe("deploy_desactualizado").length > 0, alertasDe("deploy_desactualizado").map(a => a.detalle).join(";"));
  siteProductos = fs.readFileSync(catFile, "utf8"); // la web se sincroniza
  await run();

  // 5) Caída de la web → crítica; restablecimiento → info
  sitioOk = false;
  bump();
  await run();
  check("caída: alerta crítica", alertasDe("web_caida").length > 0);
  sitioOk = true;
  await run();
  check("restablecida: alerta info", alertasDe("web_ok").length > 0);

  // 6) Historial con entradas
  const hist = JSON.parse(fs.readFileSync(path.join(VIG, "historial.json"), "utf8"));
  check("historial: entradas registradas", hist.length >= 5, `entradas=${hist.length}`);

  // 7) Digest con fallback determinista (sin IA configurada debe generar sugerencias)
  execFileSync("node", [path.join(ROOT, "src/vigia-digest.js")], { encoding: "utf8", cwd: TMP, env: { ...process.env, GROQ_API_KEY: "", GEMINI_API_KEY: "", MISTRAL_API_KEY: "", OPENROUTER_API_KEY: "", ZAI_API_KEY: "" } });
  const repDig = reporte();
  check("digest: resumen escrito", !!repDig.digest?.resumen);
  check("digest: sugerencias escritas", (repDig.sugerencias || []).length > 0, `n=${(repDig.sugerencias || []).length}`);
} finally {
  sbServer.close();
  webServer.close();
}
console.log(failures === 0 ? "\n🎉 Todo verde." : `\n💥 ${failures} fallos.`);
process.exit(failures === 0 ? 0 : 1);
