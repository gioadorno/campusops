export function validateOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[]
): void {
  if (origin === undefined) return;
  if (!allowedOrigins.includes(origin)) throw new OriginRejectedError();
}

export class OriginRejectedError extends Error {
  constructor() {
    super('Origin is not allowed');
    this.name = 'OriginRejectedError';
  }
}
