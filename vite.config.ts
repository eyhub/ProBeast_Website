import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Scene hot-reload. Watches the runtime GLB/GLTF under public/models and, when it changes
 * (i.e. you re-export from Blender straight into that folder), refetches it fresh and triggers
 * a full page reload. The app snaps back to whatever camera the URL is on, so you keep your view.
 *   Blender: File > Export > glTF Binary  →  <repo>/public/models/test-garage-2.glb
 */
function sceneHotReload(): Plugin {
  const isModel = (p: string) => {
    const n = p.replace(/\\/g, '/');
    return n.includes('/public/models/') && (n.endsWith('.glb') || n.endsWith('.gltf'));
  };
  return {
    name: 'scene-hot-reload',
    apply: 'serve',
    configureServer(server) {
      // Never let the browser cache the model in dev, so a reload always pulls the new export.
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (url.startsWith('/models/') && (url.endsWith('.glb') || url.endsWith('.gltf'))) {
          res.setHeader('Cache-Control', 'no-store');
        }
        next();
      });
      server.watcher.add(path.resolve(import.meta.dirname, 'public/models'));
      const reload = (file: string) => {
        if (!isModel(file)) return;
        server.ws.send({ type: 'full-reload', path: '*' });
        server.config.logger.info(
          `\x1b[36m[scene]\x1b[0m ${path.basename(file)} changed — reimporting`,
          { timestamp: true },
        );
      };
      server.watcher.on('change', reload);
      server.watcher.on('add', reload);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), sceneHotReload()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    host: true,
    open: false,
  },
});
