// src/vigilancia.js
// CENTINELA DE LA TIENDA (vigilancia continua).
// Corre cada pocos minutos vía .github/workflows/vigilancia.yml.
// Determinista y SIN IA (coste $0): revisa la web publicada, diffea el
// catálogo de productos del repo (Criptobox/TiendaMax → productos.json) y
// detecta: caídas, web lenta, deploy desactualizado, productos nuevos,
// agotados, reposiciones, cambios de comisión y de precio.
// Escribe vigilancia/{reporte,estado,historial}.json, que el dashboard
// (pestaña Vigilancia) lee directamente. Opcional: aviso por Telegram
// (secrets TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) solo en transiciones.
//
// Uso: node src/vigilancia.js [configFile] [--workdir=DIR] [--no-telegram]

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const now = () => new Date().toISOString();

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}
const mismo = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function fetchTimeout(url, ms, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal, redirect: "follow" }); }
  finally { clearTimeout(t); }
}

// ---------- CATÁLOGO ----------

async function cargarCatalogo(cfg) {
  const c = cfg.catalogo || {};
  const errors = [];
  if (c.fileLocal) { // solo para pruebas locales (apunta a un archivo del disco)
    try { return { productos: leerProductos(JSON.parse(fs.readFileSync(c.fileLocal, "utf8"))), fuente: c.fileLocal }; }
    catch (e) { errors.push(`local (${e.message})`); }
  }
  if (c.repo) {
    const rawUrl = `https://raw.githubusercontent.com/${c.repo}/${c.rama || "main"}/${c.archivo}`;
    try {
      const res = await fetchTimeout(rawUrl, 20000);
      if (res.ok) return { productos: leerProductos(await res.json()), fuente: rawUrl };
      errors.push(`raw ${res.status}`);
    } catch (e) { errors.push(`raw (${e.message})`); }
    // fallback: API de GitHub (funciona aunque raw falle; con token, sin límites de rate)
    const apiUrl = `https://api.github.com/repos/${c.repo}/contents/${c.archivo}?ref=${c.rama || "main"}`;
    try {
      const headers = process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "User-Agent": "agente-vigilancia" }
        : { "User-Agent": "agente-vigilancia" };
      const res = await fetchTimeout(apiUrl, 20000, { headers });
      if (res.ok) {
        const data = await res.json();
        return { productos: leerProductos(JSON.parse(Buffer.from(data.content, "base64").toString("utf8"))), fuente: apiUrl };
      }
      errors.push(`api ${res.status}`);
    } catch (e) { errors.push(`api (${e.message})`); }
  }
  return { error: errors.join(" · ") };
}

function leerProductos(data) {
  return Array.isArray(data) ? data : (data?.productos || data?.data || []);
}

// Fingerprint del catálogo: detecta si lo publicado difiere del repo.
function huella(productos) {
  const h = crypto.createHash("sha1");
  for (const p of productos) {
    h.update(`${p.id}:${p.stock ?? "?"}:${p.comision ?? "?"}:${p.comisionMoneda ?? "?"}:${p.precioActual ?? "?"};`);
  }
  return h.digest("hex").slice(0, 16);
}

// ---------- CHECKS WEB ----------

