import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Provider Tracker",
  description: "URA provider calls, availability, and follow-up",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body>{children}</body>
    </html>
  );
}
