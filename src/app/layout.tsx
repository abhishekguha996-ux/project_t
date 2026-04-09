import type { Metadata } from "next";

import "@/app/globals.css";

import { AppProviders } from "@/providers/app-providers";

export const metadata: Metadata = {
  title: "QCare Foundation",
  description: "Phase 1 foundation workspace for QCare."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
