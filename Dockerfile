FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0
COPY package.json ./
COPY server.js index.html demo.html opay.html ./
COPY backend ./backend
COPY src ./src
RUN mkdir -p /app/.runtime
EXPOSE 3000
CMD ["node", "server.js"]
