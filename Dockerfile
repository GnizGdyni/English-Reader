# Force Railway to run dict-api (not the Vite frontend).
FROM node:22-bookworm-slim

WORKDIR /app

COPY dict-api/package.json ./
COPY dict-api/server.mjs ./

RUN mkdir -p /app/data

ENV PORT=8080
ENV DICT_DB_PATH=/app/data/en.sqlite
EXPOSE 8080

CMD ["node", "server.mjs"]
