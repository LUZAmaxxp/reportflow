import "next-auth";
import "next-auth/jwt";

export type JwtClaims = { user_id: string; company_id: string; role: 'admin' | 'editor' | 'viewer' };

declare module "next-auth" {
  interface Session {
    user: {
      user_id: string;
      company_id: string;
      role: "admin" | "editor" | "viewer";
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    company_id: string;
    role: "admin" | "editor" | "viewer";
  }
}
