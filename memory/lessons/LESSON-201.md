---
id: LESSON-201
type: lesson
scope: general
trigger: "login, modales de auth, vistas protegidas, permisos"
files_pattern: [*admin*, *auth*, *login*]
rule: "El permiso es ESTADO de sesión verificado, nunca apariencia de la UI."
anti_pattern: "Inferir 'logueado' de si un modal está abierto/cerrado"
born_from: [BUG-201]
times_applied: 0
times_prevented_failure: 0
times_ignored: 0
promoted_to_rule: true
confidence: 95
agent: learner
updated: 2026-08-10
---
Cerrar un modal no es autenticarse. La vista protegida no debe existir/activarse
hasta que hay un flag de sesión real. Escape, back, o cerrar UI no otorgan acceso.
