import type { Metadata, Viewport } from "next";
import { Public_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { SiteFooter } from "@/components/SiteFooter";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

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
  metadataBase: new URL(SITE_URL),
  title: "HealthFlow | Duty rosters for Ghana's health facilities",
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["duty roster Ghana", "hospital duty roster software", "nurses roster", "Ghana Health Service roster", "CHAG facilities", "health facility staff scheduling", "Labour Act compliance roster", "HealthFlow"],
  authors: [{ name: "PS Tech", url: SITE_URL }],
  creator: "PS Tech",
  alternates: { canonical: "./" },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_GH", url: SITE_URL, title: "HealthFlow | Duty rosters for Ghana's health facilities", description: SITE_DESCRIPTION, images: [{ url: "/logo.png", width: 512, height: 512, alt: "HealthFlow" }] },
  twitter: { card: "summary", title: "HealthFlow | Duty rosters for Ghana's health facilities", description: SITE_DESCRIPTION, images: ["/logo.png"] },
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
