FROM node:20-alpine

RUN apk add --no-cache curl bash zstd libc6-compat
RUN curl -fsSL https://ollama.ai/install.sh | sh

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

EXPOSE $PORT
CMD sh -c "ollama serve & npm start"