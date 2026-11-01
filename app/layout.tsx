import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import "./globals.css";

const sans = Atkinson_Hyperlegible({
  variable: "--font-sans-face",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "LabelLens",
  description: "Photograph a food ingredient label and get plain-language, research-backed insights.",
  appleWebApp: { capable: true, title: "LabelLens", statusBarStyle: "default" },
  icons: { apple: "/pwa-icon/180" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f2" },
    { media: "(prefers-color-scheme: dark)", color: "#121514" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} antialiased`}>
        <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
          <main className="flex-1 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4">{children}</main>
          <footer className="border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-xs leading-snug text-muted">
            Educational information, not medical advice. Talk to a qualified healthcare professional
            about your health decisions.
          </footer>
        </div>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
