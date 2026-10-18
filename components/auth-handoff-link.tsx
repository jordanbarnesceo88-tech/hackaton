"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { guestDraftAuthLink } from "@/lib/projects/guest-draft";

/** The shared server header cannot read route search params. Resolve same-tab auth intent on navigation. */
export function AuthHandoffLink({ href, className, children }: { href: "/login" | "/signup"; className?: string; children: ReactNode }) {
  const router = useRouter();
  return <Link href={href} className={className} onNavigate={event => {
    const target = guestDraftAuthLink(window.location.href, href);
    if (target !== href) { event.preventDefault(); router.push(target); }
  }}>{children}</Link>;
}
