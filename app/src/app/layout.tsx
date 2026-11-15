import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import localFont from "next/font/local";
import "./globals.css";

// Fonts are self-hosted (no build-time fetch from Google Fonts, which broke a Vercel build).
// GeistSans sets --font-geist-sans; Iceland (OFL) is vendored in src/fonts.
const iceland = localFont({
  src: "../fonts/iceland-latin-400-normal.woff2",
  weight: "400",
  variable: "--font-iceland",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Refuel: BTC gas for MUSD holders on Mezo",
  description: "Got MUSD but no BTC for gas? Sign once, with no gas needed, and get enough BTC to use Mezo.",
};

export const viewport: Viewport = { themeColor: "#000000", colorScheme: "dark" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${iceland.variable}`} style={{ colorScheme: "dark" }}>
      <body>{children}</body>
    </html>
  );
}
