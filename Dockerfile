FROM node:22-alpine

WORKDIR /app
COPY package.json README.md ./
COPY bin ./bin
COPY src ./src
COPY examples ./examples

# build:  docker build -t homepub .
# usage:  docker run --rm -v "$PWD:/work" -w /work homepub plan
ENTRYPOINT ["node", "/app/bin/homepub.js"]
