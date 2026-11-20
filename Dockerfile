# Multi-stage Dockerfile para Google Cloud Run
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* bun.lock* ./
RUN npm ci || npm install

COPY . .

ARG VITE_APP_PUBLIC_URL=""
ENV VITE_APP_PUBLIC_URL=$VITE_APP_PUBLIC_URL

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/firebase-applet-config.json ./firebase-applet-config.json

EXPOSE 8080
ENV PORT=8080

CMD ["npx", "tsx", "server.ts"]
