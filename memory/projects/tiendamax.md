---
id: PROJ-tiendamax
type: project
name: TiendaMax
repo: Criptobox/TiendaMax
stack: [PWA, HTML, CSS, JS, Firebase Realtime DB, GitHub Pages]
frontend: PWA con Service Worker, bundle.css, script.js minificado
backend: Firebase Realtime Database
deploy: GitHub Pages
updated: 2026-08-10
conventions: "Las llamadas API usan _tmFetch(), no fetch() directo. Event delegation con window[functionName] (terser --no-rename obligatorio)."
---
## Notas
- Flujo de pedido termina en WhatsApp.
- Riesgo histórico: un PAT se filtró vía Firebase. El Security Agent debe vigilar secretos en el cliente.
- Cache del SW ha llegado a v100+.
