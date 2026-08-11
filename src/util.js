// src/util.js
// Validación mínima de IDs/rutas antes de escribir a disco. Necesario porque
// varios IDs vienen de fuentes no confiables (salida del modelo, comentarios
// públicos de Issues) y se usan para construir rutas de archivo.

export function safeId(id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error(`id inválido o inseguro: ${JSON.stringify(id)}`);
  }
  return id;
}

// Solo permite tocar archivos dentro de agents/, con nombre simple (sin ../ ni rutas absolutas).
export function safeAgentFile(file) {
  if (typeof file !== "string" || !/^agents\/[a-zA-Z0-9_-]+\.md$/.test(file)) {
    throw new Error(`ruta de agente inválida o insegura: ${JSON.stringify(file)}`);
  }
  return file;
}
