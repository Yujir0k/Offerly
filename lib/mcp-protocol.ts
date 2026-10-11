import type { McpContext } from "./mcp-auth";
import { callMcpTool, mcpToolDefinitions } from "./mcp-tools";
import { McpError } from "./mcp-policy";

export const mcpVersions = [
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
  "2025-11-25",
];

/** Small bounded MCP core: initialize, ping and the three explicitly allowed tools. */
export async function handleMcpMessage(context: McpContext, raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new McpError("Нужен один JSON-RPC запрос.");
  const message = raw as Record<string, unknown>;
  if (
    message.jsonrpc !== "2.0" ||
    typeof message.method !== "string" ||
    ("id" in message &&
      typeof message.id !== "string" &&
      typeof message.id !== "number")
  )
    throw new McpError("Некорректный JSON-RPC запрос.");
  const id = message.id;
  if (id === undefined) {
    if (
      !["notifications/initialized", "notifications/cancelled"].includes(
        message.method,
      )
    )
      throw new McpError("Неизвестное уведомление.");
    return null;
  }
  const params =
    message.params &&
    typeof message.params === "object" &&
    !Array.isArray(message.params)
      ? (message.params as Record<string, unknown>)
      : {};
  let result: unknown;
  if (message.method === "initialize") {
    result = {
      protocolVersion: mcpVersions.includes(String(params.protocolVersion))
        ? params.protocolVersion
        : "2025-11-25",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "offerly-employer-demo", version: "1.0.0" },
      instructions:
        (context.account.demo
          ? "Работайте только с синтетическими профилями. "
          : "Работайте только с доступным каталогом своей компании. ") +
        "Доступны поиск, обезличенный профиль и черновик. Обе границы зарплаты обязательны. Отправка, контакты, сообщения и решения о найме недоступны.",
    };
  } else if (message.method === "ping") result = {};
  else if (message.method === "tools/list")
    result = { tools: mcpToolDefinitions() };
  else if (message.method === "tools/call") {
    try {
      if (typeof params.name !== "string")
        throw new McpError("Выберите инструмент.");
      const data = await callMcpTool(
        context,
        params.name,
        params.arguments ?? {},
      );
      result = {
        content: [{ type: "text", text: JSON.stringify(data) }],
        structuredContent: data,
        isError: false,
      };
    } catch (error) {
      result = {
        content: [
          {
            type: "text",
            text:
              error instanceof McpError
                ? error.message
                : "Не удалось выполнить инструмент. Проверьте условия и повторите.",
          },
        ],
        isError: true,
      };
    }
  } else
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Метод MCP недоступен." },
    };
  return { jsonrpc: "2.0", id, result };
}
