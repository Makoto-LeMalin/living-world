import type { ChatClient, ChatRequest, ChatResponse } from "../../../llm/types.ts";

/** 测试用：按顺序返回预置内容，或按请求生成。 */
export class StubClient implements ChatClient {
  readonly calls: ChatRequest[] = [];
  private readonly replies: string[] | ((request: ChatRequest) => string);

  constructor(replies: string[] | ((request: ChatRequest) => string)) {
    this.replies = replies;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.calls.push(request);
    if (typeof this.replies === "function") {
      return { content: this.replies(request), model: request.model };
    }
    const content = this.replies.shift();
    if (content === undefined) throw new Error(`StubClient 没有更多回复（已调用 ${this.calls.length} 次）`);
    return { content, model: request.model };
  }
}
