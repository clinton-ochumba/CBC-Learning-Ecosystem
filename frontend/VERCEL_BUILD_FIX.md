# Vercel Build Fix for Frontend

## Problem
- Vercel build failed due to missing TypeScript (tsc not found)

## Solution
- Add TypeScript as a devDependency in frontend/package.json
- Ensure the build command uses `tsc && vite build`
- Confirm local build works: `npm install && npm run build` in frontend/

## Steps for Vercel
1. Push the updated package.json (with TypeScript in devDependencies)
2. Trigger a new deployment in Vercel
3. If using monorepo, set frontend/ as the root directory in Vercel project settings
4. Ensure environment variables (like VITE_API_BASE_URL) are set in Vercel

## Troubleshooting
- If build fails, check Vercel logs for missing dependencies or misconfigurations
- Confirm vercel.json is correct (buildCommand, outputDirectory, installCommand)
- If using custom domains or rewrites, verify vercel.json rewrites

## Reference
- https://vitejs.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated
- https://vercel.com/docs/concepts/projects/monorepos