async function revisarSitio(sitio) {
  const timeout = sitio.tiempoMaximoMs || 8000;
  const resultados = [];
  for (const check of sitio.checks || []) {
    const url = sitio.url.replace(/\/+$/, "") + (check.path || "/");
    const r = { path: check.path || "/", ok: false, ms: 0, detalle: "" };
    const t0 = Date.now();
    try {
      const res = await fetchTimeout(url, timeout);
      r.ms = Date.now() - t0;
      if (!res.ok) { r.detalle = `HTTP ${res.status}`; resultados.push(r); continue; }
      let data = null;
      if (check.tipo === "json" || check.esCatalogo) {
        try { data = await res.json(); }
        catch { r.detalle = "JSON inválido"; resultados.push(r); continue; }
        if (check.esCatalogo) r.catalogo = data;
      }
      const texto = (check.debeContener || check.noContener) ? await res.text() : "";
      if (check.debeContener && !texto.includes(check.debeContener)) {
        r.detalle = `no contiene "${check.debeContener}"`; resultados.push(r); continue;
      }
      if (check.noContener) {
        let re = check.noContener, flags = "";
        if (/^\(\?i\)/.test(re)) { re = re.slice(4); flags = "i"; }
        if (new RegExp(re, flags).test(texto)) {
          r.detalle = `contiene patrón prohibido "${check.noContener}"`; resultados.push(r); continue;
        }
      }
      r.ok = true;
    } catch (e) {
      r.ms = Date.now() - t0;
      r.detalle = e.name === "AbortError" ? `timeout >${timeout}ms` : e.message;
    }
    resultados.push(r);
  }
  const ok = resultados.every(r => r.ok || r.soloEstado);
  const fallidos = resultados.filter(r => !r.ok && !r.soloEstado);
  // Tiempo representativo: el de la página principal (primer check).
  const principal = resultados.find(r => r.path === "/") || resultados[0] || { ms: 0 };
  return { nombre: sitio.nombre, url: sitio.url, ok, ms: principal.ms, total: resultados.length, fallidos: fallidos.map(f => `${f.path} (${f.detalle})`), resultados };
}

// ---------- DIFF DEL CATÁLOGO ----------

function diffCatalogo(previo, actual, umbral) {
  const eventos = []; // {tipo, severidad, idProducto, nombre, detalle}
  const prev = previo?.productos || {};
  const act = {};
  for (const p of actual) act[p.id] = p;

  for (const [id, p] of Object.entries(act)) {
    const a = prev[id];
    if (!a) {
      eventos.push({ tipo: "nuevo", severidad: "aviso", idProducto: id, nombre: p.nombre, detalle: "aparece en el catálogo por primera vez" });
      continue;
    }
    const sViejo = a.stock ?? 0, sNuevo = p.stock ?? 0;
    if (sNuevo !== sViejo) {
      if (sViejo > 0 && sNuevo === 0) {
        eventos.push({ tipo: "agotado", severidad: "aviso", idProducto: id, nombre: p.nombre, detalle: `stock ${sViejo} → 0 (agotado)` });
      } else if (sViejo === 0 && sNuevo > 0) {
        eventos.push({ tipo: "repuesto", severidad: "info", idProducto: id, nombre: p.nombre, detalle: `stock 0 → ${sNuevo} (repuesto)` });
      } else if (sNuevo < sViejo && sNuevo <= (umbral ?? 2) && sNuevo > 0) {
        eventos.push({ tipo: "stock_bajo", severidad: "aviso", idProducto: id, nombre: p.nombre, detalle: `stock ${sViejo} → ${sNuevo} (quedan ${sNuevo})` });
      }
    }
    const comVieja = `${a.comision ?? "?"} ${a.comisionMoneda ?? ""}`.trim();
    const comNueva = `${p.comision ?? "?"} ${p.comisionMoneda ?? ""}`.trim();
    if ((a.comision ?? null) !== (p.comision ?? null) || (a.comisionMoneda ?? null) !== (p.comisionMoneda ?? null)) {
      eventos.push({ tipo: "comision", severidad: "aviso", idProducto: id, nombre: p.nombre, detalle: `comisión ${comVieja} → ${comNueva}` });
    }
    if ((a.precioActual ?? 0) !== (p.precioActual ?? 0)) {
      eventos.push({ tipo: "precio", severidad: "info", idProducto: id, nombre: p.nombre, detalle: `precio ${a.precioActual ?? "?"} → ${p.precioActual ?? "?"}` });
    } else if ((a.precioOriginal ?? 0) !== (p.precioOriginal ?? 0)) {
      eventos.push({ tipo: "precio", severidad: "info", idProducto: id, nombre: p.nombre, detalle: `precio original ${a.precioOriginal ?? "?"} → ${p.precioOriginal ?? "?"}` });
    } else if ((a.descuento ?? 0) !== (p.descuento ?? 0)) {
      eventos.push({ tipo: "precio", severidad: "info", idProducto: id, nombre: p.nombre, detalle: `descuento ${a.descuento ?? 0}% → ${p.descuento ?? 0}%` });
    }
    if ((a.nombre ?? null) !== (p.nombre ?? null) || (a.slug ?? null) !== (p.slug ?? null)) {
      eventos.push({ tipo: "nombre", severidad: "info", idProducto: id, nombre: p.nombre, detalle: `nombre/slug cambiado (antes: ${a.nombre})` });
    }
  }
  for (const [id, a] of Object.entries(prev)) {
    if (!act[id]) {
      eventos.push({ tipo: "eliminado", severidad: "aviso", idProducto: id, nombre: a.nombre, detalle: "ya no está en el catálogo" });
    }
  }
  return eventos;
}

