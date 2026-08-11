---
id: PROJ-axontech
type: project
name: AXONTECH
repo: Criptobox/AXONTECH
stack: [PWA, HTML, CSS, JS, Firebase Realtime DB, GitHub Pages]
backend: Firebase Realtime Database
deploy: GitHub Pages (hosting estático, sin servidor)
workflow: mobile-only, GitHub web UI, conexión 3G lenta
files: [app.js, admin.html, index.html, catalogo.html, sw.js]
updated: 2026-08-10
tags: [axontech, pwa, firebase, gestores, ventas]
---
## Qué es
PWA de gestión de ventas para un negocio con **múltiples gestores** (agentes de venta)
y un flujo de **mensajería/reparto** (courier). Cada gestor maneja sus "vales" de venta.

## Arquitectura clave
- Backend Firebase Realtime Database (igual que TiendaMax).
- Archivos núcleo: app.js (lógica), admin.html (panel), index.html, catalogo.html, sw.js.
- Autenticación en el panel admin.

## Riesgos históricos (auditoría reciente)
Pasó por una auditoría profunda que resolvió 3 fallos críticos + ~24 bugs de lógica/flujo:
- **Bypass de autenticación con la tecla Escape** (ver BUG-201). CRÍTICO.
- **Bug de Firebase que sobrescribía los vales de TODOS los gestores** (ver BUG-202). Pérdida de datos.
- **Un PAT de GitHub se transmitía por Firebase** (ver BUG-203). Fuga de secreto.

## Reglas propias
- Toda escritura de vales en Firebase debe ser **por-gestor**, nunca sobre el nodo padre común.
- El panel admin no debe poder saltarse con eventos de teclado.
- Ningún secreto (PAT, API key) viaja por Firebase ni vive en el cliente.
