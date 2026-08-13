export class NotFoundError extends Error {
  constructor(entity: string) {
    super(`${entity} not found`);
    this.name = 'NotFoundError';
  }
}

export class OwnershipError extends Error {
  constructor() {
    super('The requested record is not owned by the authenticated user');
    this.name = 'OwnershipError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}
