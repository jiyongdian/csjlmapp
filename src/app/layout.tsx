import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ErrorBoundary from "@/components/ErrorBoundary";
import AgentPanelProvider from "@/components/AgentPanelProvider";
import SiteSettingsProvider from "@/components/SiteSettingsProvider";
import { getSystemSettings } from "@/lib/system-settings";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  let title = "创世纪联盟智能写作";
  try {
    const settings = await getSystemSettings();
    if (settings.websiteTitle) title = settings.websiteTitle;
  } catch {
    // 读取失败时使用默认标题
  }
  return {
    title,
    description: title + " - AI 驱动的智能写作工具，支持自动生成主题、结构分析和章节内容",
    other: { google: "notranslate" },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning translate="no">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased notranslate`}
      >
        <ErrorBoundary>
          <SiteSettingsProvider>
            <AgentPanelProvider>{children}</AgentPanelProvider>
          </SiteSettingsProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
