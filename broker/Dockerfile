FROM node:22-alpine
WORKDIR /app

# Deps primeiro (cache de camada). Sem package-lock obrigatório.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY server.js ./

ENV PORT=8099
EXPOSE 8099
CMD ["node", "server.js"]
