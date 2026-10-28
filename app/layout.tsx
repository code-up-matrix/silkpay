import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
export const metadata: Metadata = {
  title: "SilkPay — US ⇄ Asia Trade Settlement",
  description:
    "Clear milestones. Verified evidence. Confident trade. Cross-border manufacturing payments with PayPal Sandbox and AI evidence review.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
