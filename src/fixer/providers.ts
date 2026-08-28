/**
 * Inference policy -> concrete LLM provider. This is the seam that lets one
 * engine serve every tier without the customer ever holding an LLM key they
 * shouldn't:
 *   deterministic-only : no model at all (safest; Free + regulated)
 *   byot               : the user's own key (Free)
 *   managed            : our metered gateway, org token (Cloud)
 *   byo-endpoint       : the customer's Bedrock / Vertex (Enterprise)
 */
import { AnthropicLLM, fromAnthropicClient, type AnthropicLike, type Llm } from './llm.js';

export type InferencePolicy = 'deterministic-only' | 'byot' | 'managed' | 'byo-endpoint';

export interface InferenceConfig {
  policy: InferencePolicy;
  model?: string;
  /** managed */
  gatewayUrl?: string;
  orgToken?: string;
  /** byo-endpoint */
  endpoint?: 'bedrock' | 'vertex';
  awsRegion?: string;
  vertexRegion?: string;
  vertexProjectId?: string;
}

/** Build the LLM for a policy, or undefined for deterministic-only. */
export async function resolveLlm(cfg: InferenceConfig): Promise<Llm | undefined> {
  switch (cfg.policy) {
    case 'deterministic-only':
      return undefined;

    case 'byot':
      return new AnthropicLLM({ model: cfg.model });

    case 'managed': {
      const baseURL = cfg.gatewayUrl ?? process.env.APIDRIFT_GATEWAY_URL;
      const authToken = cfg.orgToken ?? process.env.APIDRIFT_ORG_TOKEN;
      if (!baseURL || !authToken) {
        throw new Error('managed inference needs APIDRIFT_GATEWAY_URL and APIDRIFT_ORG_TOKEN');
      }
      return new AnthropicLLM({ baseURL, authToken, model: cfg.model });
    }

    case 'byo-endpoint':
      return cfg.endpoint === 'vertex' ? vertex(cfg) : bedrock(cfg);
  }
}

/** Anthropic-on-Bedrock. SDK is optional — only needed for this path. */
async function bedrock(cfg: InferenceConfig): Promise<Llm> {
  const mod = await importOptional('@anthropic-ai/bedrock-sdk', 'byo-endpoint (Bedrock)');
  const AnthropicBedrock = (mod as { AnthropicBedrock: new (o: unknown) => AnthropicLike }).AnthropicBedrock;
  const client = new AnthropicBedrock({ awsRegion: cfg.awsRegion ?? process.env.AWS_REGION });
  const model = cfg.model ?? process.env.APIDRIFT_MODEL ?? 'anthropic.claude-sonnet-4-5-v1:0';
  return fromAnthropicClient(client, model);
}

/** Anthropic-on-Vertex. SDK is optional — only needed for this path. */
async function vertex(cfg: InferenceConfig): Promise<Llm> {
  const mod = await importOptional('@anthropic-ai/vertex-sdk', 'byo-endpoint (Vertex)');
  const AnthropicVertex = (mod as { AnthropicVertex: new (o: unknown) => AnthropicLike }).AnthropicVertex;
  const client = new AnthropicVertex({
    region: cfg.vertexRegion ?? process.env.CLOUD_ML_REGION,
    projectId: cfg.vertexProjectId ?? process.env.ANTHROPIC_VERTEX_PROJECT_ID,
  });
  const model = cfg.model ?? process.env.APIDRIFT_MODEL ?? 'claude-sonnet-4-5@20250929';
  return fromAnthropicClient(client, model);
}

async function importOptional(pkg: string, forWhat: string): Promise<unknown> {
  try {
    return await import(pkg);
  } catch {
    throw new Error(
      `${forWhat} requires the optional package "${pkg}". Install it: npm i ${pkg}`,
    );
  }
}
