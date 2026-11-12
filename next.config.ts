import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';
import path from 'node:path';
import { bookingHeaderRules } from './src/app/b/booking-security-headers';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  output: 'standalone',
  // BOOK-001 R7: no caching, no Referer, no indexing for tokenized booking links.
  async headers() {
    return bookingHeaderRules();
  },
};

export default withNextIntl(nextConfig);
