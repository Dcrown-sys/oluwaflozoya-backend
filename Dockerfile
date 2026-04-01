FROM node:20-slim  # ✅ Debian (not Alpine) = Ollama compatible

# Install Ollama deps
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install Ollama
RUN curl -fsSL https://ollama.ai/install.sh | sh

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

RUN mkdir -p uploads

EXPOSE $PORT
ENV PORT=10000

CMD sh -c "ollama serve & npm start"