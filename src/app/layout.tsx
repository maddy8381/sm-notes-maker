import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { ThemeProvider } from "@/components/layout/theme-provider";
import { ThemeScript } from "@/components/layout/theme-script";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "SM Notes Maker",
    template: "%s · SM Notes Maker",
  },
  description: "A personal knowledge base for engineering notes.",
  // Private notes should never show up in a search index, whatever the
  // deployment URL ends up being.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#101216" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning because ThemeScript adds a class to <html>
    // before React hydrates — which is precisely what prevents the white flash
    // on a dark-mode reload, and would otherwise be reported as a mismatch.
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className={`${sans.variable} ${mono.variable} antialiased`}>
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
