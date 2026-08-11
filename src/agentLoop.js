// src/agentLoop.js
// Ciclo agéntico compartido por runner.js (un agente normal) y tribunal.js
// (defensor/fiscal/juez). Si el rol declara tools implementadas en tools.js,
// se las ofrecemos al modelo y dejamos que las llame antes de responder. Si
// no declara ninguna, esto es una sola llamada de texto (comportamiento de
// antes de que existiera tool-calling, sin cambios).

import { chat } from "./models.js";
import { toolsForAgent } from "./tools.js";

const MAX_TOOL_TURNS = 6;

// Extrae el primer objeto JSON de la respuesta del modelo, tolerante a ruido.
export function parseJSON(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("el modelo no devolvió JSON");
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function runTurn({ system, user, tier, agentMarkdown, max_tokens = 2500 }) {
  const { schemas, run: runTool } = toolsForAgent(agentMarkdown);
  const toolLog = [];
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  // Cada turno con tools es una llamada de chat() aparte, cada una con su
  // propio "usage": si solo devolviéramos el usage del último turno,
  // subestimaríamos el gasto real de una tarea con varias llamadas a tools.
  let totalTokens = 0;

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const offerTools = schemas.length > 0 && turn < MAX_TOOL_TURNS - 1;
    const out = await chat(messages, {
      tier, max_tokens,
      json: !offerTools, // JSON estricto solo en el turno en que ya no hay tools que ofrecer
      tools: offerTools ? schemas : null,
    });
    totalTokens += out.usage?.total_tokens ?? ((out.usage?.prompt_tokens || 0) + (out.usage?.completion_tokens || 0));

    if (out.tool_calls?.length) {
      messages.push({ role: "assistant", content: out.text || null, tool_calls: out.tool_calls });
      for (const call of out.tool_calls) {
        const toolResult = await runTool(call.function.name, call.function.arguments);
        toolLog.push({ name: call.function.name, args: call.function.arguments, result: toolResult });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(toolResult).slice(0, 4000) });
      }
      continue;
    }
    return { result: parseJSON(out.text), out: { ...out, totalTokens }, toolLog };
  }
  throw new Error("se agotaron los turnos de herramientas sin respuesta final");
}

// Igual que runTurn pero cae a una sola llamada de texto (sin tools) si el
// ciclo con herramientas falla por completo. El tool-calling es una mejora,
// nunca un requisito: nunca debe dejar una tarea peor de lo que estaba antes.
export async function runTurnSafe(opts) {
  try {
    return await runTurn(opts);
  } catch (e) {
    console.error("Ciclo con herramientas falló, reintento en modo texto:", e.message);
    const out = await chat(
      [{ role: "system", content: opts.system }, { role: "user", content: opts.user }],
      { tier: opts.tier, json: true, max_tokens: opts.max_tokens || 2500 }
    );
    const totalTokens = out.usage?.total_tokens ?? ((out.usage?.prompt_tokens || 0) + (out.usage?.completion_tokens || 0));
    return { result: parseJSON(out.text), out: { ...out, totalTokens }, toolLog: [] };
  }
}
