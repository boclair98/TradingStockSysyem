FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["sh", "-c", "npx vinext start --host 0.0.0.0"]
