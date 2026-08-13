import { z } from 'zod';

export const DEVELOPMENT_JWT_SECRET = 'local-development-secret-change-me-123456';

const configInputSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  JWT_SECRET: z.string().min(32).optional()
});

export interface AppConfig {
  NODE_ENV: 'development' | 'test' | 'production';
  HOST: string;
  PORT: number;
  JWT_SECRET: string;
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const config = configInputSchema.parse(env);
  if (
    config.NODE_ENV === 'production' &&
    (!config.JWT_SECRET || config.JWT_SECRET === DEVELOPMENT_JWT_SECRET)
  ) {
    throw new Error('Production requires an explicit non-development JWT_SECRET');
  }
  return { ...config, JWT_SECRET: config.JWT_SECRET ?? DEVELOPMENT_JWT_SECRET };
};
