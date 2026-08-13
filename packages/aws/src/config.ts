import { z } from 'zod';

const schema = z.object({
  CAMPUSOPS_RUNTIME: z.literal('aws'),
  AWS_REGION: z.string().min(1),
  CAMPUSOPS_TABLE_NAME: z.string().min(3),
  CAMPUSOPS_AUDIT_TABLE_NAME: z.string().min(3),
  COGNITO_USER_POOL_ID: z.string().min(1),
  COGNITO_CLIENT_ID: z.string().min(1),
  ALLOWED_ORIGINS: z
    .string()
    .min(1)
    .transform((value, context) => {
      const origins = value.split(',').map((origin) => origin.trim());
      if (origins.some((origin) => origin === '*' || !URL.canParse(origin))) {
        context.addIssue({ code: 'custom', message: 'ALLOWED_ORIGINS must be valid and never *' });
        return z.NEVER;
      }
      return origins;
    }),
  ENVIRONMENT: z.string().min(1),
  IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().default(86400)
});

export type AwsRuntimeConfig = z.infer<typeof schema>;
export const loadAwsRuntimeConfig = (env: NodeJS.ProcessEnv = process.env): AwsRuntimeConfig =>
  schema.parse(env);
