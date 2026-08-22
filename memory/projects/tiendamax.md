---
id: PROJ-tiendamax
type: project
name: TiendaMax
repo: Criptobox/TiendaMax
url: tiendamax.org
stack: [PWA, HTML, CSS, JS, Firebase Realtime DB, GitHub Pages]
frontend: PWA con Service Worker, bundle.css, script.js minificado
backend: Firebase Realtime Database
deploy: GitHub Pages (hosting estático, sin servidor)
workflow: mobile-only, GitHub web UI, conexión 3G lenta
updated: 2026-08-10
tags: [tiendamax, pwa, firebase, ecommerce]
---
## Qué es
Tienda online cubana (PWA) que vende aceites de motor, routers WiFi y decoración de hogar.
Pedidos terminan en WhatsApp. Panel admin basado en la API de GitHub.

## Arquitectura clave
- Llamadas a datos vía **_tmFetch()**, NUNCA fetch() directo (lleva cache-busting para analítica).
- Event delegation con **window[functionName]** → terser con **--no-rename obligatorio**, si no, rompe.
- Pipeline de build: script.src.js → script.js (minificado), CSS consolidado en bundle.css, todo vía GitHub Actions.
- Service Worker: network-first para HTML/CSS/JS, mensaje SKIP_WAITING, versión de caché ha pasado de v100.
- Push notifications FCM v1 con service account. Historial de bugs en push-fix.js (v1–v3).
- Toggle de moneda USD/MN; tasa se automatiza con la API de ElToque vía GitHub Action.

## Funciones vivas
Carga de productos desde Firebase, carrito, flujo WhatsApp, wishlist, reviews (Firebase),
push, toggle de moneda, install prompt PWA, sitemap/SEO, "Vale del Gestor".

## Sistema de diseño — "TiendaMax Oficial Plus"
Tema oscuro. Fondos #0D0D0D, coral #FF6B35, oro #C9A96E. Glassmorphism.
Tipografías: Playfair Display, Inter, JetBrains Mono.
Prompt maestro guardado en prompt-replicar-diseno-tiendamax.md.

## Riesgos históricos
- Un PAT se filtró vía Firebase (ver BUG-101). El Security Agent vigila secretos en cliente.
- El mensaje de pedido de WhatsApp se estandarizó en 3 funciones distintas: si cambia una, revisar las tres.

## Companion
Vale de Venta (criptobox.github.io/Vale-de-venta-Tiendamax) y un bot de stock en Telegram.

## Vigilancia continua (vive en el repo agente)
- `vigilancia.yml` cada 10 min: HTTP checks de tiendamax.org (+ Pages) y de
  axontech92.github.io/AXONTECH, más deploy-check (servido vs repo). Sin IA.
  Escribe `vigilancia/reporte.json` que la app lee (pestaña Vigilancia).
- El STOCK vigilado (alarmas de agotado/repuesto/nuevo/comisión) es el de
  AXONTECH axontech92 (ver FACT-102), NO el de TiendaMax — orden explícita de kros.
- `vigia-diario.yml` cada mañana: digest + sugerencias (única llamada de IA, tier cheap).
- Telegram opcional con secrets TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID en el repo agente.
- TiendaMax YA tiene en su propio repo: web-health-agent.yml (30 min, avisa por Telegram),
  nightly-agent.yml (reporte diario agente-reporte.json) y smoke-web.yml. No duplicarlos:
  el centinela del repo agente es el diff/alertas en la app; los de la tienda, sus jobs.
