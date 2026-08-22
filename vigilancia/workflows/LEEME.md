# ⚙️ Activar los workflows del centinela (un paso de 2 minutos)

Los dos archivos de esta carpeta son los workflows que hacen correr al
centinela cada 10 minutos (`vigilancia.yml`) y al vigía cada mañana
(`vigia-diario.yml`).

**Por qué están aquí y no en `.github/workflows/`:** el token con el que se
subió este código no tenía permiso `workflows`, así que GitHub rechazó subir
archivos dentro de `.github/workflows/`. Son archivos de texto plano: solo
hay que copiarlos a su sitio. Dos opciones:

## Opción A — desde el móvil (recomendada, 2 archivos)
1. En el repo (`Criptobox/agente`) → **Add file → Create new file**.
2. Nombre del archivo: **`.github/workflows/vigilancia.yml`** (exacto, con la carpeta).
3. Copia TODO el contenido de [`vigilancia.yml`](vigilancia.yml) de esta carpeta y pégalo. Botón **Commit changes**.
4. Repite con **`.github/workflows/vigia-diario.yml`** ← contenido de [`vigia-diario.yml`](vigia-diario.yml).

En cuanto hagas el commit de ambos, los crons quedan activos solos:
- `vigilancia`: cada 10 minutos (el badge y las alertas aparecen en la app).
- `vigia-diario`: cada mañana a las 12:00 UTC (~8 AM Cuba).

Para verificar: pestaña **Actions** → `vigilancia` → **Run workflow** → ejecuta una vez a mano.

## Opción B — volver a conectar GitHub en Arena
Si reconectas la cuenta de GitHub en Arena y avisas, el agente puede mover
estos dos archivos a `.github/workflows/` y actualizar el PR él mismo.

---
Los workflows solo necesitan los permisos que ya usa el resto del repo
(`contents: write`), más los secrets de IA que ya tengas configurados.
