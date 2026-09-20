import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  // Externalize native Node.js packages
  serverExternalPackages: ['sharp'],

  webpack: (config, { isServer }) => {
    // Externalize native modules for server-side only
    if (isServer) {
      config.externals = [
        ...(config.externals || []),
        { canvas: 'canvas' },
      ];
    }

    // Ignore problematic files from node-pre-gyp
    config.module = config.module || {};
    config.module.rules = config.module.rules || [];
    config.module.rules.push({
      test: /node_modules\/@mapbox\/node-pre-gyp\/lib\/util\/nw-pre-gyp\/index\.html$/,
      use: 'null-loader',
    });

    // Ignore all .html and .md files in node_modules
    config.module.rules.push({
      test: /node_modules\/.*\.(html|md)$/,
      use: 'null-loader',
    });

    return config;
  },
};

export default nextConfig;
