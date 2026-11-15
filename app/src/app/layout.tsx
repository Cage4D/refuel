import type { Metadata, Viewport } from "next";
import { Geist, Iceland } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], weight: ["400", "500"] });
const iceland = Iceland({ weight: "400", subsets: ["latin"], variable: "--font-iceland", display: "swap" });

export const metadata: Metadata = {
  title: "Refuel: BTC gas for MUSD holders on Mezo",
  description: "Got MUSD but no BTC for gas? Sign once, with no gas needed, and get enough BTC to use Mezo.",
};

export const viewport: Viewport = { themeColor: "#000000", colorScheme: "dark" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${iceland.variable}`} style={{ colorScheme: "dark" }}>
      <body>{children}</body>
    </html>
  );
}
