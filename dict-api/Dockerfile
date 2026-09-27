# Node 22 for built-in node:sqlite
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY server.mjs ./

# DB is downloaded at runtime via DICT_DB_URL (not baked into the image)
RUN mkdir -p /app/data

ENV PORT=8080
ENV DICT_DB_PATH=/app/data/en.sqlite
EXPOSE 8080

CMD ["node", "server.mjs"]
