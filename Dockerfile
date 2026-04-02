FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Install Ollama
RUN curl -fsSL https://ollama.ai/install.sh | sh

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy app
COPY . .

EXPOSE 10000

# Start everything properly
CMD sh -c "
  echo '🚀 Starting Ollama...'
  ollama serve &

  echo '⏳ Waiting for Ollama to be ready...'
  until curl -s http://127.0.0.1:11434 > /dev/null; do
    sleep 2
  done

  echo '🧹 Cleaning unused models...'
  ollama rm gemma2:9b || true
  ollama rm qwen3:4b || true
  ollama rm llava:13b || true
  ollama rm llava:7b || true

  echo '📦 Current models:'
  ollama list

  echo '🚀 Starting Node server...'
  npm start
"