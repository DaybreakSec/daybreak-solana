# -- Stage 1: build --
FROM node:22.16-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip git bash \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r /tmp/requirements.txt

WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# -- Stage 2: runtime --
FROM node:22.16-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip git bash \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash daybreak
WORKDIR /app

COPY --from=build --chown=daybreak:daybreak /app/client/dist ./client/dist
COPY --from=build --chown=daybreak:daybreak /app/server ./server
COPY --from=build --chown=daybreak:daybreak /app/agents ./agents
COPY --from=build --chown=daybreak:daybreak /app/references ./references
COPY --from=build --chown=daybreak:daybreak /app/scripts ./scripts
COPY --from=build --chown=daybreak:daybreak /app/package.json ./
COPY --from=build --chown=daybreak:daybreak /app/package-lock.json ./
COPY --from=build --chown=daybreak:daybreak /app/requirements.txt ./
COPY --from=build --chown=daybreak:daybreak /app/client/package.json ./client/

RUN npm ci --omit=dev --workspace=server --no-audit --no-fund
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt
RUN npm install -g @ast-grep/cli @anthropic-ai/claude-code@2.1.138

USER daybreak

ENV NODE_ENV=production
ENV PORT=3000
ENV BIND_HOST=0.0.0.0
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/scan/status').then(r=>{if(!r.ok)throw r;process.exit(0)}).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
