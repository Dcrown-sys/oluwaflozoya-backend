FROM node:20-slim

RUN apt-get update && apt-get install -y \
    curl wget zstd \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://ollama.ai/install.sh | sh

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

RUN mkdir -p uploads

EXPOSE 10000
CMD sh -c "ollama serve & npm start"