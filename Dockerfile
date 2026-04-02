FROM node:20-slim
RUN apt-get update && apt-get install -y curl zstd && \
    curl -fsSL https://ollama.ai/install.sh | sh
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 10000
CMD sh -c "ollama serve & npm start"