---
id: LESSON-202
type: lesson
scope: general
trigger: "escritura en Firebase RTDB, guardar datos con hermanos"
files_pattern: [*firebase*, *app.js*, *vales*]
rule: "En Firebase RTDB, escribe en la ruta específica y usa update(), no set() sobre el padre."
anti_pattern: "set() sobre un nodo padre que tiene hijos que no quieres borrar"
born_from: [BUG-202]
times_applied: 0
times_prevented_failure: 0
times_ignored: 0
promoted_to_rule: true
confidence: 95
agent: learner
updated: 2026-08-10
---
set() reemplaza el nodo COMPLETO, borrando a los hermanos. Para tocar un solo
elemento, escribe en su ruta exacta (ref/padre/{id}) o usa update() con la ruta.
