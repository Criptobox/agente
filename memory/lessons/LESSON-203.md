---
id: LESSON-203
type: lesson
scope: general
trigger: "manejo de tokens, API keys, PAT, secretos en apps estáticas"
files_pattern: [*token*, *firebase*, *admin*, *config*]
rule: "Ningún secreto vive en el cliente ni viaja por Firebase. Las ops con token van en GitHub Actions."
anti_pattern: "Guardar/transmitir un PAT o API key por Firebase o en JS del cliente"
born_from: [BUG-203]
times_applied: 0
times_prevented_failure: 0
times_ignored: 0
promoted_to_rule: true
confidence: 98
agent: learner
updated: 2026-08-10
---
En hosting estático el cliente es público: cualquier secreto ahí (o en Firebase
legible) queda expuesto. Las operaciones que requieren token se hacen server-side,
que aquí significa GitHub Actions con el GITHUB_TOKEN del runner. Rotar cualquier
secreto que haya tocado el cliente.
