import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import { traeBadgePlugin } from 'vite-plugin-trae-solo-badge';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    build: {
      sourcemap: 'hidden',
    },
    server: {
      proxy: {
        '/api/llm': {
          target: env.LLM_API_URL || 'https://ark.cn-beijing.volces.com/api/coding/v3',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/llm/, ''),
        },
        '/api/qveris': {
          target: env.QVERIS_BASE_URL ? env.QVERIS_BASE_URL.replace(/"/g, '') : 'https://qveris.ai/api/v1',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/qveris/, ''),
        }
      }
    },
    define: {
      'process.env.QVERIS_API_KEY': JSON.stringify(env.QVERIS_API_KEY || ''),
      'process.env.QVERIS_BASE_URL': JSON.stringify(env.QVERIS_BASE_URL || ''),
      'process.env.LLM_API_KEY': JSON.stringify(env.LLM_API_KEY || ''),
      'process.env.LLM_API_URL': JSON.stringify(env.LLM_API_URL || ''),
      'process.env.LLM_MODEL': JSON.stringify(env.LLM_MODEL || ''),
    },
    plugins: [
      react({
        babel: {
          plugins: [
            'react-dev-locator',
          ],
        },
      }),
      traeBadgePlugin({
        variant: 'dark',
        position: 'bottom-right',
        prodOnly: true,
        clickable: true,
        clickUrl: 'https://www.trae.ai/solo?showJoin=1',
        autoTheme: true,
        autoThemeTarget: '#root'
      }), 
      tsconfigPaths()
    ],
  };
})
