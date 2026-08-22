// src/vigia-digest.js
// VIGIA DIARIO: una vez al día, convierte los datos crudos de vigilancia/
// (reporte.json + historial.json) en un resumen corto en español y en
// sugerencias concretas para kros. Es el ÚNICO paso que usa IA de toda la
// vigilancia (tier cheap, ~600 tokens/día). Si la IA no está disponible,
// genera sugerencias deterministas a partir de los datos, y nunca se pierde
// el ciclo por ello.

import fs from "node:fs";
import { chat } from "./models.js";
import { loadAgent, loadMasterPrompt } from "./context.js";

const REPORTE = "vigilancia/reporte.json";
const HISTORIAL = "vigilancia/historial.json";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
const fmtTiempo = (ts) => {
  const d = new Date(ts);
  return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")} UTC`;
};
const horasAtras = (ts) => Math.round((Date.now() - new Date(ts).getTime()) / 3600000);

function resumenDatos(reporte, historial) {
  const corte = Date.now() - 48 * 3600000;
  const runs = (historial || []).filter(h => new Date(h.ts).getTime() > corte);
  const caidas = runs.filter(h => !h.webOk).length;
  const criticas = (reporte.alertas || []).filter(a => horasAtras(a.ts) <= 48 && a.severidad === "critica");
  const avisos = (reporte.alertas || []).filter(a => horasAtras(a.ts) <= 48 && a.severidad === "aviso");
  const lineas = [
    `Ventana: últimas 48 h · revisiones: ${runs.length}`,
    `Web: ${caidas === 0 ? "sin caídas" : `${caidas} revisiones con caída`} · tiempo máx de respuesta: ${Math.max(0, ...runs.map(r => r.ms || 0))} ms`,
    `Catálogo: ${reporte.catalogo?.n ?? "?"} productos · agotados ahora: ${reporte.catalogo?.agotados ?? "?"} · stock bajo: ${reporte.catalogo?.stockBajo ?? "?"}`,
    `Últimas 24h: ${reporte.catalogo?.nuevos24h ?? 0} nuevos · ${reporte.catalogo?.agotados24h ?? 0} agotados · ${reporte.catalogo?.comisiones24h ?? 0} cambios de comisión`,
    `Críticas (48h): ${criticas.length ? criticas.map(a => `${a.titulo} (${fmtTiempo(a.ts)})`).join("; ") : "ninguna"}`,
    `Avisos (48h): ${avisos.length ? avisos.slice(0, 12).map(a => `${a.titulo} — ${a.detalle} (${fmtTiempo(a.ts)})`).join(" | ") : "ninguno"}`,
  ];
  return lineas.join("\n");
}

// Sugerencias deterministas (fallback sin IA): siempre accionables, con dato real.
function sugerenciasFallback(reporte, historial) {
  const s = [];
  const c = reporte.catalogo || {};
  if (c.agotados > 0) s.push({
    id: "F-agotados", titulo: `Revisar los ${c.agotados} productos agotados`,
    detalle: `Casi la mitad del catálogo está con stock 0. Decide cuáles reponer, cuáles ocultar de la portada y cuáles marcar como "bajo pedido" para no perder ventas.`,
    impacto: "alto", categoria: "venta",
  });
  if ((c.agotados24h || 0) > 0) s.push({
    id: "F-rotacion", titulo: `Hay productos que se agotaron en las últimas 24 h`,
    detalle: "Esos son tus más vendidos: prioriza reponerlos y revisa si merecen una sección de \"más vendidos\".",
    impacto: "medio", categoria: "venta",
  });
  const runs = (historial || []).slice(0, 144);
  const caidas = runs.filter(h => !h.webOk).length;
  if (caidas > 0) s.push({
    id: "F-caidas", titulo: `La web tuvo ${caidas} revisiones con fallo`,
    detalle: "Mira la pestaña Vigilancia → alertas para ver el detalle. Si se repite, revisa el workflow pages del repo TiendaMax y el dominio tiendamax.org.",
    impacto: "alto", categoria: "preventiva",
  });
  const lenta = runs.find(h => h.ms > 4000);
  if (lenta) s.push({
    id: "F-lenta", titulo: "La portada tardó más de 4 s en responder",
    detalle: "Para conexiones 3G en Cuba eso resta ventas. Revisa peso de imágenes (webp), lazy-loading y el service worker de TiendaMax.",
    impacto: "medio", categoria: "preventiva",
  });
  const deploy = (reporte.alertas || []).find(a => a.tipo === "deploy_desactualizado" && horasAtras(a.ts) <= 48);
  if (deploy) s.push({
    id: "F-deploy", titulo: "La web publicada no coincide con el repo",
    detalle: "Hay un deploy pendiente o fallido en TiendaMax. Revisa la pestaña Actions del repo de la tienda.",
    impacto: "alto", categoria: "sistema",
  });
  s.push({
    id: "F-telegram", titulo: "Activa los avisos por Telegram del centinela",
    detalle: "Con los secrets TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en el repo agente, las caídas y los agotados te llegan al móvil al instante, sin abrir la app.",
    impacto: "bajo", categoria: "sistema",
  });
  return s.slice(0, 5);
}

