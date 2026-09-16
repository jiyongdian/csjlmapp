"use client";

import AISettingsPanel from "@/components/AISettingsPanel";

/**
 * AI 设置页面。
 * 内容与「导航 → AI 设置」弹窗共用同一个面板组件，保证两处行为一致。
 */
export default function AISettingsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 p-4 md:p-8">
      <AISettingsPanel />
    </div>
  );
}
