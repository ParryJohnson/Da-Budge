import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/Providers";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Da Budge",
  description: "Track expenses, budget, and net worth",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Da Budge",
  },
  icons: {
    icon: { url: "/favicon.svg", type: "image/svg+xml" },
    apple: "/icons/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-charcoal">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
