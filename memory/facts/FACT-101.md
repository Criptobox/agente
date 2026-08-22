---
id: FACT-101
type: fact
project: tiendamax
statement: "La vigilancia continua de la tienda vive en el repo agente: src/vigilancia.js diffea productos.json de Criptobox/TiendaMax cada 10 min y escribe vigilancia/reporte.json, que la pestaña Vigilancia del dashboard lee."
confidence: 95
files: [src/vigilancia.js, src/vigia-digest.js, .github/workflows/vigilancia.yml]
symbols: [vigilancia, vigia]
tags: [vigilancia, dashboard, productos, tiendamax]
agent: vigilancia
updated: 2026-08-22
---
El centinela es determinista (coste $0 de IA). El estado entre corridas está en
vigilancia/estado.json (foto de cada producto: stock, comision, precio, slug).
El digest con IA (vigia-digest.js) corre una vez al día y sus sugerencias se
pueden convertir en tareas (Issue con etiqueta agent) desde la propia app.
Si cambia la estructura de productos.json (campos, ubicación del archivo),
hay que ajustar vigilancia/config.json y los campos del snapshot.
