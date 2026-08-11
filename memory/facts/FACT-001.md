---
id: FACT-001
type: fact
project: tiendamax
statement: "Las llamadas a datos usan _tmFetch(), no fetch() directo (lleva cache-busting)."
confidence: 95
files: [script.js]
symbols: [_tmFetch]
tags: [convencion, fetch, analitica]
agent: research
updated: 2026-08-10
---
_tmFetch() envuelve fetch() añadiendo cache-busting, clave para que la analítica
no lea respuestas cacheadas. Usar fetch() directo rompe esa medición.
