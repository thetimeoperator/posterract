/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import solidSvg from 'vite-plugin-solid-svg'
import tailwindcss from '@tailwindcss/vite'
import typegpu from 'unplugin-typegpu/vite'
import { resolve } from 'path'
import pkg from '../../package.json'

export default defineConfig(({ command }) => {
  return {
    base: command === 'build' ? '/editor-sandbox/' : '/',
    plugins: [
      solid(),
      tailwindcss(),
      solidSvg({ defaultAsComponent: true }),
      typegpu(),
    ],
    define: {
      APP_VERSION: JSON.stringify(pkg.version),
    },
    server: {
      port: 5175,
      strictPort: true,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    resolve: {
      // The editor runtime, reconciler and Koota traits must share one module
      // identity. Pre-bundling linked workspace packages independently can
      // duplicate those singletons and leave derived render stores detached
      // from the world that owns the canvas.
      dedupe: ['solid-js', 'koota'],
      alias: {
        "@": resolve(__dirname, "./src"),
        "@desktop": resolve(__dirname, "./src/bridge"),
      }
    },
    optimizeDeps: {
      exclude: [
        'koota',
        '@posterract/video-assets',
        '@posterract/video-encoder',
        '@posterract/composition',
        '@posterract/koota-solid',
        '@posterract/video-reconciler',
        '@posterract/video-runtime',
      ],
    },
  }
})
