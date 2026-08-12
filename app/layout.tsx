import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "12-Week Hypertrophy Training System",
  description:
    "An offline-ready, autoregulated 12-week strength and hypertrophy training system.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/training-app/favicon.svg",
    shortcut: "/training-app/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
