import { createDynamoDocumentClient, type AwsRuntimeConfig } from '@campusops/aws';
import type { Dependencies } from '../application.js';
import { InMemoryPolicyRepository, StaticPlatformCapabilitiesProvider } from '../repositories.js';
import { DynamoDbAuditSink } from './audit.js';
import { DynamoDbServiceRepository, DynamoDbSupportRequestRepository } from './repositories.js';

export const createAwsDependencies = (config: AwsRuntimeConfig): Dependencies => {
  const client = createDynamoDocumentClient(config.AWS_REGION);
  return {
    policies: new InMemoryPolicyRepository(),
    services: new DynamoDbServiceRepository(client, config.CAMPUSOPS_TABLE_NAME),
    support: new DynamoDbSupportRequestRepository(
      client,
      config.CAMPUSOPS_TABLE_NAME,
      config.IDEMPOTENCY_TTL_SECONDS
    ),
    capabilities: new StaticPlatformCapabilitiesProvider(),
    audit: new DynamoDbAuditSink(client, config.CAMPUSOPS_AUDIT_TABLE_NAME, config.ENVIRONMENT)
  };
};
