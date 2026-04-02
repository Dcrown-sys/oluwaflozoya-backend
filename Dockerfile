FROM node:20-slim

RUN apt-get update && apt-get install -y \
    curl wget zstd ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Clean install
RUN curl -fsSL https://ollama.ai/install.sh | sh

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

# 🔥 DELETE CORRUPTED MODELS + FRESH PULL
RUN rm -rf /root/.ollama/models/* && \
    ollama serve & sleep 10 && \
    ollama pull gemma3 && \
    pkill ollama

RUN mkdir -p uploads

EXPOSE 10000
CMD sh -c "ollama serve & npm start"