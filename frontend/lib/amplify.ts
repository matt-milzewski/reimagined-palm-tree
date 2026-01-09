import { Amplify } from 'aws-amplify';

const userPoolId = process.env.NEXT_PUBLIC_USER_POOL_ID || '';
const userPoolClientId = process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID || '';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId,
      userPoolClientId
    }
  }
});
