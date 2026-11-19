import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SolvForge MD — QM → GROMACS Bridge",
  description: "Local-first, force-field-agnostic QM-to-GROMACS topology, packing, and simulation input preparation bridge.",
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
