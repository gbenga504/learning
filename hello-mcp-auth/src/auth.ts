// Bearer-token authentication for the MCP server.
//
// This is the whole "auth" story in one file:
//   1. Pull the token out of the `Authorization: Bearer <token>` header.
//   2. Verify the JWT: signature, issuer, audience, and expiry.
//   3. On success, attach the caller's identity to the request.
//   4. On failure, return 401 with a WWW-Authenticate header.
//
// Note what is NOT here: any database, session table, or stored state. The token
// is self-contained, so verification is a pure function of (token, secret). That
// is exactly why JWT is the "stateless" option.

import type { NextFunction, Request, Response } from "express";
import { errors, jwtVerify, type JWTPayload } from "jose";
import { JWT_AUDIENCE, JWT_ISSUER, JWT_SECRET_BYTES } from "./config.js";

// The identity we hand to the rest of the app once a token checks out.
export interface AuthInfo {
  subject: string; // the "sub" claim: who the token represents
  name?: string; // a friendly display name we put in the token
  scopes: string[]; // the "scope" claim, split into a list: what they may do
  claims: JWTPayload; // the full decoded payload, for inspection
}

// We attach the verified identity to req.mcpAuth so the route handler can read
// it. We deliberately do NOT use req.auth: the MCP SDK reserves that name for its
// own auth type, so we keep ours separate to avoid any collision.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      mcpAuth?: AuthInfo;
    }
  }
}

// Verify a raw token string. Returns the identity, or throws on any problem.
// jose checks the signature AND the exp/nbf claims for us, and the options below
// add issuer + audience checks (so a token minted for a different service is
// rejected even if the signature is valid).
export async function verifyToken(token: string): Promise<AuthInfo> {
  const { payload } = await jwtVerify(token, JWT_SECRET_BYTES, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });

  const scope = typeof payload.scope === "string" ? payload.scope : "";
  return {
    subject: payload.sub ?? "unknown",
    name: typeof payload.name === "string" ? payload.name : undefined,
    scopes: scope.split(" ").filter(Boolean),
    claims: payload,
  };
}

// Express middleware. Put this in front of any route that needs a valid token.
export async function requireBearerToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;

  // 1. There must be an Authorization header in the "Bearer <token>" form.
  if (!header?.startsWith("Bearer ")) {
    sendUnauthorized(
      res,
      "missing_token",
      "Provide an 'Authorization: Bearer <token>' header.",
    );
    return;
  }

  const token = header.slice("Bearer ".length).trim();

  try {
    // 2. Verify it. If this resolves, the caller is authenticated.
    req.mcpAuth = await verifyToken(token);
    console.log(
      `[auth] OK   sub=${req.mcpAuth.subject} scopes=[${req.mcpAuth.scopes.join(",")}]`,
    );
    next();
  } catch (err) {
    // 3. Turn jose's specific errors into a clear 401. We deliberately keep the
    //    message generic to the client but log the real reason for the developer.
    const reason =
      err instanceof errors.JWTExpired
        ? "token expired"
        : err instanceof errors.JWTClaimValidationFailed
          ? `claim check failed (${err.claim})`
          : err instanceof errors.JWSSignatureVerificationFailed
            ? "bad signature"
            : "invalid token";
    console.log(`[auth] FAIL ${reason}`);
    sendUnauthorized(
      res,
      "invalid_token",
      "The bearer token is missing, expired, or invalid.",
    );
  }
}

// A 401 with WWW-Authenticate is the standard way an HTTP API says "authenticate
// and try again". OAuth clients read this header to know how to recover.
function sendUnauthorized(
  res: Response,
  error: string,
  description: string,
): void {
  res
    .status(401)
    .set(
      "WWW-Authenticate",
      `Bearer error="${error}", error_description="${description}"`,
    )
    .json({ error, error_description: description });
}
