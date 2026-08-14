import { z } from 'zod';

const url = z
  .string()
  .url()
  .transform((value) => value.replace(/\/$/, ''));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  AWS_REGION: z.string().min(1).default('us-west-2'),
  WORKSPACE_BASE_URL: url.default('http://localhost:3000'),
  COGNITO_USER_POOL_ID: z.string().min(1),
  COGNITO_CLIENT_ID: z.string().min(1),
  COGNITO_DOMAIN: z.string().min(1),
  MCP_ENDPOINT: url,
  BEDROCK_MODEL_ID: z.string().min(1).default('amazon.nova-lite-v1:0'),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(3600)
});

export type WorkspaceConfig = z.infer<typeof schema> & {
  cognitoIssuer: string;
  cognitoBaseUrl: string;
  callbackUrl: string;
  logoutUrl: string;
  secureCookies: boolean;
};

export const loadWorkspaceConfig = (env: NodeJS.ProcessEnv = process.env): WorkspaceConfig => {
  const parsed = schema.parse(env);
  if (
    parsed.NODE_ENV === 'production' &&
    (!parsed.WORKSPACE_BASE_URL.startsWith('https://') ||
      !parsed.MCP_ENDPOINT.startsWith('https://'))
  ) {
    throw new Error('Production workspace URLs must use HTTPS');
  }
  const cognitoBaseUrl = `https://${parsed.COGNITO_DOMAIN}.auth.${parsed.AWS_REGION}.amazoncognito.com`;
  return {
    ...parsed,
    cognitoIssuer: `https://cognito-idp.${parsed.AWS_REGION}.amazonaws.com/${parsed.COGNITO_USER_POOL_ID}`,
    cognitoBaseUrl,
    callbackUrl: `${parsed.WORKSPACE_BASE_URL}/callback`,
    logoutUrl: parsed.WORKSPACE_BASE_URL,
    secureCookies: parsed.WORKSPACE_BASE_URL.startsWith('https://')
  };
};
