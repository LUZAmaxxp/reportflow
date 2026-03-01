import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

/**
 * Edge-safe middleware — only runs the Auth.js authorized callback.
 * Rate limiting is applied at the API-route level via withRateLimit().
 */
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|login).*)"],
};
