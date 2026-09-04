import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db/client";
import {
  verifyPassword,
  decoyHash,
  hashPassword,
  needsRehash,
  holdUntilFloor,
} from "@/lib/auth/password";
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
        const startedAt = Date.now();
        const email = String(creds?.email ?? "").toLowerCase().trim();
        const password = String(creds?.password ?? "");
        // Every rejection leaves through here, so they all cost the same wall-clock time.
        const reject = async () => {
          await holdUntilFloor(startedAt);
          return null;
        };
        // Not padded, and deliberately so: this returns before any account lookup, so it
        // carries no enumeration signal — and it sits ahead of the rate limiter, so padding it
        // would let blank-password requests each hold a slot for the floor without ever being
        // counted. Same reasoning as the throttled path below.
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
        // Deliberately NOT padded: the limiter exists to shed load cheaply during a stuffing
        // burst, and holding every blocked attempt open for the floor would hand an attacker
        // 400 ms of server concurrency per request. It leaks nothing either — the throttle fires
        // on the request count for that key, which is identical whether or not the account
        // exists, so the timing of a throttled response says nothing about the address.
        if (!perAccount.ok || !perIp.ok) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        // Always run a comparison, even when the account does not exist, so a miss does real
        // work rather than returning immediately. The decoy equalises the two paths only while
        // every stored hash shares its cost, which is not true here — see MIN_REJECTED_LOGIN_MS.
        // The floor in `reject()` is what actually makes the outcomes indistinguishable.
        const ok = user
          ? await verifyPassword(password, user.passwordHash)
          : await verifyPassword(password, await decoyHash());
        if (!user || !ok) return reject();

        // Upgrade-on-verify: migrate legacy hashes to the current cost as their owners sign in.
        // This is housekeeping, not the timing fix — it only runs on a SUCCESSFUL login, whereas
        // the enumeration probe uses a wrong password and never reaches here. Mistaking it for
        // the fix is exactly how the 2.8x gap survived the first attempt.
        // A failure must never block a valid login, so it is logged and swallowed.
        if (needsRehash(user.passwordHash)) {
          try {
            await prisma.user.update({
              where: { id: user.id },
              data: { passwordHash: await hashPassword(password) },
            });
          } catch (e) {
            console.error("authorize: password rehash failed", e);
          }
        }
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
