import type { Metadata } from "next";
import { Unbounded, Inter, JetBrains_Mono } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

// The UI is Russian, so the Cyrillic subset is the one that actually matters — with "latin"
// alone every Cyrillic glyph fell back to a system font and the brand typography reached
// almost nothing on screen. "latin" stays for the figures, US$/₽ and the Latin product names.
// Заголовки. Unbounded — гарнитура дизайн-референса (BCB), с полноценной кириллицей.
const display = Unbounded({
  variable: "--font-display",
  subsets: ["cyrillic", "latin"],
  weight: ["500", "600", "700"],
});

// Текст и интерфейс. Inter — гарнитура референса; табличные цифры есть (tnum), поэтому колонки
// денежных сумм не «дышат» при пересчёте.
const body = Inter({
  variable: "--font-body",
  subsets: ["cyrillic", "latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = JetBrains_Mono({
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
      className={`${display.variable} ${body.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
