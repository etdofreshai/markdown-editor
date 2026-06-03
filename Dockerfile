FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data SQLITE_PATH=/data/markdown-editor.sqlite
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME /data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
