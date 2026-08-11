---
id: LESSON-102
type: lesson
scope: general
trigger: "operaciones async en conexión lenta, push, carga inicial, SW"
files_pattern: [*push*, *sw*, *fetch*]
rule: "Espera el ESTADO real antes de continuar, nunca asumas orden por velocidad."
anti_pattern: "Encadenar pasos async asumiendo que el anterior ya terminó"
born_from: [BUG-102]
times_applied: 0
times_prevented_failure: 0
times_ignored: 0
promoted_to_rule: true
confidence: 92
agent: learner
updated: 2026-08-10
---
En 3G lo que en WiFi parece secuencial se desordena. Sincroniza por estado
(¿ya está listo?) y no por tiempo (asumir que 200ms bastan).
