import type { APIGatewayProxyEvent } from 'aws-lambda';

type Claims = Record<string, string>;

export type TenantContext = {
  tenantId: string;
  email?: string;
  username?: string;
};

export function getTenantContext(event: APIGatewayProxyEvent): TenantContext {
  const claims = (event.requestContext.authorizer?.claims || {}) as Claims;
  const tenantId = claims.sub || claims['cognito:username'];

  if (!tenantId) {
    throw new Error('Unauthorized: missing tenant id');
  }

  return {
    tenantId,
    email: claims.email,
    username: claims['cognito:username']
  };
}
