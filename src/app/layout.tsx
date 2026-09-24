import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/app/components/app-shell";

import "./globals.css";

export const metadata: Metadata = {
  title: "Koya Talent · Lead research",
  description: "Evidence-backed lead research and outreach drafts for founders",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body><AppShell>{children}</AppShell></body></html>;
}
