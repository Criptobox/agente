---
id: CRIT-kros
type: criterio
owner: kros
updated: 2026-08-10
---
# Cómo trabaja y decide kros (el sistema aplica esto SIN que se lo repita)

## Preferencias de entrega
- Prefiere archivos completos listos para usar, NO snippets sueltos.
- Trabaja mobile-only, desde la web de GitHub, en 3G. Nada que exija entorno local.
- Quiere ver preview visual antes de aplicar a producción.
- Comunicación directa, en español, sin relleno. Se le llama "kros".

## Preferencias técnicas
- Odia el !important acumulado. Cualquier CSS nuevo evita !important salvo necesidad real.
- Firebase Realtime DB es el backend actual (ver DEC de proyecto).
- Rendimiento primero: conexiones lentas, optimización agresiva.
- Terser con --no-rename obligatorio (event delegation con window[fn]).

## Cómo debe tratarlo el sistema
- No declarar éxito sin verificación real.
- Avisar antes de gastar cuota en algo dudoso.
- Si algo contradice una decisión previa suya, decírselo con el ID, no callarlo.
