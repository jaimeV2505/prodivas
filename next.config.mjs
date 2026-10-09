/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
