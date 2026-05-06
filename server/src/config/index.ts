import dotenv from 'dotenv';
import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { z } from 'zod';

dotenv.config(
  process.env.DOTENV_CONFIG_PATH ? { path: process.env.DOTENV_CONFIG_PATH } : undefined,
);

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  PINECONE_API_KEY: z.string().min(1, 'PINECONE_API_KEY is required'),
  PINECONE_INDEX_NAME: z.string().min(1, 'PINECONE_INDEX_NAME is required'),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1, 'CLOUDFLARE_ACCOUNT_ID is required'),
  CLOUDFLARE_API_TOKEN: z.string().min(1, 'CLOUDFLARE_API_TOKEN is required'),
  CLOUDFLARE_EMBEDDING_MODEL: z.string().min(1, 'CLOUDFLARE_EMBEDDING_MODEL is required'),
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  GEMINI_MODEL: z.string().min(1, 'GEMINI_MODEL is required'),
  EMBEDDING_DIMENSION: z.coerce.number().int().positive().default(768),
  RETRIEVAL_TOP_K: z.coerce.number().int().positive().default(5),
  RELEVANCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.65),
  EMBEDDING_CACHE_TTL_MS: z.coerce.number().int().positive().default(3600000),
  RATE_LIMIT_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(60),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const messages = parsedEnv.error.issues.map((issue) => {
    const key = issue.path.join('.') || 'environment';
    return `${key}: ${issue.message}`;
  });

  throw new Error(`Invalid environment configuration: ${messages.join('; ')}`);
}

const env = parsedEnv.data;

export const config = {
  port: env.PORT,
  pinecone: {
    apiKey: env.PINECONE_API_KEY,
    indexName: env.PINECONE_INDEX_NAME,
  },
  cloudflare: {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: env.CLOUDFLARE_API_TOKEN,
    embeddingModel: env.CLOUDFLARE_EMBEDDING_MODEL,
  },
  gemini: {
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  },
  retrieval: {
    embeddingDimension: env.EMBEDDING_DIMENSION,
    topK: env.RETRIEVAL_TOP_K,
    relevanceThreshold: env.RELEVANCE_THRESHOLD,
    embeddingCacheTtlMs: env.EMBEDDING_CACHE_TTL_MS,
  },
  rateLimit: {
    requestsPerMinute: env.RATE_LIMIT_REQUESTS_PER_MINUTE,
    windowMs: 60000,
  },
} as const;

let pineconeClient: Pinecone | undefined;
let openAIClient: OpenAI | undefined;

export function getPineconeClient(): Pinecone {
  pineconeClient ??= new Pinecone({ apiKey: config.pinecone.apiKey });
  return pineconeClient;
}

export function getPineconeIndex() {
  return getPineconeClient().index(config.pinecone.indexName);
}

export function getOpenAIClient(): OpenAI {
  openAIClient ??= new OpenAI({
    apiKey: config.gemini.apiKey,
    baseURL: config.gemini.baseURL,
  });

  return openAIClient;
}
