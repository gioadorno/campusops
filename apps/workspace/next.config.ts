import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  agentRules: false,
  logging: { incomingRequests: false },
  experimental: { externalDir: true, useTypeScriptCli: false }
};

export default config;
