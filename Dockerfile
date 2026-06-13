FROM node:22-alpine

WORKDIR /app

# Install production dependencies first for better layer caching.
COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Persist the JSON payment store across restarts by mounting a volume here.
VOLUME ["/app/data"]

CMD ["node", "src/server.js"]
