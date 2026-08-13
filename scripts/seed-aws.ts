import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDocumentClient, loadAwsRuntimeConfig } from '@campusops/aws';

const config = loadAwsRuntimeConfig();
const client = createDynamoDocumentClient(config.AWS_REGION);
const statuses = [
  {
    serviceId: 'learning-hub',
    name: 'Learning Hub',
    status: 'operational',
    message: 'All fictional systems operational.'
  },
  {
    serviceId: 'campus-wifi',
    name: 'Campus Wi-Fi',
    status: 'degraded',
    message: 'Intermittent connectivity in the fictional West Commons.'
  }
] as const;

for (const status of statuses) {
  try {
    await client.send(
      new PutCommand({
        TableName: config.CAMPUSOPS_TABLE_NAME,
        Item: {
          PK: `SERVICE#${status.serviceId}`,
          SK: 'META',
          entityType: 'ServiceStatus',
          ...status,
          updatedAt: new Date().toISOString()
        },
        ConditionExpression: 'attribute_not_exists(PK)'
      })
    );
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'ConditionalCheckFailedException') throw error;
  }
}
process.stdout.write('Fictional development service statuses seeded.\n');
