import type { Metadata } from "next";
import { getUiPreferences } from '@/server/ui-preferences';
import "./globals.css";

export const metadata: Metadata = {
  title: "Provider Tracker",
  description: "URA provider calls, availability, and follow-up",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const preferences = await getUiPreferences();
  return (
    <html lang="en" className="h-full" data-theme={preferences.theme}>
      <body>{children}</body>
    </html>
  );
}
