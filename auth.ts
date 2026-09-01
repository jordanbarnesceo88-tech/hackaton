import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db/client";
import { verifyPassword } from "@/lib/auth/password";
import { rateLimit, clientIp } from "@/lib/auth/rate-limit";

// Login: 10 attempts per (email+IP) per 15 minutes — throttles credential-stuffing without
// locking a whole IP (NAT/shared) out of every account.
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // Auth.js auto-trusts the host in `next dev` but NOT in the built/production app (`next start`),
  // where it otherwise rejects requests with "UntrustedHost" and auth callbacks fail. Required for
  // self-hosted / Docker deploys (and for the production-mode E2E run). Vercel sets this itself.
  trustHost: true,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (creds, request) => {
        const email = String(creds?.email ?? "").toLowerCase().trim();
        const password = String(creds?.password ?? "");
        if (!email || !password) return null;

        // Throttle credential-stuffing. Over the limit → treat as a failed login (return null),
        // giving no signal that the account exists or that a limit was hit.
        const ip = clientIp(request.headers);
        const limited = await rateLimit(`login:${email}:${ip}`, {
          limit: LOGIN_LIMIT,
          windowMs: LOGIN_WINDOW_MS,
        });
        if (!limited.ok) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;
        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.id && session.user) session.user.id = token.id as string;
      return session;
    },
  },
});