function parseJsonAI(texto) {
  const ini = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (ini === -1 || fin <= ini) return null;
  try { return JSON.parse(texto.slice(ini, fin + 1)); }
  catch { return null; }
}

async function main() {
  const reporte = readJson(REPORTE, null);
  const historial = readJson(HISTORIAL, []);
  if (!reporte) { console.log("Sin reporte de vigilancia todavía; nada que digerir."); process.exit(0); }

  const datos = resumenDatos(reporte, historial);
  let system;
  try {
    system = `${loadMasterPrompt()}\n\n## TU ROL\n${loadAgent("vigia")}`;
  } catch {
    system = "Eres el vigía del sistema: resumes los datos de vigilancia y propones mejoras en español, directas y verificables.";
  }
  const user = `Datos reales de vigilancia (no los inventes ni los cambies):\n${datos}\n\n` +
    `Responde SOLO con JSON válido, sin texto alrededor:\n` +
    `{ "resumen": "2-4 frases directas para kros: qué pasó y qué mirar hoy", ` +
    `"sugerencias": [ { "id": "S-1", "titulo": "...", "detalle": "...", "impacto": "alto|medio|bajo", "categoria": "venta|higiene|preventiva|sistema" } ] }\n` +
    `Máximo 4 sugerencias, ordenadas por impacto. Cada sugerencia debe nombrar el dato concreto que la justifica.`;

  let out = null;
  try {
    const res = await chat([{ role: "system", content: system }, { role: "user", content: user }], { tier: "cheap", max_tokens: 800, json: true });
    out = parseJsonAI(res.text);
    if (!out) console.log("Respuesta de la IA sin JSON válido; uso sugerencias deterministas.");
  } catch (e) {
    console.log(`IA no disponible (${e.message}); uso sugerencias deterministas.`);
  }

  const resumen = out?.resumen?.trim() ||
    `Día revisado por el centinela: ${reporte.resumen}. Sin comentarios adicionales.`;
  const nuevas = Array.isArray(out?.sugerencias) && out.sugerencias.length
    ? out.sugerencias.filter(s => s?.titulo).map((s, i) => ({
        id: s.id || `S-${Date.now()}-${i}`,
        titulo: String(s.titulo).slice(0, 140),
        detalle: String(s.detalle || "").slice(0, 500),
        impacto: ["alto", "medio", "bajo"].includes(s.impacto) ? s.impacto : "medio",
        categoria: ["venta", "higiene", "preventiva", "sistema"].includes(s.categoria) ? s.categoria : "sistema",
        creada: new Date().toISOString(),
      }))
    : sugerenciasFallback(reporte, historial).map(s => ({ ...s, creada: new Date().toISOString() }));

  // Fusionar con las anteriores conservando el estado que kros les haya dado en la app.
  const previas = reporte.sugerencias || [];
  const porTitulo = new Map(previas.map(s => [s.titulo, s]));
  const fusion = nuevas.map(s => ({ ...(porTitulo.get(s.titulo) || {}), ...s }))
    .concat(previas.filter(s => !nuevas.some(n => n.titulo === s.titulo)))
    .slice(0, 10);

  reporte.digest = {
    fecha: new Date().toISOString(),
    resumen,
    generadoPor: "vigia",
    conIA: !!out,
  };
  reporte.sugerencias = fusion;

  fs.mkdirSync("vigilancia", { recursive: true });
  fs.writeFileSync(REPORTE, JSON.stringify(reporte, null, 2));

  const md = [
    `### 🛰️ Vigía — digest de vigilancia`,
    "",
    resumen,
    "",
    "**Sugerencias:**",
    ...fusion.slice(0, 5).map(s => `- [${s.impacto}/${s.categoria}] ${s.titulo} — ${s.detalle}`),
    "",
    `_generado ${new Date().toISOString()} · IA: ${out ? "sí" : "fallback determinista"}_`,
  ].join("\n");
  fs.writeFileSync("vigia_output.md", md);
  console.log(md);
}

main().catch(e => { console.error("vigia falló:", e.message); process.exit(1); });
