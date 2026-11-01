FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4173

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY version-build ./
COPY lib ./lib
COPY public ./public

RUN addgroup -S app && adduser -S -G app app && chown -R app:app /app
USER app

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
