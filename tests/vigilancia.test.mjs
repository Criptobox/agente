// tests/vigilancia.test.mjs — prueba end-to-end del centinela SIN internet:
// levanta un servidor local que finge ser tiendamax.org, usa un catálogo
// local, y verifica que se detecten caídas, restablecimientos, productos
// nuevos, agotados, cambios de comisión y deploy desactualizado.
// Ejecutar: node tests/vigilancia.test.mjs

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { main as vigilar } from "../src/vigilancia.js";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vig-test-"));
const VIG = path.join(TMP, "vigilancia");
fs.mkdirSync(VIG, { recursive: true });

let productos = [
  { id: "p1", nombre: "Router WiFi", slug: "router-wifi", stock: 5, comision: 10, comisionMoneda: "USD", precioActual: 45, precioOriginal: 0, descuento: 0, fechaAgregado: new Date().toISOString() },
  { id: "p2", nombre: "Aceite 10W40", slug: "aceite-10w40", stock: 8, comision: 5, comisionMoneda: "USD", precioActual: 12, precioOriginal: 0, descuento: 0, fechaAgregado: new Date().toISOString() },
  { id: "p3", nombre: "Lámpara LED", slug: "lampara-led", stock: 0, comision: 1500, comisionMoneda: "MN", precioActual: 2200, precioOriginal: 0, descuento: 0, fechaAgregado: new Date(Date.now() - 5 * 86400000).toISOString() },
];
const catFile = path.join(TMP, "productos.json");
fs.writeFileSync(catFile, JSON.stringify(productos));

let sitioOk = true;
let siteProductos = JSON.stringify(productos); // lo que "sirve" la web

