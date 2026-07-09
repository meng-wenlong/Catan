FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server ./server
COPY public ./public
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server/index.js"]
