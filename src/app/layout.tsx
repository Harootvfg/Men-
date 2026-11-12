import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = { title: "Viral AI Studio", description: "Autonomes KI-Studio für Kurzvideos" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#faf9f7" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        <Nav />
        <main className="mx-auto max-w-6xl px-4 pt-6 pb-24 sm:px-6 lg:ml-60 lg:px-10 lg:pt-10 lg:pb-12">{children}</main>
      </body>
    </html>
  );
}
