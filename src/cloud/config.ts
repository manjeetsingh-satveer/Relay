/**
 * Public client ID of Relay's GitHub OAuth App (device flow enabled). Client IDs are not secrets;
 * the app never ships a client secret. Override with RELAY_GITHUB_CLIENT_ID for forks/testing.
 */
export const GITHUB_CLIENT_ID = process.env.RELAY_GITHUB_CLIENT_ID || "Ov23liEwpLJAwTHAKfKq";
