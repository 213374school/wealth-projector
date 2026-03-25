# Wealth Projector

A browser-based financial planning tool for modelling long-term wealth trajectories. See [README.md](README.md) for full documentation on core concepts, the simulation engine, and the interface.

**Tech stack:** React 19 + Vite, D3.js, Zustand, Tailwind CSS, TypeScript, Vitest
**Hosted at:** restinbed.com/wealth-projector
**Deploy target:** Cloudflare Pages (project: `wealth-projector`, account: `a1f070742e19af7f9bdaa29a9c92b667`)

---

## Deployment process

Follow these steps every time you deploy:

1. **Bump the version** in `package.json` (e.g. `0.1` → `0.2`)

2. **Commit the version bump**
   ```bash
   git add package.json
   git commit -m "Bump version to vX.Y"
   ```

3. **Tag the commit**
   ```bash
   git tag vX.Y
   ```

4. **Build**
   ```bash
   npm run build
   ```

5. **Assemble the deploy folder** — combine the landing page and the app:
   ```bash
   mkdir -p /tmp/pages-deploy/wealth-projector
   cp /tmp/restinbed-index.html /tmp/pages-deploy/index.html
   cp -r dist/* /tmp/pages-deploy/wealth-projector/
   ```

   > Note: the landing page lives at `/tmp/restinbed-index.html`. If it has been updated since the last deploy, make sure to re-upload it too.

6. **Deploy to Cloudflare Pages**
   ```bash
   CLOUDFLARE_API_TOKEN=<token> \
   CLOUDFLARE_ACCOUNT_ID=a1f070742e19af7f9bdaa29a9c92b667 \
   npx wrangler@3 pages deploy /tmp/pages-deploy \
     --project-name=wealth-projector \
     --branch=main
   ```
