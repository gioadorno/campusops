import { execFile, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const terraformDirectory = resolve(repositoryRoot, 'infrastructure/environments/dev');

type TerraformOutputs = Record<string, { value?: unknown }>;

const output = (values: TerraformOutputs, name: string): string => {
  const value = values[name]?.value;
  if (typeof value !== 'string' || !value) throw new Error(`Terraform output ${name} is missing`);
  return value;
};

const profile = process.env.AWS_PROFILE ?? 'campusops-terraform';
const region = process.env.AWS_REGION ?? 'us-west-2';
const environment = { ...process.env, AWS_PROFILE: profile, AWS_REGION: region };
const { stdout } = await execute('terraform', ['output', '-json'], {
  cwd: terraformDirectory,
  env: environment,
  maxBuffer: 1024 * 1024
});
const values = JSON.parse(stdout) as TerraformOutputs;

const child = spawn('pnpm', ['--filter', '@campusops/workspace', 'dev'], {
  cwd: repositoryRoot,
  env: {
    ...environment,
    WORKSPACE_BASE_URL: 'http://localhost:3000',
    COGNITO_USER_POOL_ID: output(values, 'cognito_user_pool_id'),
    COGNITO_CLIENT_ID: output(values, 'cognito_client_id'),
    COGNITO_DOMAIN: output(values, 'cognito_domain'),
    MCP_ENDPOINT: output(values, 'mcp_endpoint'),
    BEDROCK_MODEL_ID: process.env.BEDROCK_MODEL_ID ?? 'amazon.nova-lite-v1:0'
  },
  stdio: 'inherit'
});

const exitCode = await new Promise<number>((resolveExit, reject) => {
  child.once('error', reject);
  child.once('exit', (code) => resolveExit(code ?? 1));
});
process.exitCode = exitCode;
