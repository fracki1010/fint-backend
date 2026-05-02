FROM node:20-slim

# Chromium + dependencias necesarias para whatsapp-web.js / puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    fonts-noto-color-emoji \
    fonts-liberation \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Usar el Chromium del sistema en lugar de descargar uno extra
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p temp

CMD ["node", "server.js"]
