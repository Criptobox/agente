---
id: LESSON-101
type: lesson
scope: tiendamax
trigger: "minificar/build de JS, handlers que dejan de disparar"
files_pattern: [*script*, *.min.js, *build*]
rule: "Si el código resuelve funciones por string (window[fn]), minificar con --no-rename."
anti_pattern: "Minificar con renombrado activo cuando hay event delegation por nombre"
born_from: [BUG-101]
times_applied: 0
times_prevented_failure: 0
times_ignored: 0
promoted_to_rule: true
confidence: 96
agent: learner
updated: 2026-08-10
---
El minificador renombra símbolos. Si invocas funciones por su nombre en string,
el renombrado las vuelve inalcanzables. --no-rename es obligatorio en TiendaMax.
