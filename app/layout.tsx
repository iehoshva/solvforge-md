import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SolvForge MD",
  description: "Local-first molecular simulation preparation, GROMACS planning, and Kirkwood–Buff analysis for reproducible solvent research.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="codex-preview" content="development" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
