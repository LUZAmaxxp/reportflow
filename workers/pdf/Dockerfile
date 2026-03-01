FROM node:20-slim

# Install Chromium and runtime dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer environment
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app

# Install all dependencies (including devDeps for tsx)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy worker and lib modules
COPY workers/pdf ./workers/pdf
COPY src/lib ./src/lib

# Expose internal port 3003
# Docker maps host 3001:3003 per docker-compose, so PDF_WORKER_URL=http://localhost:3001
# is correct for callers outside the container
EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:3003/ || exit 1

CMD ["npx", "tsx", "--max-old-space-size=512", "workers/pdf/index.ts"]
