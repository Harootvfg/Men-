# Nicht in CI gebaut/getestet – als Ausgangspunkt für den Betrieb gedacht.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg espeak-ng fonts-inter fonts-dejavu-core ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 DATA_DIR=/data
RUN npm run build
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
