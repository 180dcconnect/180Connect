import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono, Lato, Source_Serif_4 } from "next/font/google";
import { StagingBanner } from "@/components/staging-banner";
import { AccessibilityProvider } from "@/components/accessibility-provider";
import { accessibilityAttributes, readAccessibilityCookies } from "@/lib/accessibility";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Lato is the body font (`--font-body`), so it loads on every page — and unlike
 * the other three here it is not a variable font, so every weight and style
 * listed is a separate file fetched up front.
 *
 * 300 was dropped because nothing uses it: `font-light` appears nowhere in
 * `src/`. The rest are all reachable — `font-bold`/`font-semibold` in ~1,500
 * places, `font-black`/`font-extrabold` in ~60, and the italic faces are needed
 * for the `<em>` a CAM can type into an outreach email body via the rich-text
 * editor. Six faces instead of eight.
 */
const lato = Lato({
  variable: "--font-lato",
  weight: ["400", "700", "900"],
  style: ["normal", "italic"],
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
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
  const accessibility = readAccessibilityCookies((name) => cookieStore.get(name)?.value);

  return (
    <html
      lang="en"
      {...accessibilityAttributes(accessibility)}
      className={`${geistSans.variable} ${geistMono.variable} ${lato.variable} ${sourceSerif.variable} h-full antialiased`}
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
