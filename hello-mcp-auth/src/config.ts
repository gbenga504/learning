// Central place to read configuration. Both the server (which VERIFIES tokens)
// and the mint-token script (which SIGNS tokens) import from here so they always
// agree on the secret, issuer, and audience.

import "dotenv/config"; // loads a local .env file if present; otherwise we use the defaults below.

// In a real OAuth 2.1 setup these defaults would never exist: the secret would
// be a private key held only by the authorization server. We default them here
// so the example runs with zero setup. See the README "How this maps to real
// OAuth 2.1" section for the production-shaped version.
export const JWT_SECRET = process.env.MCP_JWT_SECRET ?? "dev-only-super-secret-change-me";
export const JWT_ISSUER = process.env.MCP_JWT_ISSUER ?? "hello-mcp-auth-dev";
export const JWT_AUDIENCE = process.env.MCP_JWT_AUDIENCE ?? "hello-mcp-auth";
export const PORT = Number(process.env.PORT ?? 8765);

// jose works with the secret as raw bytes, so encode it once here.
export const JWT_SECRET_BYTES = new TextEncoder().encode(JWT_SECRET);
