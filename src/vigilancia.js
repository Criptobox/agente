// src/vigilancia.js
// CENTINELA (vigilancia continua).
// Corre cada pocos minutos vía .github/workflows/vigilancia.yml.
// Determinista y SIN IA (coste $0). Revisa:
//  1. WEBS publicadas (HTTP checks, tiendamax.org, axontech92.github.io/AXONTECH, …).
//  2. CATÁLOGOS vigilados: diffea el stock/comisión/precio contra la foto
//     anterior guardada en vigilancia/estado.json. Soporta varias fuentes
//     por catálogo, en orden: Supabase REST (fuente viva de la página) →
//     repo de GitHub (raw → API) → archivo local (solo pruebas).
//     De Supabase primero hace una consulta barata (updated_at más reciente)
//     y solo baja la tabla entera si algo cambió (o cada 60 min por si hubo
//     borrados) — igual que hace la propia página para no gastar cuota.
//  3. DEPLOY: si una web sirve /productos.json distinto al archivo del repo.
// Escribe vigilancia/{reporte,estado,historial}.json, que el dashboard
// (pestaña Vigilancia) lee directamente. Opcional: Telegram en transiciones.
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

// ---------- FUENTES DE CATÁLOGO ----------

function leerProductos(data) {
  return Array.isArray(data) ? data : (data?.productos || data?.data || []);
}

