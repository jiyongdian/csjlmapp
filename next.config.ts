import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 类型错误暂不阻断构建（阶段2 将逐目录清零后移除此项）
  typescript: {
    ignoreBuildErrors: true,
  },
  // 生产稳定性与传输优化
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // 按需引入：减小首屏 JS（bundle 体积优化）
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@ant-design/x",
      "@ant-design/x-markdown",
      "framer-motion",
    ],
  },
  async rewrites() {
    return {
      // 媒体目录不在 public 下（如外部磁盘/挂载盘）时，/media/* 回源到内部媒体路由读取
      afterFiles: [{ source: "/media/:path*", destination: "/api/media/:path*" }],
    };
  },
};

export default nextConfig;
