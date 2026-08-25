import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    browser: 'src/browser.ts',
    server: 'src/server.ts',
  },
  format: 'esm',
  dts: true,
  clean: true,
  external: (id) => /^[^./]/.test(id) || id.includes('/node_modules/'),
  outExtensions: () => ({ js: '.js' }),
});
