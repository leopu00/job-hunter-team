# web/Dockerfile — Job Hunter Team (sviluppo locale)
# Node 20 Alpine per immagine leggera
FROM node:20-alpine

WORKDIR /app

# Installa dipendenze prima del codice per sfruttare la cache Docker
COPY package.json package-lock.json* ./
RUN npm ci

# Il codice sorgente viene montato via volume (hot reload)
EXPOSE 3000

CMD ["npm", "run", "dev"]
