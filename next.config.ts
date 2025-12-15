import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  // Performance optimizations
  compress: true,
  productionBrowserSourceMaps: false,
  
  // Experimental features
  experimental: {
    optimizePackageImports: ["recharts", "lucide-react", "date-fns"],
  },
  
  // Image optimization
  images: {
    formats: ["image/avif", "image/webp"],
  },};

export default nextConfig;