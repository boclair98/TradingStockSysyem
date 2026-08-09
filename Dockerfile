FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .
RUN npx next build

EXPOSE 3000
CMD ["sh", "-c", "npx next start -H 0.0.0.0 -p ${PORT:-3000}"]
