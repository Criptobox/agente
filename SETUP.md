# 🚀 Puesta en marcha — todo desde el móvil

Sigue esto en orden. Son 6 pasos, una sola vez. Al final tienes la app instalada y el equipo funcionando.

---

## 1. Sube el repo a GitHub
- Crea un repositorio **público** llamado `agent-brain` en tu cuenta (Criptobox).
- Sube todos estos archivos (desde la web de GitHub: *Add file → Upload files*, arrastra el contenido del zip).
- Rama por defecto: `main`.

> Público es importante: así la app puede **leer** tu memoria y tareas sin ningún token. Tu código de agentes no tiene secretos, así que ser público es seguro.

---

## 2. Da permisos de escritura a las Actions
Los agentes necesitan escribir en el repo (memoria, tareas, commits).

- **Settings → Actions → General**
- Baja a **Workflow permissions**
- Marca **Read and write permissions** → **Save**

---

## 3. Enciende el auto-deploy de la app (Pages)
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

## 4. Crea la etiqueta `agent` (una vez)
Es la señal de que un Issue es una tarea para el equipo.

- Pestaña **Issues → Labels → New label**
- Nombre exacto: `agent` → **Create label**

(Opcional pero recomendado: crea también la etiqueta `diario`, para el diario nocturno.)

---

## 5. Instala la app en tu teléfono
- Abre `https://criptobox.github.io/agent-brain/` en el navegador.
- **Android/Chrome**: botón "⬇ Instalar app" o menú ⋮ → *Instalar aplicación*.
- **iPhone/Safari**: botón Compartir → *Añadir a pantalla de inicio*.
- Ábrela desde el icono coral. Se abre a pantalla completa, como una app.
- La primera vez, toca ⚙︎ y confirma **owner** = `Criptobox` y **repo** = `agent-brain`.

---

## 6. (Opcional) Segundo modelo y modo "un toque"
- **Verificación cruzada del tribunal**: en **Settings → Secrets and variables → Actions → New repository secret**, añade `GROQ_API_KEY` (gratis en groq.com) o `GEMINI_API_KEY`. Con eso, un segundo modelo revisa los veredictos.
- **Modo un toque** en la app: en ⚙︎ puedes pegar un token *fine-grained* (permiso mínimo: Issues + Actions de este repo, caducidad corta). Se guarda **solo en tu teléfono**. Sin token todo funciona igual, pasando por GitHub.

---

## ✅ Prueba que todo quedó bien
1. En la app, toca **＋ Nueva tarea**, escribe algo simple y créala.
2. Se abre GitHub con el Issue prellenado (etiqueta `agent`) → pulsa **Submit**.
3. Ve a la pestaña **Actions**: verás correr **orchestrator**. Cuando termine, en el Issue aparece un comentario con la tarea creada.
4. Vuelve a la app, pestaña **Tareas**: ahí está, con su estado.

Si algo no aparece:
- ¿La app dice "no pude leer el repo"? Revisa en ⚙︎ que owner/repo son correctos y el repo es **público**.
- ¿No corre el orchestrator? Revisa que el Issue lleve la etiqueta `agent` y que diste permisos de escritura (paso 2).
- ¿La página no despliega? Ve a **Actions → pages** y mira que el último run esté verde; si Pages no estaba en modo *GitHub Actions*, cámbialo (paso 3) y relanza.
