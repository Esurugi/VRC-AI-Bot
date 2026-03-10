FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates git ripgrep util-linux \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable \
  && corepack prepare pnpm@10.6.5 --activate \
  && npm install -g @openai/codex

RUN mkdir -p /workspace /codex-home/.codex /pnpm/store \
  && chown -R node:node /workspace /codex-home /pnpm

COPY scripts/docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh

WORKDIR /workspace

ENV HOME=/codex-home
ENV CODEX_HOME=/codex-home/.codex

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["pnpm", "dev:raw"]
