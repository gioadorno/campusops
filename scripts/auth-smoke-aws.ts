import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { EXPECTED_TOOL_COUNT, safeErrorMessage, validateDeployedMcp } from './aws-smoke-lib.js';

const execute = promisify(execFile);
const callbackUrl = 'http://localhost:3000/callback';
const requiredScopes = [
  'campusops/policies.read',
  'campusops/services.read',
  'campusops/requests.read',
  'campusops/requests.write'
] as const;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const terraformDirectory = resolve(repositoryRoot, 'infrastructure/environments/dev');

type TerraformValue = { value: unknown };
type TerraformOutputs = Record<string, TerraformValue>;
type AppClient = {
  AllowedOAuthFlowsUserPoolClient?: boolean;
  AllowedOAuthFlows?: string[];
  AllowedOAuthScopes?: string[];
  CallbackURLs?: string[];
  SupportedIdentityProviders?: string[];
  HasClientSecret?: boolean;
};

export const createPkce = () => {
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};

export const validateAppClient = (client: AppClient): void => {
  if (client.HasClientSecret) throw new Error('Cognito app client unexpectedly has a secret');
  if (!client.AllowedOAuthFlowsUserPoolClient || !client.AllowedOAuthFlows?.includes('code')) {
    throw new Error('Cognito app client does not enable authorization-code flow');
  }
  if (!client.CallbackURLs?.includes(callbackUrl)) {
    throw new Error(`Cognito callback mismatch: expected ${callbackUrl}`);
  }
  if (!client.SupportedIdentityProviders?.includes('COGNITO')) {
    throw new Error('Cognito is not enabled as an identity provider for the app client');
  }
  const missing = requiredScopes.filter((scope) => !client.AllowedOAuthScopes?.includes(scope));
  if (missing.length > 0)
    throw new Error(`Cognito app client is missing scopes: ${missing.join(', ')}`);
};

