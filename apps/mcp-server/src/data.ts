import type { Policy, ServiceStatus, SupportRequest } from '@campusops/contracts';

export const policies: Policy[] = [
  {
    id: 'pol-sec-001',
    title: 'Account Security Standard',
    category: 'security',
    summary: 'Requires phishing-resistant MFA and prohibits credential sharing.',
    body: 'All Northstar Institute accounts must use MFA. Credentials must never be shared. Suspected compromise must be reported to the help center.',
    updatedAt: '2026-06-15T00:00:00.000Z'
  },
  {
    id: 'pol-data-002',
    title: 'Fictional Data Handling Policy',
    category: 'data',
    summary: 'Defines handling expectations for internal, restricted, and public data.',
    body: 'Restricted records must remain in approved systems. Public demonstrations may use synthetic data only.',
    updatedAt: '2026-05-20T00:00:00.000Z'
  },
  {
    id: 'pol-access-003',
    title: 'Accessible Technology Policy',
    category: 'accessibility',
    summary: 'Digital services must meet the institute accessibility baseline.',
    body: 'Service owners must test keyboard access, semantic structure, contrast, and assistive technology compatibility before release.',
    updatedAt: '2026-04-01T00:00:00.000Z'
  }
];

export const services: ServiceStatus[] = [
  {
    serviceId: 'learning-hub',
    name: 'Learning Hub',
    status: 'operational',
    message: 'All systems operational.',
    updatedAt: '2026-08-13T17:00:00.000Z'
  },
  {
    serviceId: 'campus-wifi',
    name: 'Campus Wi-Fi',
    status: 'degraded',
    message: 'Intermittent connectivity in the fictional West Commons.',
    updatedAt: '2026-08-13T17:10:00.000Z'
  }
];

export const initialSupportRequests: SupportRequest[] = [
  {
    id: 'req-alex-001',
    userId: 'user-alex',
    category: 'accounts',
    title: 'MFA device replacement',
    description: 'Need to enroll a replacement security key.',
    severity: 'medium',
    status: 'open',
    createdAt: '2026-08-10T09:00:00.000Z',
    updatedAt: '2026-08-10T09:00:00.000Z'
  },
  {
    id: 'req-blair-001',
    userId: 'user-blair',
    category: 'network',
    title: 'Lab connectivity',
    description: 'A fictional lab device cannot join the test network.',
    severity: 'low',
    status: 'in_progress',
    createdAt: '2026-08-11T10:00:00.000Z',
    updatedAt: '2026-08-12T11:00:00.000Z'
  }
];
