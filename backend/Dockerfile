# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (separate layer for caching)
COPY package.json package-lock.json* ./
RUN npm install

# Copy source and compile TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Prune dev dependencies
RUN npm prune --omit=dev

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Security: run as non-root
RUN addgroup -S cbc && adduser -S cbc -G cbc

WORKDIR /app

# Copy compiled output + production node_modules only
COPY --from=builder /app/dist       ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# knexfile needed for migration step
COPY knexfile.js ./

# Create log directory with correct permissions
RUN mkdir -p logs && chown -R cbc:cbc /app

USER cbc

# Railway sets $PORT; default to 5000
ENV PORT=5000
ENV NODE_ENV=production

EXPOSE $PORT

# Run migrations then start server
# NOTE: split into two commands so Railway health check starts after migrations
CMD ["sh", "-c", "node -e \"require('./dist/database/migrate').run()\" && node dist/index.js"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:$PORT/health || exit 1
