FROM node:22.23.1-alpine3.23@sha256:8516dce0483394d5708d4b2ee6cacb79fb1d617ea4e2787c2120bcca92ce372e AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM alpine:3.23.3@sha256:25109184c71bdad752c8312a8623239686a9a2071e8825f20acb8f2198c3f659

RUN apk add --no-cache \
      nginx=1.28.3-r7 \
      nginx-mod-http-brotli=1.28.3-r7

COPY nodeapp/nginx.conf /etc/nginx/nginx.conf
COPY nodeapp/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

USER nginx
EXPOSE 12596
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:12596/healthz || exit 1

ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
