FROM node:22-alpine

WORKDIR /app
COPY package.json README.md ./
COPY bin ./bin
COPY src ./src
COPY examples ./examples

# usage:
#   docker run --rm -v "$PWD:/work" -w /work ghcr.io/yourname/homepub:latest plan
ENTRYPOINT ["node", "/app/bin/homepub.js"]
