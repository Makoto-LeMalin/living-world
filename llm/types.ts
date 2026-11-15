/** LLM 接口的最小抽象。所有角色（Mind / DM / Narrator）共用。 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** 'json' → 请求服务端 JSON 模式；解析仍要自己兜底 */
  responseFormat?: "text" | "json";
  /** 默认 false（服务端 thinking 关闭）；开启会多一层思考内容与成本 */
  thinking?: boolean;
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage?: ChatUsage;
}

export interface ChatClient {
  chat(request: ChatRequest): Promise<ChatResponse>;
}
