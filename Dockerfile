# Node 24 (LTS), pinned to the multi-platform image index (linux/amd64 and
# linux/arm64) so every build starts from the same base. To move to a newer
# node:24-slim: docker pull node:24-slim && docker inspect --format='{{index .RepoDigests 0}}' node:24-slim
FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
# Express in production mode: no stack traces in error pages, templates compiled once.
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p data
CMD ["node", "src/index.js"]
