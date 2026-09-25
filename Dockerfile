FROM node:22-slim

WORKDIR /app

COPY client/package.json client/package-lock.json* ./client/
WORKDIR /app/client
RUN npm install

COPY client/ ./
RUN npm run build

WORKDIR /app
COPY server/package.json server/package-lock.json* ./server/
WORKDIR /app/server
RUN npm install

WORKDIR /app
COPY server/ ./server/
COPY fleet.json ./fleet.json

EXPOSE 3001

CMD ["node", "server/src/index.js"]
