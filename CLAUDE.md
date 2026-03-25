# Wealth Projector

A browser-based financial planning tool for modelling long-term wealth trajectories. See [README.md](README.md) for full documentation on core concepts, the simulation engine, and the interface.

**Tech stack:** React 19 + Vite, D3.js, Zustand, Tailwind CSS, TypeScript, Vitest
**Hosted at:** restinbed.com/wealth-projector
**Deploy target:** `restinbed.com@linux284.unoeuro.com:~/public_html/wealth-projector/`
**SSH key:** `~/.ssh/id_ed25519`

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

5. **Deploy**
   ```bash
   rsync -av -e "ssh -i ~/.ssh/id_ed25519" dist/ restinbed.com@linux284.unoeuro.com:~/public_html/wealth-projector/
   ```
