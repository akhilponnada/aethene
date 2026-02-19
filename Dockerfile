# Production Dockerfile for Aethene API
FROM node:20-alpine

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy source files
COPY tsconfig.json ./
COPY src ./src

# Install TypeScript for build (then remove to keep image small)
RUN npm install typescript && \
    npm run build && \
    npm remove typescript

# Set production environment
ENV NODE_ENV=production

# Expose API port
EXPOSE 3006

# Run the server
CMD ["node", "dist/server.js"]
