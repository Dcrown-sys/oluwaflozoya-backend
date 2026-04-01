FROM node:20-alpine

# Install Ollama + dependencies
RUN apk add --no-cache \
    curl \
    bash \
    zstd \
    libc6-compat

# Download + install Ollama
RUN curl -fsSL https://ollama.ai/install.sh | sh

# App directory
WORKDIR /app

# Copy package files FIRST (npm cache)
COPY package*.json ./

# Install Node dependencies
RUN npm ci --only=production

# Copy ALL files (including .env!)
COPY . .

# Create uploads dir
RUN mkdir -p uploads

# Expose Render port
EXPOSE $PORT
ENV PORT=10000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:$PORT/ || exit 1

# Start Ollama + Node
CMD sh -c "ollama serve & npm start"