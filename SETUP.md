# 🚀 Puesta en marcha — todo desde el móvil

Sigue esto en orden. Son 7 pasos, una sola vez. Al final tienes la app instalada y el equipo funcionando.

---

## 1. Sube el repo a GitHub
- Crea un repositorio **público** llamado `agent-brain` en tu cuenta (Criptobox).
- Sube todos estos archivos (desde la web de GitHub: *Add file → Upload files*, arrastra el contenido del zip).
- Rama por defecto: `main`.

> Público es importante: así la app puede **leer** tu memoria y tareas sin ningún token. Tu código de agentes no tiene secretos, así que ser público es seguro.

---

## 2. Configura la IA (obligatorio)
> ⚠️ GitHub Models —el proveedor de IA con el que se diseñó este proyecto— se retiró por completo el 30 de julio de 2026. Ya no existe, ni como principal ni como respaldo. Sin este paso, ningún agente puede pensar.

El sistema prueba proveedores en este orden, usa el primero que tengas configurado (y salta al siguiente si uno falla o se satura):

| Proveedor | Secret | Consíguela en | Notas |
|---|---|---|---|
| Groq | `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) | La más rápida de sacar, límite gratis generoso. **Empieza por esta.** |
| Gemini | `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com) | Segunda opción recomendada — con Groq + Gemini el tribunal ya hace verificación cruzada. |
| Mistral | `MISTRAL_API_KEY` | [console.mistral.ai](https://console.mistral.ai) | 1.000 millones de tokens/mes gratis (sin tarjeta, solo verifica tu teléfono). Su único límite: 2 peticiones/minuto. |
| OpenRouter | `OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) | Pasarela a decenas de modelos; usa su router gratis (`openrouter/free`), que elige solo un modelo disponible en cada momento. |
| Z.ai (GLM Flash) | `ZAI_API_KEY` | [z.ai](https://z.ai/model-api) | Usa GLM-4.5/4.7-Flash, gratis (~1000 peticiones/día). Si quieres más capacidad y no te importa pagar, cambia el modelo a `glm-5.2` en `src/models.js` (de pago, tier gratis ~50/día). |

Con **uno solo** ya funciona todo. Cuantos más tengas, más resistente es el sistema a que un proveedor se sature o cambie su catálogo.

- En el repo: **Settings → Secrets and variables → Actions → New repository secret**. Crea el/los secret(s) con el nombre exacto de la tabla y el valor de tu clave.

---

## 3. Da permisos de escritura a las Actions
Los agentes necesitan escribir en el repo (memoria, tareas, commits).

- **Settings → Actions → General**
- Baja a **Workflow permissions**
- Marca **Read and write permissions** → **Save**

---

## 4. Enciende el auto-deploy de la app (Pages)
Aquí es donde la app se publica sola.

- **Settings → Pages**
- En **Source**, elige **GitHub Actions** (NO "Deploy from a branch")
- Listo. No hay que guardar nada más.

A partir de ahora, cada vez que cambies algo en `dashboard/`, el workflow **pages** la vuelve a publicar solo. La primera vez, ve a la pestaña **Actions**, entra en el workflow **pages** y pulsa **Run workflow** para lanzarlo la primera vez (o toca cualquier archivo del dashboard).

Cuando termine (1–2 min), tu app estará en:
```
https://criptobox.github.io/agent-brain/
```

---

## 5. Crea la etiqueta `agent` (una vez)
Es la señal de que un Issue es una tarea para el equipo.

- Pestaña **Issues → Labels → New label**
- Nombre exacto: `agent` → **Create label**

(Opcional pero recomendado: crea también la etiqueta `diario`, para el diario nocturno.)

---

## 6. Instala la app en tu teléfono
- Abre `https://criptobox.github.io/agent-brain/` en el navegador.
- **Android/Chrome**: botón "⬇ Instalar app" o menú ⋮ → *Instalar aplicación*.
- **iPhone/Safari**: botón Compartir → *Añadir a pantalla de inicio*.
- Ábrela desde el icono coral. Se abre a pantalla completa, como una app.
- La primera vez, toca ⚙︎ y confirma **owner** = `Criptobox` y **repo** = `agent-brain`.

---

## 7. (Opcional) Modo "un toque"
- En ⚙︎ puedes pegar un token *fine-grained* (permiso mínimo: Issues + Actions de este repo, caducidad corta) para crear tareas y lanzar tribunales sin salir de la app. Se guarda **solo en tu teléfono**. Sin token todo funciona igual, pasando por GitHub.

---

## ✅ Prueba que todo quedó bien
1. En la app, toca **＋ Nueva tarea**, escribe algo simple y créala.
2. Se abre GitHub con el Issue prellenado (etiqueta `agent`) → pulsa **Submit**.
3. Ve a la pestaña **Actions**: verás correr **orchestrator**. Cuando termine, en el Issue aparece un comentario con la tarea creada.
4. Vuelve a la app, pestaña **Tareas**: ahí está, con su estado.

Si algo no aparece:
- ¿El comentario del Issue dice "La IA no respondió"? Revisa el paso 2: sin `GROQ_API_KEY` o `GEMINI_API_KEY` nada piensa (GitHub Models ya no existe).
- ¿La app dice "no pude leer el repo"? Revisa en ⚙︎ que owner/repo son correctos y el repo es **público**.
- ¿No corre el orchestrator? Revisa que el Issue lleve la etiqueta `agent` y que diste permisos de escritura (paso 3).
- ¿La página no despliega? Ve a **Actions → pages** y mira que el último run esté verde; si Pages no estaba en modo *GitHub Actions*, cámbialo (paso 4) y relanza.

**Diagnóstico rápido:** Actions → **doctor** → *Run workflow*. Te dice exactamente qué falta (IA, permisos, etiqueta) sin que tengas que revisar cada paso a mano.
