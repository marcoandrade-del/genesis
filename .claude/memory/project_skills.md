---
name: Skills e Configurações do Projeto
description: Skills instaladas, design system escolhido, hooks e comandos configurados
type: project
originSessionId: f0db38ae-2e9d-4905-a78e-74a746fa9179
---
## Design System

- **DESIGN.md** na raiz do projeto — estilo Linear (ultra-minimal, dark mode, acentos roxos)
- Instalado via `npx getdesign@latest add linear.app`
- Há também `wise/DESIGN.md` (não-versionado, raiz) — segundo design baixado via getdesign

## Skills do Projeto (`.claude/skills/`)

- `api-standards` — envelope REST, códigos de erro, status codes, paginação
- `prisma-patterns` — N+1, transações, soft delete, upsert, paginação, erros Prisma
- `admin-page` — gera tela admin completa (rota Fastify + templates EJS) seguindo os padrões do projeto. Triggers: "tela admin", "página admin", "CRUD admin de X"

## Skill não-versionada na raiz

- `test-reporter/SKILL.md` — skill `/test-report`: roda a suíte com cobertura, analisa pontos cegos (<80%) e gera plano de ação. Diretório `test-reporter/` na raiz, ainda não movido para `.claude/skills/` nem commitado.

## Skills Globais (`~/.claude/plugins/marketplaces/kepano/`)

Plugin `obsidian` com 5 skills: `obsidian-markdown`, `obsidian-cli`, `obsidian-bases`, `json-canvas`, `defuddle`

## Slash Commands (`~/.claude/commands/`)

- `/feature-dev` — workflow guiado de desenvolvimento
- `/review-pr` — revisão de PR com múltiplos agentes

## Hook de Segurança (`~/.claude/settings.json`)

- `PreToolUse` em `Edit|Write|MultiEdit` → roda `security_reminder_hook.py` antes de cada edição
- Alerta sobre XSS, injeção de comando, SQL injection em tempo real

**Why:** Escolhas feitas para garantir qualidade de código profissional e design consistente ao longo do projeto.
