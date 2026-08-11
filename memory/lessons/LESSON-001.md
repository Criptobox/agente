---
id: LESSON-001
type: lesson
scope: general
trigger: "NaN o undefined en cálculos, totales incorrectos"
files_pattern: [*cart*, *total*, *precio*]
rule: "Antes de sanear el tipo, verificar integridad referencial del dato."
anti_pattern: "Number(x)||0 como arreglo de un NaN"
born_from: [BUG-001]
times_applied: 0
times_prevented_failure: 0
times_ignored: 0
promoted_to_rule: false
confidence: 85
agent: learner
updated: 2026-08-10
---
Un NaN en un cálculo casi siempre es un problema de ciclo de vida del dato
(algo se borró o no se cargó), no un problema de tipo. Sanear el tipo oculta
el error y produce datos silenciosamente incorrectos.
