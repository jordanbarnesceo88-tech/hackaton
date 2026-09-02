import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

// The UI is Russian, so the Cyrillic subset is the one that actually matters — with "latin"
// alone every Cyrillic glyph fell back to a system font and the brand typography reached
// almost nothing on screen. "latin" stays for the figures, US$/₽ and the Latin product names.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["cyrillic", "latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["cyrillic", "latin"],
});

export const metadata: Metadata = {
  title: "Платформа оценки роботизации",
  description:
    "Подбор роботизированных решений и расчёт экономического эффекта для вашего объекта",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
