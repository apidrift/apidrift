/**
 * Injectable LLM abstraction. The agent loop speaks the Anthropic Messages
 * shape, so BYOT (direct), a managed gateway (base URL + org token), and
 * BYO-endpoint (Bedrock / Vertex — Anthropic models, same protocol) all reuse
 * ONE wrapper. See providers.ts for policy-driven selection.
 */
import Anthropic from '@anthropic-ai/sdk';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}
export interface LlmToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools: LlmToolDef[];
  max_tokens: number;
}
export interface LlmResponse {
  stop_reason: string | null;
  content: ContentBlock[];
}
export interface Llm {
  createMessage(req: LlmRequest): Promise<LlmResponse>;
}

/** Any client exposing Anthropic's messages.create (direct, Bedrock, Vertex). */
export interface AnthropicLike {
  messages: {
    create(body: Record<string, unknown>): Promise<{ stop_reason: string | null; content: unknown }>;
  };
}

/** Wrap an Anthropic-compatible client + model id into our Llm interface. */
export function fromAnthropicClient(client: AnthropicLike, model: string): Llm {
  return {
    async createMessage(req: LlmRequest): Promise<LlmResponse> {
      const res = await client.messages.create({
        model,
        max_tokens: req.max_tokens,
        system: req.system,
        messages: req.messages,
        tools: req.tools,
      });
      return { stop_reason: res.stop_reason, content: res.content as ContentBlock[] };
    },
  };
}

export interface AnthropicLLMOptions {
  /** Direct API key (BYOT). */
  apiKey?: string;
  /** Bearer token (managed gateway). */
  authToken?: string;
  /** Override endpoint (managed gateway / proxy). */
  baseURL?: string;
  model?: string;
}

/** Direct Anthropic client — serves BYOT and the managed gateway. */
export class AnthropicLLM implements Llm {
  private readonly impl: Llm;

  constructor(opts: AnthropicLLMOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey && !opts.authToken) {
      throw new Error('AnthropicLLM: provide an apiKey (ANTHROPIC_API_KEY) or an authToken');
    }
    const client = new Anthropic({
      apiKey,
      authToken: opts.authToken,
      baseURL: opts.baseURL,
    }) as unknown as AnthropicLike;
    const model = opts.model ?? process.env.APIDRIFT_MODEL ?? 'claude-sonnet-4-5';
    this.impl = fromAnthropicClient(client, model);
  }

  createMessage(req: LlmRequest): Promise<LlmResponse> {
    return this.impl.createMessage(req);
  }
}

/** Convenience: an LLM from a plain ANTHROPIC_API_KEY (BYOT), or undefined. */
export function llmFromEnv(): Llm | undefined {
  return process.env.ANTHROPIC_API_KEY ? new AnthropicLLM() : undefined;
}
