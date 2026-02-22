# Aethene API - Production Dockerfile
# Multi-stage build for optimal image size and security

# =============================================================================
# Stage 1: Build
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src ./src
COPY convex ./convex

# Build TypeScript
RUN npm run build

# =============================================================================
# Stage 2: Production
# =============================================================================
FROM node:20-alpine AS production

WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

# Create non-root user for security
RUN addgroup -g 1001 -S aethene && \
    adduser -S -u 1001 -G aethene aethene

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy Convex functions (needed at runtime)
COPY --from=builder /app/convex ./convex

# Set ownership
RUN chown -R aethene:aethene /app

# Switch to non-root user
USER aethene

# Environment
ENV NODE_ENV=production
ENV PORT=3006

# Expose port
EXPOSE 3006

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3006/health || exit 1

# Start server
CMD ["node", "dist/server.js"]
