import { Amplify } from 'aws-amplify';

const region = process.env.NEXT_PUBLIC_REGION || '';
const userPoolId = process.env.NEXT_PUBLIC_USER_POOL_ID || '';
const userPoolWebClientId = process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID || '';

Amplify.configure({
  Auth: {
    region,
    userPoolId,
    userPoolWebClientId,
    authenticationFlowType: 'USER_PASSWORD_AUTH'
  }
});
