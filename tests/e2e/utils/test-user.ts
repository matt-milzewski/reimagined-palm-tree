import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  AuthFlowType
} from '@aws-sdk/client-cognito-identity-provider';

export interface TestUser {
  email: string;
  password: string;
  idToken?: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface CognitoConfig {
  region: string;
  userPoolId: string;
  clientId: string;
}

/**
 * Authenticate a test user with Cognito and get tokens
 */
export async function authenticateTestUser(
  email: string,
  password: string,
  config: CognitoConfig
): Promise<TestUser> {
  const client = new CognitoIdentityProviderClient({ region: config.region });

  try {
    const response = await client.send(
      new InitiateAuthCommand({
        AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
        ClientId: config.clientId,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password
        }
      })
    );

    if (!response.AuthenticationResult) {
      throw new Error('Authentication failed: No tokens returned');
    }

    return {
      email,
      password,
      idToken: response.AuthenticationResult.IdToken,
      accessToken: response.AuthenticationResult.AccessToken,
      refreshToken: response.AuthenticationResult.RefreshToken
    };
  } catch (error: any) {
    console.error('Authentication error:', error);
    throw new Error(`Failed to authenticate user ${email}: ${error.message}`);
  }
}

/**
 * Extract tenant ID from ID token
 */
export function getTenantIdFromToken(idToken: string): string {
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split('.')[1], 'base64').toString()
    );
    return payload.sub;
  } catch (error) {
    throw new Error('Failed to extract tenant ID from token');
  }
}
