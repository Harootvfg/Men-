/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg", "@anthropic-ai/sdk"],
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
