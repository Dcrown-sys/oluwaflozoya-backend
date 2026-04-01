FROM node:20-alpine

# Install dependencies for Ollama
RUN apk add --no-cache curl bash

# Install Ollama
RUN curl -fsSL https://ollama.ai/install.sh | sh

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm ci --only=production

# Copy all app files
COPY . .

# Expose port 3000
EXPOSE 3000

# Pre-pull models (faster startup)
RUN ollama pull llama3.1:8b && ollama pull gemma3

# Start Ollama + Node server
CMD sh -c "ollama serve & npm start"