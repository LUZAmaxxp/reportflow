import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

/**
 * Edge-safe auth config — no Node.js-only imports (bcrypt, drizzle, pg).
 * The `authorize` callback is defined in auth.ts which runs in Node.js.
 */
export const authConfig = {
  session: { strategy: "jwt", maxAge: 60 * 60 },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id as string;
        token.company_id = (user as unknown as { company_id: string }).company_id;
        token.role = (user as unknown as { role: "admin" | "editor" | "viewer" }).role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        ...session.user,
        user_id: token.sub as string,
        company_id: token.company_id as string,
        role: token.role as "admin" | "editor" | "viewer",
      } as any;
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnLogin = nextUrl.pathname.startsWith("/login");
      const isApiRoute = nextUrl.pathname.startsWith("/api/");
      if (isOnLogin) return true;
      if (!isLoggedIn && isApiRoute) {
        // Return 401 JSON for API routes instead of redirecting to login
        return Response.json(
          { code: "unauthorized", message: "Authentication required" },
          { status: 401 }
        );
      }
      return isLoggedIn;
    },
  },
  pages: {
    signIn: "/login",
  },
} satisfies NextAuthConfig;
