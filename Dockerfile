FROM node:20-slim

# Install Ollama dependencies
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    zstd \
    && rm -rf /var/lib/apt/lists/*

# Install Ollama
RUN curl -fsSL https://ollama.ai/install.sh | sh

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

RUN mkdir -p uploads

# ✅ PRE-PULL MODELS (faster startup!)
RUN ollama serve & sleep 15 \
  && ollama pull llama3.1:8b \
  && ollama pull gemma3

EXPOSE 10000
ENV PORT=10000

CMD sh -c "ollama serve & npm start"