const outputString = (outputs: TerraformOutputs, key: string): string => {
  const value = outputs[key]?.value;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Terraform output ${key} is missing or malformed`);
  }
  return value;
};

const commandJson = async <T>(command: string, args: string[], environment: NodeJS.ProcessEnv) => {
  try {
    const { stdout } = await execute(command, args, {
      cwd: terraformDirectory,
      env: environment,
      maxBuffer: 1024 * 1024
    });
    return JSON.parse(stdout) as T;
  } catch (error) {
    throw new Error(`${command} configuration check failed: ${safeErrorMessage(error)}`, {
      cause: error
    });
  }
};

const waitForCallback = (expectedState: string): Promise<string> =>
  new Promise((resolveCode, rejectCode) => {
    const timeout = setTimeout(() => {
      server.close();
      rejectCode(new Error('Timed out waiting for Cognito browser authentication'));
    }, 5 * 60_000);
    const finish = (error?: Error, code?: string) => {
      clearTimeout(timeout);
      server.close();
      if (error) rejectCode(error);
      else resolveCode(code as string);
    };
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', callbackUrl);
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      if (url.pathname !== '/callback') {
        response.statusCode = 404;
        response.end('Not found');
        return;
      }
      const oauthError = url.searchParams.get('error');
      if (oauthError) {
        const description = url.searchParams.get('error_description') ?? 'No description';
        response.statusCode = 400;
        response.end('CampusOps authentication failed. Return to the terminal.');
        finish(new Error(`Cognito OAuth error ${oauthError}: ${description}`));
        return;
      }
      if (url.searchParams.get('state') !== expectedState) {
        response.statusCode = 400;
        response.end('Invalid OAuth state. Return to the terminal.');
        finish(new Error('OAuth callback state validation failed'));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        response.statusCode = 400;
        response.end('Authorization code missing. Return to the terminal.');
        finish(new Error('OAuth callback did not contain an authorization code'));
        return;
      }
      response.end('CampusOps authentication succeeded. You may close this tab.');
      finish(undefined, code);
    });
    server.on('error', (error) => {
      clearTimeout(timeout);
      rejectCode(
        new Error(`Could not start callback listener on localhost:3000: ${safeErrorMessage(error)}`)
      );
    });
    server.listen(3000, 'localhost');
  });

const openBrowser = async (authorizationUrl: string): Promise<boolean> => {
  try {
    await execute('xdg-open', [authorizationUrl], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
};

const exchangeCode = async (
  tokenEndpoint: string,
  clientId: string,
  code: string,
  verifier: string
): Promise<string> => {
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: callbackUrl,
      code_verifier: verifier
    })
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const name = typeof payload.error === 'string' ? payload.error : 'unknown_error';
    const description =
      typeof payload.error_description === 'string' ? payload.error_description : 'No description';
    throw new Error(`Token exchange failed (HTTP ${response.status}) ${name}: ${description}`);
  }
  if (typeof payload.access_token !== 'string') {
    throw new Error(`Token exchange succeeded (HTTP ${response.status}) without an access token`);
  }
  return payload.access_token;
};

async function main() {
  const profile = process.env.AWS_PROFILE ?? 'campusops-terraform';
  const region = process.env.AWS_REGION ?? 'us-west-2';
  const environment = { ...process.env, AWS_PROFILE: profile, AWS_REGION: region };
  const outputs = await commandJson<TerraformOutputs>(
    'terraform',
    ['output', '-json'],
    environment
  );
  const endpoint = outputString(outputs, 'mcp_endpoint');
  const userPoolId = outputString(outputs, 'cognito_user_pool_id');
  const clientId = outputString(outputs, 'cognito_client_id');
  const domain = outputString(outputs, 'cognito_domain');

  const appClient = await commandJson<{ UserPoolClient: AppClient }>(
    'aws',
    [
      'cognito-idp',
      'describe-user-pool-client',
      '--user-pool-id',
      userPoolId,
      '--client-id',
      clientId,
      '--query',
      "{UserPoolClient:{AllowedOAuthFlowsUserPoolClient:UserPoolClient.AllowedOAuthFlowsUserPoolClient,AllowedOAuthFlows:UserPoolClient.AllowedOAuthFlows,AllowedOAuthScopes:UserPoolClient.AllowedOAuthScopes,CallbackURLs:UserPoolClient.CallbackURLs,SupportedIdentityProviders:UserPoolClient.SupportedIdentityProviders,HasClientSecret:contains(keys(UserPoolClient), 'ClientSecret')}}",
      '--output',
      'json'
    ],
    environment
  );
  validateAppClient(appClient.UserPoolClient);
  process.stdout.write('Deployed Cognito PKCE client configuration verified.\n');

  const { verifier, challenge } = createPkce();
  const state = randomBytes(32).toString('base64url');
  const cognitoBase = `https://${domain}.auth.${region}.amazoncognito.com`;
  const authorization = new URL('/oauth2/authorize', cognitoBase);
  authorization.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: ['openid', ...requiredScopes].join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  }).toString();

  const callback = waitForCallback(state);
  const opened = await openBrowser(authorization.toString());
  if (opened) process.stdout.write('Opened Cognito managed login in the browser.\n');
  else {
    process.stdout.write('Could not open a browser. Open this URL to authenticate:\n');
    process.stdout.write(`${authorization.toString()}\n`);
  }
  process.stdout.write('Waiting for browser authentication on localhost:3000...\n');

  let code: string | undefined;
  let accessToken: string | undefined;
  try {
    code = await callback;
    process.stdout.write('OAuth callback and state verified; exchanging code securely.\n');
    accessToken = await exchangeCode(`${cognitoBase}/oauth2/token`, clientId, code, verifier);
    await validateDeployedMcp(endpoint, accessToken);
    process.stdout.write(
      `Authenticated AWS MCP smoke test passed: initialization and tools/list returned ${EXPECTED_TOOL_COUNT} tools.\n`
    );
  } finally {
    code = undefined;
    accessToken = undefined;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`Authenticated AWS smoke failed: ${safeErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