// ---------- TELEGRAM (opcional) ----------

// Sin secrets no hace nada. Con secrets, avisa transiciones (no repite spam).
async function telegramAvisar(texto, estado, cfg, noTelegram) {
  if (noTelegram || cfg.telegram?.habilitado === false) return;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  const v = estado._meta.telegram || { envios: [] };
  const ultimaHora = v.envios.filter(t => Date.now() - t < 3600000);
  if (ultimaHora.length >= (cfg.telegram?.maxPorHora || 4)) return; // guard de cuota
  try {
    const res = await fetchTimeout(`https://api.telegram.org/bot${token}/sendMessage`, 10000, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: texto, disable_web_page_preview: true }),
    });
    if (res.ok) { v.envios = [...ultimaHora, Date.now()]; estado._meta.telegram = v; }
    else console.log(`telegram: HTTP ${res.status}`);
  } catch (e) { console.log(`telegram: ${e.message}`); }
}

// ---------- PRINCIPAL ----------

export async function main(rawArgs = process.argv.slice(2)) {
  const args = rawArgs.slice();
  const CONFIG_FILE = args.find(a => !a.startsWith("--")) || "vigilancia/config.json";
  const WORKDIR = args.find(a => a.startsWith("--workdir="))?.slice(10) || ".";
  const NO_TELEGRAM = args.includes("--no-telegram");
  const DIR = path.join(WORKDIR, "vigilancia");
  const REPORTE = path.join(DIR, "reporte.json");
  const ESTADO = path.join(DIR, "estado.json");
  const HISTORIAL = path.join(DIR, "historial.json");

  const cfg = readJson(CONFIG_FILE, null);
  if (!cfg) { console.error(`No se pudo leer ${CONFIG_FILE}`); process.exit(1); }

  const estado = readJson(ESTADO, { _meta: {}, web: {}, catalogo: null });
  const reporteAnterior = readJson(REPORTE, null);
  const historial = readJson(HISTORIAL, []);
  const alertas = reporteAnterior?.alertas || [];
  const ts = now();
  const alertasNuevas = [];

  const pushAlerta = (a) => {
    const al = { id: `${a.tipo}-${String(a.idProducto || a.url || "sistema").slice(0, 40)}-${Date.now()}`, ts, ...a };
    alertas.unshift(al);
    alertasNuevas.push(al);
    while (alertas.length > (cfg.alertas?.mantenerEnReporte || 120)) alertas.pop();
  };

  // 1) WEB
  const webResumen = [];
  for (const sitio of cfg.web || []) {
    const r = await revisarSitio(sitio);
    webResumen.push(r);
    const prev = estado.web[sitio.url] || {};
    const cambioOk = prev.ok !== undefined && prev.ok !== r.ok;
    if (cambioOk && !r.ok) {
      pushAlerta({ tipo: "web_caida", severidad: "critica", url: sitio.url, titulo: `🔴 ${r.nombre} caída`, detalle: r.fallidos.join(" · ") || "sin respuesta" });
      await telegramAvisar(`🔴 VIGILANCIA: ${r.nombre} no responde.\n${r.fallidos.join("\n")}`, estado, cfg, NO_TELEGRAM);
    }
    if (cambioOk && r.ok) {
      pushAlerta({ tipo: "web_ok", severidad: "info", url: sitio.url, titulo: `🟢 ${r.nombre} restablecida`, detalle: `responde en ${r.ms} ms` });
      await telegramAvisar(`🟢 VIGILANCIA: ${r.nombre} restablecida (${r.ms} ms).`, estado, cfg, NO_TELEGRAM);
    }
    const lento = r.ok && r.ms > (sitio.tiempoMaximoMs || 8000) * 0.75;
    if (lento && !prev.lenta) {
      pushAlerta({ tipo: "web_lenta", severidad: "aviso", url: sitio.url, titulo: `🐢 ${r.nombre} va lenta`, detalle: `${r.ms} ms en responder la portada` });
    }
    estado.web[sitio.url] = {
      ok: r.ok, ms: r.ms, lenta: lento,
      ultimoCambio: cambioOk ? ts : (prev.ultimoCambio || estado._meta.primeraRevision || ts),
    };
  }
  const webOk = webResumen.every(r => r.ok);

  // 2) CATÁLOGO
  const catalogo = await cargarCatalogo(cfg);
  let diff = [];
  let huellaRepo = null;
  if (catalogo.error) {
    if (estado._meta.catalogoOk !== false) {
      pushAlerta({ tipo: "catalogo_no_leido", severidad: "critica", titulo: "📦 No pude leer el catálogo del repo", detalle: catalogo.error });
      await telegramAvisar(`🔴 VIGILANCIA: no pude leer productos.json (${catalogo.error}).`, estado, cfg, NO_TELEGRAM);
    }
    estado._meta.catalogoOk = false;
  } else {
    estado._meta.catalogoOk = true;
    huellaRepo = huella(catalogo.productos);
    if (!estado.catalogo) {
      // Seed: primera vez. Sin alertas de diff, pero se destacan los recién agregados (48h).
      const productos = {};
      for (const p of catalogo.productos) productos[p.id] = snapshotProducto(p, cfg.catalogo?.campos);
      estado.catalogo = { n: catalogo.productos.length, huella: huellaRepo, productos };
      const corte = Date.now() - 48 * 3600000;
      for (const p of catalogo.productos) {
        const fa = p.fechaAgregado ? new Date(p.fechaAgregado).getTime() : 0;
        if (fa > corte) {
          const horas = Math.round((Date.now() - fa) / 3600000);
          pushAlerta({ tipo: "nuevo", severidad: "info", idProducto: String(p.id), titulo: `🆕 ${p.nombre}`, detalle: `agregado hace ${horas < 1 ? "menos de 1 h" : horas + " h"}` });
        }
      }
    } else {
      diff = diffCatalogo(estado.catalogo, catalogo.productos, cfg.catalogo?.umbralStockBajo);
      const productos = {};
      for (const p of catalogo.productos) productos[p.id] = snapshotProducto(p, cfg.catalogo?.campos);
      estado.catalogo = { n: catalogo.productos.length, huella: huellaRepo, productos };
      const icono = { nuevo: "🆕", agotado: "🛑", repuesto: "🟢", stock_bajo: "⚠️", comision: "💸", precio: "🏷️", nombre: "✏️", eliminado: "🗑️" };
      for (const ev of diff) {
        const ic = icono[ev.tipo] || "ℹ️";
        pushAlerta({ ...ev, titulo: `${ic} ${ev.nombre || "producto"}` });
        const mandaTelegram = ev.severidad === "critica" || (!cfg.telegram?.soloCriticas && ev.severidad === "aviso");
        if (mandaTelegram) await telegramAvisar(`${ic} TiendaMax: ${ev.nombre}\n${ev.detalle}`, estado, cfg, NO_TELEGRAM);
      }
    }
  }

  // 3) DEPLOY DESACTUALIZADO: comparar productos.json publicado vs repo
  for (const r of webResumen) {
    const pub = r.resultados.find(c => c.catalogo)?.catalogo;
    if (pub && huellaRepo) {
      const hPub = huella(leerProductos(pub));
      const prevDeploy = estado._meta.deploy || {};
      if (hPub !== huellaRepo && prevDeploy.huella !== `${hPub}≠${huellaRepo}`) {
        pushAlerta({ tipo: "deploy_desactualizado", severidad: "aviso", url: r.url, titulo: "📦 Web desactualizada", detalle: `${r.nombre} sirve un productos.json distinto al del repo (¿deploy pendiente?)` });
      }
      estado._meta.deploy = { huella: hPub !== huellaRepo ? `${hPub}≠${huellaRepo}` : "ok" };
    }
  }

  // 4) REPORTE + HISTORIAL
  const productos = catalogo.productos || [];
  const agotados = catalogo.error ? null : productos.filter(p => (p.stock ?? 0) === 0).length;
  const stockBajo = catalogo.error ? null : productos.filter(p => (p.stock ?? 0) > 0 && (p.stock ?? 0) <= (cfg.catalogo?.umbralStockBajo ?? 2)).length;
  const corte24 = Date.now() - 24 * 3600000;
  const a24 = alertas.filter(a => new Date(a.ts).getTime() > corte24);
  const msMax = Math.max(...webResumen.map(r => r.ms));
  const resumen = webOk
    ? `🟢 Web OK (${msMax} ms) · ${catalogo.error ? "catálogo no leído" : productos.length + " productos"} · ${alertasNuevas.length} novedad${alertasNuevas.length === 1 ? "" : "es"}`
    : `🔴 Web caída · ${alertasNuevas.length} novedad${alertasNuevas.length === 1 ? "" : "es"}`;

  const reporte = {
    sitio: cfg.sitio?.nombre || "TiendaMax",
    generadoPor: "vigilancia",
    ultimaRevision: ts,
    resumen,
    web: webResumen.map(r => ({ nombre: r.nombre, url: r.url, ok: r.ok, ms: r.ms, fallidos: r.fallidos })),
    catalogo: {
      n: catalogo.error ? null : productos.length,
      agotados, stockBajo,
      conStock: catalogo.error ? null : productos.length - (agotados ?? 0),
      nuevos24h: a24.filter(a => a.tipo === "nuevo").length,
      agotados24h: a24.filter(a => a.tipo === "agotado").length,
      comisiones24h: a24.filter(a => a.tipo === "comision").length,
    },
    alertas,
    // El digest y las sugerencias los escribe vigia-digest.js; aquí solo se preservan.
    digest: reporteAnterior?.digest || null,
    sugerencias: reporteAnterior?.sugerencias || [],
  };

  historial.unshift({
    ts, webOk, ms: msMax, n: catalogo.error ? null : productos.length,
    alertasNuevas: alertasNuevas.length,
    criticas: alertasNuevas.filter(a => a.severidad === "critica").length,
  });
  while (historial.length > (cfg.historial?.mantenerRuns || 576)) historial.pop();

  // 5) ESCRIBIR solo si hubo cambios reales o toca heartbeat (evita commits basura).
  const sinCambios = reporteAnterior
    && mismo(reporte.alertas, reporteAnterior.alertas)
    && mismo(reporte.web, reporteAnterior.web)
    && mismo(reporte.catalogo, reporteAnterior.catalogo);
  const ultimoWrite = estado._meta.ultimoWrite || 0;
  const tocaHeartbeat = Date.now() - ultimoWrite > (cfg.heartbeatMin || 60) * 60000;

  if (!sinCambios || tocaHeartbeat || !reporteAnterior) {
    estado._meta.ultimoWrite = Date.now();
    estado._meta.primeraRevision = estado._meta.primeraRevision || ts;
    writeJson(REPORTE, reporte);
    writeJson(ESTADO, estado);
    writeJson(HISTORIAL, historial);
    console.log(`✍️ reporte escrito (${sinCambios ? "heartbeat" : "cambios"})`);
  } else {
    console.log("sin cambios relevantes, no se escribe (sin commit)");
  }

  console.log(resumen);
  for (const a of alertasNuevas) console.log(`  ${a.severidad.toUpperCase()} · ${a.titulo} — ${a.detalle}`);
}

function snapshotProducto(p, campos) {
  const out = {};
  for (const c of (campos || ["id", "nombre", "slug", "stock", "comision", "comisionMoneda", "precioActual", "precioOriginal", "descuento", "fechaAgregado"])) {
    out[c] = p[c] ?? null;
  }
  return out;
}

// Ejecución directa (node src/vigilancia.js) vs import para pruebas.
import { pathToFileURL } from "node:url";
const ejecutadoDirecto = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (ejecutadoDirecto) {
  main().catch(e => { console.error("vigilancia falló:", e.message); process.exit(1); });
}
