# noxo-posts

Fila de publicação automática do Instagram (@noxobr) e da Página do Facebook da NOXO.

- `fila/AAAA-MM-DD-HHMM/` — posts aprovados, esperando o horário (Brasília). Cada pasta tem `01.jpg`, `02.jpg`... e `legenda.txt`.
- `publicados/` — histórico do que já saiu, com `resultado.json` (links do post).
- `.github/workflows/relogio.yml` — o relógio: espera nos servidores do GitHub até 12:00, 18:00 e 20:00 (Brasília) e aciona a publicação na hora. Se reagenda sozinho; um vigia de 3 em 3 horas o religa se parar.
- `.github/workflows/publicar.yml` — publica o post mais antigo já vencido (um por vez). Também tem horários agendados próprios, só como rede de segurança (o agendamento do GitHub atrasa horas).

Os posts são gerados e enfileirados pelo MazyOS. Os tokens da Meta ficam nos segredos do repositório, nunca no código.

Publicação manual ou teste: aba **Actions** → **Publicar post** → **Run workflow**.
