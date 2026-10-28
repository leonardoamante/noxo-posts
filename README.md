# noxo-posts

Fila de publicação automática do Instagram (@noxobr) e da Página do Facebook da NOXO.

- `fila/AAAA-MM-DD-HHMM/` — posts aprovados, esperando o horário (Brasília). Cada pasta tem `01.jpg`, `02.jpg`... e `legenda.txt`.
- `publicados/` — histórico do que já saiu, com `resultado.json` (links do post).
- `.github/workflows/publicar.yml` — roda às 08:00, 12:00 e 18:00 e publica o post mais antigo já vencido (um por vez).

Os posts são gerados e enfileirados pelo MazyOS. Os tokens da Meta ficam nos segredos do repositório, nunca no código.

Publicação manual ou teste: aba **Actions** → **Publicar post** → **Run workflow**.
