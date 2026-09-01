import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db/client";
import { verifyPassword } from "@/lib/auth/password";
import { rateLimit, clientIp } from "@/lib/auth/rate-limit";

// Login throttling, two buckets both enforced per 15-min window:
//  - per (email+IP): 10 — stops single-account password brute force without locking a whole
//    NAT/shared IP out of one account.
//  - per IP: 50 — caps credential-stuffing / password-spray across MANY accounts from one IP
//    (the per-email bucket alone wouldn't, since each email is independent).
const LOGIN_LIMIT = 10;
const LOGIN_IP_LIMIT = 50;
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

        // Throttle credential-stuffing. Over either limit → treat as a failed login (return
        // null), giving no signal that the account exists or that a limit was hit.
        const ip = clientIp(request.headers);
        const perAccount = await rateLimit(`login:${email}:${ip}`, {
          limit: LOGIN_LIMIT,
          windowMs: LOGIN_WINDOW_MS,
        });
        const perIp = await rateLimit(`login:ip:${ip}`, {
          limit: LOGIN_IP_LIMIT,
          windowMs: LOGIN_WINDOW_MS,
        });
        if (!perAccount.ok || !perIp.ok) return null;

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
