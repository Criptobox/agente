# 🧠 agent-brain

Sistema multi-agente con memoria compartida. **Coste $0**, sin servidor, operable desde el móvil.
Corre sobre GitHub: Actions = runtime, GitHub Models = IA gratis, archivos del repo = memoria, commits = auditoría, Issues = tareas, comentarios = handoffs.

---

## Puesta en marcha (desde el móvil, 5 pasos)

1. **Crea el repo.** Sube estos archivos a un repo nuevo llamado `agent-brain`. Hazlo **público** (Actions ilimitado gratis) o privado si prefieres (gastas cuota de minutos).

2. **Activa GitHub Models.** No necesitas nada: los workflows ya piden `permissions: models: read`, y el `GITHUB_TOKEN` del runner llama a la IA gratis. Sin tarjeta, sin cuenta extra.

3. **Permisos de Actions.** En el repo: Settings → Actions → General → *Workflow permissions* → marca **Read and write permissions**. (Deja que los agentes escriban memoria.)

4. **(Opcional) Fallback.** Si quieres respaldo cuando GitHub Models se sature: Settings → Secrets → Actions, añade `GROQ_API_KEY` y/o `GEMINI_API_KEY`. Si no los pones, el sistema usa solo GitHub Models.

5. **Primera prueba.** Abre un Issue, ponle la etiqueta `agent`, título: *"Revisa por qué el total del carrito sale mal"*. El Orchestrator lo convierte en tarea y te dice qué agente lanzar.

---

## Cómo se usa (flujo diario)

```
Abres un Issue con etiqueta "agent"
        ↓
orchestrator.yml → consulta memoria, crea TASK-XXXX, define gates, te dice el primer agente
        ↓
Actions → agent-run → agent=code, task_id=TASK-XXXX, issue=N
        ↓
El agente comenta su handoff en el Issue. Lo lees en la app de GitHub.
        ↓
Lanzas el siguiente agente (o el Judge para verificar).
        ↓
Al cerrar: memoria commiteada, lección aprendida, Issue cerrado.
```

En F0 tú haces de orquestador manual: lees el handoff y lanzas el siguiente. En fases siguientes se encadena solo.

---

## Los agentes

| Agente | Qué hace | Escribe código |
|---|---|---|
| **orchestrator** | Divide, consulta memoria, define gates, coordina | no |
| **code** | Analiza código, detecta bugs y duplicación | no (F0) |
| **logic** | Busca contradicciones de intención (errores de lógica/síntesis) | no |
| **security** | Vulnerabilidades en TU código, da el parche (defensivo) | no |
| **breaker** | Rompe la app con entradas absurdas, **en sandbox efímero** | no |
| **test** | Ejecuta/crea tests, verifica, detecta regresiones | no |
| **judge** | ÚNICO que declara "terminado", contra gates objetivos | nunca |
| **research** | Investiga docs/errores conocidos externos | no |
| **learner** | Post-mortem → lecciones que evitan repetir la clase de error | no |
| **devil** | Abogado del diablo: duda del consenso antes del veredicto | no |
| **impact** | Predice qué se rompería ANTES de tocar (contra memoria de bugs) | no |
| **budget** | Vigila la cuota gratis y para tareas que la agotan | no |
| **diarist** | Diario nocturno: qué pasó y qué mirar mañana | no |
| **selfimprove** | Lee su propio historial y abre PRs para mejorar sus prompts | vía PR |
| **defender** | Modo tribunal: defiende que la solución cumple, con evidencia | no |
| **prosecutor** | Modo tribunal: su único mandato es demostrar que la solución falla | no |

## Modo tribunal ⚖️

Para las decisiones importantes, no basta con que un agente diga "está bien". Activas un **juicio**:

1. **Defensor** argumenta que la solución cumple los gates — con pruebas, no opiniones.
2. **Fiscal** (`prosecutor`) tiene el mandato opuesto: demostrar que falla, con un test concreto que lo pruebe.
3. **Juez** decide sobre la evidencia, no sobre quién argumentó mejor.
4. **Verificación cruzada**: si configuraste un segundo proveedor (Groq/Gemini), otro modelo revisa el veredicto. Si discrepa, la tarea sube a tu decisión en vez de cerrarse.

Esto es lo que de verdad querías con "dos que debaten" — pero sin duplicar repos, cuota ni mantenimiento. El desacuerdo útil viene de roles opuestos y de dos arquitecturas distintas, no de dos copias del mismo cerebro.

**Cómo activarlo:** comenta `/tribunal TASK-0001` en el Issue de la tarea, o lánzalo a mano desde la pestaña Actions → tribunal.

