import type { Metadata, Viewport } from "next";
import { Attribution, SampleBanner } from "../components/Chrome";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Serendip", template: "%s · Serendip" },
  description: "Films worth watching tonight, outside the loop your platform locked you into.",
  applicationName: "Serendip",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, colorScheme: "dark", themeColor: "#0b0d12" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SampleBanner />
        {children}
        <Attribution />
      </body>
    </html>
  );
}
