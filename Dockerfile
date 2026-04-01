FROM node:20-slim

# Install Ollama dependencies
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    zstd \          ← ADD THIS LINE
    && rm -rf /var/lib/apt/lists/*

# Install Ollama
RUN curl -fsSL https://ollama.ai/install.sh | sh

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

RUN mkdir -p uploads

EXPOSE 10000
ENV PORT=10000

CMD sh -c "ollama serve & npm start"