> La verificación cruzada solo se enciende si defines `GROQ_API_KEY` o `GEMINI_API_KEY` en los secrets. Sin eso, el tribunal funciona igual pero con un solo juez.

## Automatismos nocturnos y semanales

- **nightly.yml** (cada noche): reloj de decaimiento (marca memorias obsoletas, baja confianza de lo viejo, regenera `index.json`) + diario en un Issue.
- **self-improve.yml** (semanal): analiza el historial y, si detecta un patrón de fallo repetido, abre un PR proponiendo mejorar un prompt. Tú apruebas.
- **memory/criterio/kros.md**: cómo trabajas y decides tú. El sistema lo aplica sin que se lo repitas (archivos completos, mobile-only, odio al `!important`, etc.).

**Para añadir un agente nuevo:** crea `agents/nombre.md` con su rol, permisos y tools. No tocas el núcleo.

---

## El sandbox efímero (probar "en vivo" sin riesgo)

`sandbox.yml` levanta una **copia** de tu web dentro del runner de GitHub y el Breaker la ataca ahí. **Nunca toca producción.** Apunta Firebase a un proyecto de PRUEBA para que no roce tus datos reales.

Lanzar: Actions → sandbox-breaker → repo=`Criptobox/TiendaMax`, task_id=`TASK-XXXX`.

---

## Reglas que hacen que esto funcione (no las quites)

1. **El que hace el trabajo nunca declara su éxito.** Eso es del Judge, contra gates escritos antes de empezar.
2. **La verificación sale de una herramienta**, no de una opinión. Exit code, test, diff, HTTP.
3. **Preferible 0 memorias que ruido.** La memoria se degrada con basura y deja de servir.
4. **El código actual manda sobre la memoria histórica.** Las memorias obsoletas se marcan `stale`, no se borran.
5. **Detección de repetición:** mismo error 2 veces → se cuestiona el *diagnóstico*, no se prueban más variantes.

---

## Estructura

```
agents/       definición de cada agente (markdown declarativo)
memory/       errors/ decisions/ facts/ lessons/ projects/  (la base de conocimiento)
tasks/        TASK-XXXX.json (estado, gates, handoffs)
src/          runner.js (ciclo), memory.js, context.js, models.js, orchestrate.js
dashboard/    panel estático para GitHub Pages
.github/workflows/  agent-run · orchestrator · sandbox-breaker
```

## El único criterio de éxito

> Que un agente diga *"esto ya se intentó y falló, voy directo a la otra vía"* — y tenga razón.

Todo lo demás es andamiaje.

## 📱 Instalar como app (PWA)

El panel `dashboard/` es una PWA instalable. Se lee tu repo **sin meter ningún token en el código** (por defecto). Pasos, todo desde el móvil:

1. **Activa GitHub Pages**: Settings → Pages → Source: *Deploy from a branch* → rama `main`, carpeta `/ (root)` → Save.
2. Espera 1-2 min y abre en el navegador: `https://TU_USUARIO.github.io/agent-brain/dashboard/`
3. **Instálala**:
   - **Android/Chrome**: aparecerá el botón "⬇ Instalar app", o menú ⋮ → "Instalar aplicación".
   - **iPhone/Safari**: botón Compartir → "Añadir a pantalla de inicio".
4. Ábrela desde el icono. Ya la tienes como app, con su icono coral.
5. La primera vez, toca ⚙︎ y confirma tu **owner** y **repo** (por defecto `Criptobox / agent-brain`).

**Crea la etiqueta `agent` una vez** en el repo (Issues → Labels → New label → nombre `agent`). El botón "＋ Nueva tarea" abre GitHub con todo prellenado; tú solo pulsas *Submit*. El orchestrator la recoge sola.

### Cómo se usa, día a día
- **📓 Diario**: lo primero que ves. Qué hizo el sistema anoche y qué mirar hoy.
- **📋 Tareas**: cada tarea con su estado y, si hubo juicio, el veredicto del tribunal. Botón ⚖️ para pedir un tribunal.
- **🧠 Memoria**: lo que el cerebro sabe (bugs, lecciones, decisiones), con su confianza.
- **＋ Nueva tarea**: describes qué necesitas → se crea el Issue → los agentes trabajan → vuelves y lees el resultado.

### Modo "un toque" (opcional)
Si quieres crear tareas y lanzar tribunales sin salir de la app (sin abrir GitHub cada vez), en ⚙︎ pega un **token fine-grained** con permiso mínimo (Issues + Actions, solo este repo, caducidad corta). Se guarda **solo en tu teléfono**, nunca se sube al repo. Sin token, todo funciona igual pero pasando por la pantalla de GitHub — que es la opción más segura y la recomendada.
