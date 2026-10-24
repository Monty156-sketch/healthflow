import type { Metadata, Viewport } from "next";
import { Public_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { SiteFooter } from "@/components/SiteFooter";

const publicSans = Public_Sans({
  variable: "--font-public",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "HealthFlow",
  description:
    "HealthFlow builds your monthly staff roster from your own shifts and rules, checks it against Ghana's Labour Act before it is published, and prints the A4 sheet your staff already recognise.",
};

export const viewport: Viewport = { themeColor: "#0a2f2c", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>{children}</AuthProvider>
        <SiteFooter />
      </body>
    </html>
  );
}
