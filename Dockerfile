FROM node:20-alpine

# Install ALL Ollama dependencies
RUN apk add --no-cache \
    curl \
    bash \
    zstd \
    libc6-compat

# Install Ollama
RUN curl -fsSL https://ollama.ai/install.sh | sh

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

# Expose Render port
EXPOSE $PORT
ENV PORT=10000

# Start Ollama + Node
CMD sh -c "ollama serve & npm start"