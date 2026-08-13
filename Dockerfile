ARG NODE_IMAGE=node:22.18.0-bookworm-slim
FROM ${NODE_IMAGE}

LABEL org.opencontainers.image.title="DevOrbit" \
      org.opencontainers.image.description="Auditable multi-agent software delivery control plane" \
      org.opencontainers.image.version="0.5.1" \
      org.opencontainers.image.licenses="Apache-2.0"

RUN groupadd --gid 10001 devorbit \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /app --shell /usr/sbin/nologin devorbit

WORKDIR /app
COPY --chown=10001:10001 package.json server.js ./
COPY --chown=10001:10001 app ./app
COPY --chown=10001:10001 config ./config
COPY --chown=10001:10001 fixtures ./fixtures
COPY --chown=10001:10001 knowledge ./knowledge
COPY --chown=10001:10001 reports ./reports
COPY --chown=10001:10001 schemas ./schemas
COPY --chown=10001:10001 src ./src

ENV NODE_ENV=production \
    DEVORBIT_ENVIRONMENT=container \
    HOST=0.0.0.0 \
    PORT=4173

USER 10001:10001
EXPOSE 4173
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4173/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["node"]
CMD ["server.js"]
