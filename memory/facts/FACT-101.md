---
id: FACT-101
type: fact
project: tiendamax
statement: "La vigilancia continua vive en el repo agente: src/vigilancia.js diffea catálogos (AXONTECH axontech92 vía Supabase + fallback repo) cada 10 min y escribe vigilancia/reporte.json, que la pestaña Vigilancia del dashboard lee."
confidence: 95
files: [src/vigilancia.js, src/vigia-digest.js, .github/workflows/vigilancia.yml, vigilancia/config.json]
symbols: [vigilancia, vigia]
tags: [vigilancia, dashboard, productos, supabase, axontech]
agent: vigilancia
updated: 2026-08-22
---
El centinela es determinista (coste $0 de IA). Soporta varios catálogos
(cfg.catalogos): por catálogo prueba Supabase REST → repo (raw → API) →
archivo local. De Supabase primero hace una consulta barata (updated_at más
nuevo) y solo baja la tabla completa si cambió o cada 60 min (borrados).
El estado entre corridas está en vigilancia/estado.json (foto por catálogo:
stock, comision, precio, slug/nombre). El digest con IA (vigia-digest.js)
corre una vez al día y sus sugerencias se convierten en tareas desde la app.
Si cambia la estructura de un catálogo (tabla, campos), ajustar
vigilancia/config.json y los campos del snapshot.
