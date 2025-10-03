import type { Metadata } from "next";
import { Inter, Noto_Sans_TC } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const notoSansTC = Noto_Sans_TC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sans-tc",
});

export const metadata: Metadata = {
  title: "Smart Transcript Assistant",
  description: "Upload and analyze school transcripts instantly.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body
        className={`${inter.variable} ${notoSansTC.variable} bg-slate-100 text-slate-900 antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