const server = http.createServer((req, res) => {
  if (!sitioOk) { res.writeHead(503); res.end("down"); return; }
  const ruta = req.url.split("?")[0];
  if (ruta === "/") { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<html><title>TiendaMax — Catálogo</title><body>TiendaMax ok</body></html>"); return; }
  if (ruta === "/productos.json") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(siteProductos); return; }
  if (ruta === "/productos-lite.json") { res.writeHead(200, { "Content-Type": "application/json" }); res.end("[]"); return; }
  if (ruta === "/manifest.json") { res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}"); return; }
  if (ruta === "/sw.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end("self.skipWaiting(); self.addEventListener('message',e=>{if(e.data==='SKIP_WAITING')self.skipWaiting();});"); return; }
  if (ruta === "/sitemap.xml") { res.writeHead(200, { "Content-Type": "application/xml" }); res.end("<urlset></urlset>"); return; }
  if (ruta === "/robots.txt") { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("User-agent: *"); return; }
  res.writeHead(404); res.end("nope");
});

const config = {
  web: [{
    nombre: "TiendaMax (prueba)", url: "http://127.0.0.1:{PORT}", primario: true, tiempoMaximoMs: 5000,
    checks: [
      { path: "/", debeContener: "TiendaMax", noContener: "(?i)404|en mantenimiento" },
      { path: "/productos.json", tipo: "json", esCatalogo: true },
      { path: "/productos-lite.json", tipo: "json" },
      { path: "/manifest.json", tipo: "json" },
      { path: "/sw.js", debeContener: "SKIP_WAITING" },
      { path: "/sitemap.xml", debeContener: "<urlset" },
      { path: "/robots.txt" },
    ],
  }],
  catalogo: { fileLocal: catFile, umbralStockBajo: 2 },
  telegram: { habilitado: false },
  historial: { mantenerRuns: 576 },
  alertas: { mantenerEnReporte: 120 },
  heartbeatMin: 60,
};

const PORT = 4799;
const cfgFile = path.join(TMP, "config.json");
fs.writeFileSync(cfgFile, JSON.stringify(config, null, 2).replace("{PORT}", String(PORT)));

const reporte = () => JSON.parse(fs.readFileSync(path.join(VIG, "reporte.json"), "utf8"));
const alertasDe = (tipo) => reporte().alertas.filter(a => a.tipo === tipo);
const run = () => vigilar([cfgFile, `--workdir=${TMP}`, "--no-telegram"]);

let failures = 0;
const check = (nombre, cond, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${nombre}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
};

await new Promise(r => server.listen(PORT, "127.0.0.1", r));
try {
  // 1) Seed: primera corrida, sin alertas de diff (solo el "nuevo" reciente de p1/p2 informativo)
  await run();
  let rep = reporte();
  check("seed: web ok", rep.web.every(w => w.ok));
  check("seed: catálogo leído (3)", rep.catalogo.n === 3, `n=${rep.catalogo.n}`);
  check("seed: sin alertas críticas", !rep.alertas.some(a => a.severidad === "critica"));
  check("seed: agotados contados (1)", rep.catalogo.agotados === 1, `agotados=${rep.catalogo.agotados}`);

  // 2) Cambios en el catálogo: nuevo producto + agotado + cambio de comisión + precio
  productos = [
    ...productos,
    { id: "p4", nombre: "Router 5G", slug: "router-5g", stock: 3, comision: 12, comisionMoneda: "USD", precioActual: 89, precioOriginal: 0, descuento: 0, fechaAgregado: new Date().toISOString() },
  ];
  productos.find(p => p.id === "p2").stock = 0;            // agotado
  productos.find(p => p.id === "p1").comision = 15;        // comisión 10 → 15
  productos.find(p => p.id === "p1").precioActual = 49;    // precio 45 → 49
  fs.writeFileSync(catFile, JSON.stringify(productos));
  siteProductos = JSON.stringify(productos);
  await run();
  rep = reporte();
  check("diff: producto nuevo detectado", alertasDe("nuevo").some(a => a.idProducto === "p4"));
  check("diff: agotado detectado", alertasDe("agotado").some(a => a.idProducto === "p2"), alertasDe("agotado").map(a => a.detalle).join(";"));
  check("diff: comisión detectada", alertasDe("comision").some(a => a.detalle.includes("10 USD → 15 USD")));
  check("diff: precio detectado", alertasDe("precio").some(a => a.detalle.includes("45 → 49")));
  check("diff: sin falsos positivos de web", !alertasDe("web_caida").length);

  // 3) Deploy desactualizado: la web sirve el catálogo viejo, el repo va por delante
  await run(); // consume la foto actual (la web y repo ya coinciden otra vez)
  productos = [...productos, { id: "p5", nombre: "Inversor", slug: "inversor", stock: 2, comision: 10, comisionMoneda: "USD", precioActual: 300, precioOriginal: 0, descuento: 0, fechaAgregado: new Date().toISOString() }];
  fs.writeFileSync(catFile, JSON.stringify(productos)); // repo avanza, web NO
  await run();
  rep = reporte();
  check("deploy: desactualizado detectado", alertasDe("deploy_desactualizado").length > 0, alertasDe("deploy_desactualizado").map(a => a.detalle).join(";"));

  // 4) Caída de la web → crítica; luego restablecimiento → info
  sitioOk = false;
  await run();
  check("caída: alerta crítica", alertasDe("web_caida").length > 0);
  sitioOk = true;
  await run();
  check("restablecida: alerta info", alertasDe("web_ok").length > 0);

  // 5) Idempotencia: otra corrida sin cambios no reescribe nada
  const mtime = fs.statSync(path.join(VIG, "reporte.json")).mtimeMs;
  await run();
  check("sin cambios: no se reescribe el reporte", Math.abs(fs.statSync(path.join(VIG, "reporte.json")).mtimeMs - mtime) < 1000);

  // 6) Historial con entradas
  const hist = JSON.parse(fs.readFileSync(path.join(VIG, "historial.json"), "utf8"));
  check("historial: entradas registradas", hist.length >= 5, `entradas=${hist.length}`);

  // 7) Digest con fallback determinista (sin IA configurada debe generar sugerencias)
  execFileSync("node", [path.join(ROOT, "src/vigia-digest.js")], { encoding: "utf8", cwd: TMP, env: { ...process.env, GROQ_API_KEY: "", GEMINI_API_KEY: "", MISTRAL_API_KEY: "", OPENROUTER_API_KEY: "", ZAI_API_KEY: "" } });
  const repDig = reporte();
  check("digest: resumen escrito", !!repDig.digest?.resumen);
  check("digest: sugerencias escritas", (repDig.sugerencias || []).length > 0, `n=${(repDig.sugerencias || []).length}`);
} finally {
  server.close();
}
console.log(failures === 0 ? "\n🎉 Todo verde." : `\n💥 ${failures} fallos.`);
process.exit(failures === 0 ? 0 : 1);
