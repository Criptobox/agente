---
id: FACT-102
type: fact
project: null
statement: "La tienda AXONTECH de axontech92.github.io/AXONTECH (repo axontech92/AXONTECH) es EXTERNA a kros. Su stock vivo no está en el productos.json del repo: la página hace poll cada 5 s de Supabase (tabla productos, select público). El centinela vigila ese stock por orden de kros."
confidence: 95
symbols: [supabase, axontech]
tags: [vigilancia, supabase, axontech, stock, terceros]
agent: vigilancia
updated: 2026-08-22
---
- Endpoint: https://gdzsqwyedzrfituewdtt.supabase.co/rest/v1/productos
  con la clave publicable sb_publishable_Ftyw83d2WPU7TtC7JacCRw_uQuqFXdW
  (la misma que lleva su app.js público; lectura anónima permitida por RLS).
- Filas: { id, data(jsonb: nombre, stock, comision, precioActual, ...), updated_at }.
- productos.json del repo axontech92/AXONTECH es un export estático (fallback).
- El repo axontech92/AXONTECH documenta que el plan gratis de Supabase
  (5 GB/mes) ya se agotó una vez por bajar tablas enteras: por eso el
  centinela usa la consulta barata updated_at antes de la bajada completa.
- NO confundir con Criptobox/AXONTECH (proyecto propio de kros, vales de
  venta con gestores): es otro negocio, otro repo, otra fuente de datos.
