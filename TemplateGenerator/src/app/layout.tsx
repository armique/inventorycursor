import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { ALL_FONT_VARIABLES } from "@/lib/google-fonts";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/constants";

import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${ALL_FONT_VARIABLES} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
