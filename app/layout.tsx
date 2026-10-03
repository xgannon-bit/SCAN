import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SCAN — Smart Component Analysis Navigator",
  description: "Local-first AOI engineering analysis workspace",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
