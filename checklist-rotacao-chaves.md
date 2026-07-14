# Checklist de rotação de chaves — Gênesis

Seguir quando `varredura-segredos.sh` (ou o gitleaks) apontar um segredo exposto.
Regra de ouro: **um segredo que vazou está queimado.** Não adianta só apagar do arquivo —
tem que **revogar e gerar um novo**, porque o valor antigo pode já ter sido copiado.

## 0. Ocorrência atual (2026-07-14)

- **`ANTHROPIC_API_KEY`** em `.env` (chave `sk-ant-api03-…`).
  - Boa notícia: `.env` está no `.gitignore`, **nunca foi commitado** e **não está no histórico** do git.
  - Ponto de exposição real: até agora **não havia `.claudeignore`**, então a chave era legível
    pelo Claude Code e chegou a ser lida numa sessão. Trate como **comprometida** → rotacione.
  - Outros segredos no mesmo `.env`: `JWT_SECRET`, `GMAIL_APP_PASSWORD`, `DATABASE_URL`, `REPORT_DB_URL`.
    Nunca vazaram pelo git; rotação é defensiva (prioridade menor que a chave da Anthropic).

- **Senha do Postgres do usuário `mandrade1965`** estava espalhada em **9 regras**
  do `.claude/settings.local.json` (comandos `psql`/`prisma` com a senha inline — valor omitido aqui de propósito).
  - `.claude/settings.local.json` é gitignored (`.claude/*`) → **nunca foi para o git nem para o histórico**;
    também não vazou para o `~/.claude.json` global.
  - **Já corrigido nesta varredura:** as 9 regras foram removidas do allow-list. A senha agora só
    existe no `.env` (local, gitignored). Como o valor circulou numa sessão do Claude, **rotacione** (passo 1).

## 1. Revogar o valor antigo (ação humana — o Claude não faz)

- **Anthropic:** https://console.anthropic.com/settings/keys → *Delete* a chave antiga → *Create Key* nova.
- **Gmail App Password:** https://myaccount.google.com/apppasswords → remover a antiga → gerar nova.
- **Banco (`DATABASE_URL` / `REPORT_DB_URL`):** `ALTER USER mandrade1965 WITH PASSWORD '...';` e atualizar a URL.
- **`JWT_SECRET`:** gerar novo (`openssl rand -base64 48`). Atenção: invalida sessões/tokens em circulação.

## 2. Atualizar o `.env` local com o valor NOVO

- Editar `.env` (nunca commitar). O `.env.example` só tem placeholders — mantenha assim.

## 3. Fechar os vetores de vazamento

- [x] `.gitignore` cobre `.env`, `.env.*`, `*.pem/*.key/*.p12/*.pfx/*.jks`, `secrets/`.
- [x] `permissions.deny` versionado em **`.claude/settings.json`** (`Read(.env)`, chaves, keystores, `secrets/`) —
      é o controle que o Claude Code de fato aplica **e** viaja com o repo (o `.gitignore` foi ajustado com
      `!.claude/settings.json`; o `settings.local.json`, com as regras locais da máquina, segue ignorado).
      Obs.: `.claudeignore` também está versionado como documentação, mas o Claude Code **não o lê** — quem bloqueia é o `deny`.
- [ ] Se o segredo já esteve **no histórico do git**: reescrever com `git filter-repo` (ou BFG) e forçar push;
      avisar todos que clonaram. *(No caso atual não é necessário — nunca esteve no histórico.)*

## 4. Reexecutar a varredura

```bash
./varredura-segredos.sh .
# esperado: "RESULTADO: nada encontrado pelos padrões verificados."
```

Varredura profunda com `gitleaks` (o `.gitleaks.toml` na raiz é carregado sozinho):

```bash
gitleaks git .   # varre TODO o histórico do repo (esperado: "no leaks found")
gitleaks dir .   # varre o working tree, inclui arquivos não rastreados
```

Falsos-positivos de dev/CI já verificados ficam liberados no `.gitleaks.toml` (por valor, não por linha).