// Archivo del repo (raw → API de GitHub). fileLocal solo para pruebas.
async function leerProductosRepo(c) {
  if (c.fileLocal) {
    try { return { productos: leerProductos(JSON.parse(fs.readFileSync(c.fileLocal, "utf8"))), fuente: c.fileLocal }; }
    catch (e) { return { error: `local (${e.message})` }; }
  }
  const errors = [];
  if (c.repo) {
    const rawUrl = `https://raw.githubusercontent.com/${c.repo}/${c.rama || "main"}/${c.archivo || "productos.json"}`;
    try {
      const res = await fetchTimeout(rawUrl, 20000);
      if (res.ok) return { productos: leerProductos(await res.json()), fuente: rawUrl };
      errors.push(`raw ${res.status}`);
    } catch (e) { errors.push(`raw (${e.message})`); }
    const apiUrl = `https://api.github.com/repos/${c.repo}/contents/${c.archivo || "productos.json"}?ref=${c.rama || "main"}`;
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

// Supabase REST (la fuente viva de la página, con su misma clave publicable).
// 1) Consulta barata del updated_at más nuevo. 2) Si cambió (o toca la red de
// seguridad cada 60 min, por si borraron filas), baja la tabla entera.
async function leerProductosSupabase(c, estadoCat) {
  const sb = c.supabase;
  if (!sb?.url || !sb?.tabla) return null;
  const headers = {
    apikey: sb.key || "",
    Authorization: `Bearer ${sb.key || ""}`,
    "Content-Type": "application/json",
  };
  const base = `${sb.url.replace(/\/+$/, "")}/rest/v1/${encodeURIComponent(sb.tabla)}`;
  let maxUpd = null;
  try {
    const barato = await fetchTimeout(`${base}?select=updated_at&order=updated_at.desc&limit=1`, 15000, { headers });
    if (!barato.ok) throw new Error(`cheap ${barato.status}`);
    maxUpd = (await barato.json())[0]?.updated_at ?? null;
    const tocaRed = !estadoCat?.ultimoFull || (Date.now() - estadoCat.ultimoFull) > 60 * 60000;
    if (maxUpd && estadoCat?.maxUpdated === maxUpd && !tocaRed) {
      return { sinCambios: true, fuente: `${sb.url} (sin cambios desde ${maxUpd})` };
    }
    const completo = await fetchTimeout(`${base}?select=data,updated_at&order=id.asc`, 25000, { headers });
    if (!completo.ok) throw new Error(`full ${completo.status}`);
    const rows = await completo.json();
    const productos = rows.map(r => ({ ...(r.data || {}), id: r.data?.id ?? r.id }));
    const maxDeFilas = rows.map(r => r.updated_at).filter(Boolean).sort().pop() || maxUpd;
    return { productos, fuente: `${sb.url}/rest/v1/${sb.tabla}`, maxUpdated: maxDeFilas };
  } catch (e) {
    return { error: `supabase (${e.message})` };
  }
}

async function cargarCatalogo(c, estadoCat) {
  const errors = [];
  const sb = await leerProductosSupabase(c, estadoCat);
  if (sb) {
    if (sb.error) errors.push(sb.error);
    else if (sb.sinCambios) return sb;
    else return sb;
  }
  const repo = await leerProductosRepo(c);
  if (repo.error) errors.push(repo.error);
  else return repo;
  return { error: errors.join(" · ") };
}

// Fingerprint del catálogo (para detectar deploy desactualizado).
function huella(productos) {
  const h = crypto.createHash("sha1");
  for (const p of productos) {
    h.update(`${p.id}:${p.stock ?? "?"}:${p.comision ?? "?"}:${p.precioActual ?? "?"};`);
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
        // `(?i)` (flag inline, sintaxis PCRE) no existe en JS: se traduce a la flag "i".
        let re = check.noContener, flags = "";
        if (re.startsWith("(?i)")) { re = re.slice(4); flags = "i"; }
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
    const nombre = p.nombre ?? p.name ?? "producto";
    if (!a) {
      eventos.push({ tipo: "nuevo", severidad: "aviso", idProducto: id, nombre, detalle: "aparece en el catálogo por primera vez" });
      continue;
    }
    const sViejo = a.stock ?? 0, sNuevo = p.stock ?? 0;
    if (sNuevo !== sViejo) {
      if (sViejo > 0 && sNuevo === 0) {
        eventos.push({ tipo: "agotado", severidad: "aviso", idProducto: id, nombre, detalle: `stock ${sViejo} → 0 (agotado)` });
      } else if (sViejo === 0 && sNuevo > 0) {
        eventos.push({ tipo: "repuesto", severidad: sNuevo <= (umbral ?? 2) ? "aviso" : "info", idProducto: id, nombre, detalle: `stock 0 → ${sNuevo} (repuesto${sNuevo <= (umbral ?? 2) ? ", quedan pocos" : ""})` });
      } else if (sNuevo < sViejo && sNuevo <= (umbral ?? 2) && sNuevo > 0) {
        eventos.push({ tipo: "stock_bajo", severidad: "aviso", idProducto: id, nombre, detalle: `stock ${sViejo} → ${sNuevo} (quedan ${sNuevo})` });
      }
    }
    const comVieja = `${a.comision ?? "?"}`.trim();
    const comNueva = `${p.comision ?? "?"}`.trim();
    if ((a.comision ?? null) !== (p.comision ?? null)) {
      eventos.push({ tipo: "comision", severidad: "aviso", idProducto: id, nombre, detalle: `comisión ${comVieja} → ${comNueva}` });
    }
    if ((a.precioActual ?? 0) !== (p.precioActual ?? 0)) {
      eventos.push({ tipo: "precio", severidad: "info", idProducto: id, nombre, detalle: `precio ${a.precioActual ?? "?"} → ${p.precioActual ?? "?"}` });
    } else if ((a.precioOriginal ?? 0) !== (p.precioOriginal ?? 0)) {
      eventos.push({ tipo: "precio", severidad: "info", idProducto: id, nombre, detalle: `precio original ${a.precioOriginal ?? "?"} → ${p.precioOriginal ?? "?"}` });
    } else if ((a.descuento ?? 0) !== (p.descuento ?? 0)) {
      eventos.push({ tipo: "precio", severidad: "info", idProducto: id, nombre, detalle: `descuento ${a.descuento ?? 0}% → ${p.descuento ?? 0}%` });
    }
    const nomViejo = a.nombre ?? a.name ?? null;
    if ((nomViejo ?? null) !== (nombre ?? null)) {
      eventos.push({ tipo: "nombre", severidad: "info", idProducto: id, nombre, detalle: `nombre cambiado (antes: ${nomViejo})` });
    }
  }
  for (const [id, a] of Object.entries(prev)) {
    if (!act[id]) {
      eventos.push({ tipo: "eliminado", severidad: "aviso", idProducto: id, nombre: a.nombre ?? "producto", detalle: "ya no está en el catálogo" });
    }
  }
  return eventos;
}

// ---------- TELEGRAM (opcional) ----------

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

  const estado = readJson(ESTADO, { _meta: {}, web: {}, catalogos: {} });
  const reporteAnterior = readJson(REPORTE, null);
  const historial = readJson(HISTORIAL, []);
  // Copia propia: pushAlerta() muta este array, y si fuera la MISMA referencia
  // que reporteAnterior.alertas, la comparación de "sin cambios" siempre diría
  // que nada cambió y las alertas nunca se persistirían.
  const alertas = [...(reporteAnterior?.alertas || [])];
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

  // 2) CATÁLOGOS (stock vivo vigilado)
  const catalogosCfg = cfg.catalogos || (cfg.catalogo ? [cfg.catalogo] : []);
  estado.catalogos = estado.catalogos || {};
  const resumenCatalogos = [];

  for (const c of catalogosCfg) {
    const nombre = c.nombre || c.repo || "catálogo";
    const est = estado.catalogos[nombre] || {};
    const res = await cargarCatalogo(c, est);

    if (res.error) {
      if (est.ok !== false) {
        pushAlerta({ tipo: "catalogo_no_leido", severidad: "critica", catalogo: nombre, titulo: `📦 No pude leer ${nombre}`, detalle: res.error });
        await telegramAvisar(`🔴 VIGILANCIA: no pude leer ${nombre} (${res.error}).`, estado, cfg, NO_TELEGRAM);
      }
      estado.catalogos[nombre] = { ...est, ok: false };
      resumenCatalogos.push({ nombre, n: null, error: res.error });
      continue;
    }
    if (res.sinCambios) {
      estado.catalogos[nombre] = { ...est, ok: true };
      resumenCatalogos.push({ nombre, sinCambios: true });
      continue;
    }

    const productos = res.productos;
    const huellaCat = huella(productos);
    if (!est.productos) {
      // Seed: primera foto, sin alertas de diff.
      const snapshot = {};
      for (const p of productos) snapshot[p.id] = snapshotProducto(p, c.campos);
      estado.catalogos[nombre] = { n: productos.length, huella: huellaCat, productos: snapshot, maxUpdated: res.maxUpdated ?? est.maxUpdated, ultimoFull: Date.now(), ok: true };
      resumenCatalogos.push({ nombre, n: productos.length, agotados: cuentaAgotados(productos), stockBajo: cuentaStockBajo(productos, c.umbralStockBajo) });
      console.log(`📸 ${nombre}: primera foto (${productos.length} productos)`);
      continue;
    }

    const diff = diffCatalogo(est, productos, c.umbralStockBajo);
    const snapshot = {};
    for (const p of productos) snapshot[p.id] = snapshotProducto(p, c.campos);
    estado.catalogos[nombre] = { n: productos.length, huella: huellaCat, productos: snapshot, maxUpdated: res.maxUpdated ?? est.maxUpdated, ultimoFull: Date.now(), ok: true };
    const icono = { nuevo: "🆕", agotado: "🛑", repuesto: "🟢", stock_bajo: "⚠️", comision: "💸", precio: "🏷️", nombre: "✏️", eliminado: "🗑️" };
    for (const ev of diff) {
      const ic = icono[ev.tipo] || "ℹ️";
      pushAlerta({ ...ev, catalogo: nombre, titulo: `${ic} ${ev.nombre || "producto"}` });
      const mandaTelegram = ev.severidad === "critica" || (!cfg.telegram?.soloCriticas && ev.severidad === "aviso");
      if (mandaTelegram) await telegramAvisar(`${ic} ${nombre}: ${ev.nombre}\n${ev.detalle}`, estado, cfg, NO_TELEGRAM);
    }
    resumenCatalogos.push({ nombre, n: productos.length, agotados: cuentaAgotados(productos), stockBajo: cuentaStockBajo(productos, c.umbralStockBajo), diff });
  }

  // 3) DEPLOY DESACTUALIZADO: comparar /productos.json servido vs archivo del repo
  for (const r of webResumen) {
    const pub = r.resultados.find(c => c.catalogo)?.catalogo;
    const sitio = cfg.web?.find(s => s.url === r.url);
    if (pub && sitio?.deploy) {
      const repoFile = await leerProductosRepo(sitio.deploy);
      if (!repoFile.error) {
        const hPub = huella(leerProductos(pub));
        const hRepo = huella(repoFile.productos);
        const key = `${r.url}::${sitio.deploy.repo || "local"}`;
        const prevDeploy = estado._meta.deploy || {};
        if (hPub !== hRepo && prevDeploy[key] !== `${hPub}≠${hRepo}`) {
          pushAlerta({ tipo: "deploy_desactualizado", severidad: "aviso", url: r.url, titulo: "📦 Web desactualizada", detalle: `${r.nombre} sirve un productos.json distinto al del repo (¿deploy pendiente?)` });
        }
        estado._meta.deploy = { ...prevDeploy, [key]: hPub !== hRepo ? `${hPub}≠${hRepo}` : "ok" };
      }
    }
  }

  // 4) REPORTE + HISTORIAL
  const corte24 = Date.now() - 24 * 3600000;
  const a24 = alertas.filter(a => new Date(a.ts).getTime() > corte24);
  const resumenCat = resumenCatalogos.map(c => {
    if (c.error) return `${c.nombre}: no leído`;
    if (c.sinCambios) return `${c.nombre}: sin cambios`;
    const n24 = a24.filter(a => a.catalogo === c.nombre && a.tipo === "nuevo").length;
    const ag24 = a24.filter(a => a.catalogo === c.nombre && a.tipo === "agotado").length;
    const co24 = a24.filter(a => a.catalogo === c.nombre && a.tipo === "comision").length;
    return `${c.nombre}: ${c.n} productos · ${c.agotados} agotados · 24h {${n24} nuevos, ${ag24} agotados, ${co24} comisiones}`;
  }).join(" | ");

  const catalogos = catalogosCfg.map(c => {
    const nombre = c.nombre || c.repo || "catálogo";
    const est = estado.catalogos[nombre] || {};
    const n = est.n ?? null;
    let agotados = null, stockBajo = null;
    if (est.productos) {
      const valores = Object.values(est.productos);
      agotados = valores.filter(p => (p.stock ?? 0) === 0).length;
      stockBajo = valores.filter(p => (p.stock ?? 0) > 0 && (p.stock ?? 0) <= (c.umbralStockBajo ?? 2)).length;
    }
    return {
      nombre,
      n,
      agotados,
      stockBajo,
      conStock: n != null && agotados != null ? n - agotados : null,
      nuevos24h: a24.filter(a => a.catalogo === nombre && a.tipo === "nuevo").length,
      agotados24h: a24.filter(a => a.catalogo === nombre && a.tipo === "agotado").length,
      comisiones24h: a24.filter(a => a.catalogo === nombre && a.tipo === "comision").length,
    };
  });

  const msMax = Math.max(...webResumen.map(r => r.ms));
  const resumen = webOk
    ? `🟢 Web OK (${msMax} ms) · ${catalogos.map(c => `${c.nombre}: ${c.n ?? "?"} productos`).join(" · ")} · ${alertasNuevas.length} novedad${alertasNuevas.length === 1 ? "" : "es"}`
    : `🔴 Web caída · ${alertasNuevas.length} novedad${alertasNuevas.length === 1 ? "" : "es"}`;

  const reporte = {
    sitio: cfg.sitio?.nombre || "Vigilancia",
    generadoPor: "vigilancia",
    ultimaRevision: ts,
    resumen,
    web: webResumen.map(r => ({ nombre: r.nombre, url: r.url, ok: r.ok, ms: r.ms, fallidos: r.fallidos })),
    catalogos,
    catalogo: catalogos[0] || null, // compat con versiones anteriores
    alertas,
    // El digest y las sugerencias los escribe vigia-digest.js; aquí solo se preservan.
    digest: reporteAnterior?.digest || null,
    sugerencias: reporteAnterior?.sugerencias || [],
  };

  historial.unshift({
    ts, webOk, ms: msMax,
    n: catalogos.map(c => c.n ?? 0).reduce((a, b) => a + b, 0) || null,
    alertasNuevas: alertasNuevas.length,
    criticas: alertasNuevas.filter(a => a.severidad === "critica").length,
  });
  while (historial.length > (cfg.historial?.mantenerRuns || 576)) historial.pop();

  // 5) ESCRIBIR solo si hubo cambios reales o toca heartbeat (evita commits basura).
  const sinCambios = reporteAnterior
    && mismo(reporte.alertas, reporteAnterior.alertas)
    && mismo(reporte.web, reporteAnterior.web)
    && mismo(reporte.catalogos, reporteAnterior.catalogos);
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
  console.log(`  catálogos: ${resumenCat || "ninguno"}`);
  for (const a of alertasNuevas) console.log(`  ${a.severidad.toUpperCase()} · ${a.catalogo ? "[" + a.catalogo + "] " : ""}${a.titulo} — ${a.detalle}`);
}

function cuentaAgotados(productos) {
  return productos.filter(p => (p.stock ?? 0) === 0).length;
}
function cuentaStockBajo(productos, umbral) {
  return productos.filter(p => (p.stock ?? 0) > 0 && (p.stock ?? 0) <= (umbral ?? 2)).length;
}

function snapshotProducto(p, campos) {
  const out = {};
  for (const c of (campos || ["id", "nombre", "name", "stock", "comision", "precioActual", "precioOriginal", "descuento"])) {
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
