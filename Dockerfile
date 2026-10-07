# Production Dockerfile for Dubber Pro VIP License Server
# Uses Node 22 Alpine for native node:sqlite support and minimal footprint (~150MB)
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data

# Copy package descriptors
COPY package*.json ./

# Install production dependencies (if any)
RUN npm install --omit=dev

# Copy application files
COPY . .

# Ensure data directory exists
RUN mkdir -p /app/data

# Expose HTTP port
EXPOSE 3000

# Declare persistent volume for SQLite database and keys
VOLUME ["/app/data"]

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health || exit 1

# Start the server
CMD ["node", "server.js"]
