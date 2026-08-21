import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono, Lato } from "next/font/google";
import { StagingBanner } from "@/components/staging-banner";
import { AccessibilityProvider } from "@/components/accessibility-provider";
import {
  parseAccessibilitySettings,
  DEFAULT_ACCESSIBILITY_SETTINGS,
  COOKIE_FONT_SIZE,
  COOKIE_CONTRAST,
  COOKIE_LINE_SPACING,
  COOKIE_REDUCED_MOTION,
} from "@/lib/accessibility";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const lato = Lato({
  variable: "--font-lato",
  weight: ["300", "400", "700", "900"],
  style: ["normal", "italic"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "180Connect",
  description: "180Connect",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const parsed = parseAccessibilitySettings({
    fontSize: cookieStore.get(COOKIE_FONT_SIZE)?.value,
    contrast: cookieStore.get(COOKIE_CONTRAST)?.value,
    lineSpacing: cookieStore.get(COOKIE_LINE_SPACING)?.value,
    reducedMotion: cookieStore.get(COOKIE_REDUCED_MOTION)?.value,
  });
  const accessibility = parsed.ok ? parsed.value : DEFAULT_ACCESSIBILITY_SETTINGS;

  return (
    <html
      lang="en"
      data-font-size={accessibility.fontSize !== "normal" ? accessibility.fontSize : undefined}
      data-contrast={accessibility.contrast !== "normal" ? accessibility.contrast : undefined}
      data-line-spacing={accessibility.lineSpacing !== "normal" ? accessibility.lineSpacing : undefined}
      data-reduced-motion={accessibility.reducedMotion !== "normal" ? accessibility.reducedMotion : undefined}
      className={`${geistSans.variable} ${geistMono.variable} ${lato.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AccessibilityProvider initialSettings={accessibility}>
          <StagingBanner />
          {children}
        </AccessibilityProvider>
      </body>
    </html>
  );
}
