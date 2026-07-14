#!/usr/bin/env bash
# ============================================================================
# varredura-segredos.sh — Varredura de segredos expostos em repositórios
# Elotech / OXY / Gênesis — uso local (Claude Code ou terminal)
#
# Uso:
#   ./varredura-segredos.sh [diretório]        # padrão: diretório atual
#   ./varredura-segredos.sh ~/projetos/oxy
#
# O script NÃO altera nada. Só reporta. Saída com código 1 se achar algo.
# ============================================================================

set -uo pipefail

ALVO="${1:-.}"
ACHOU=0

VERMELHO='\033[0;31m'; AMARELO='\033[1;33m'; VERDE='\033[0;32m'; AZUL='\033[0;34m'; NC='\033[0m'

titulo() { echo -e "\n${AZUL}== $1 ==${NC}"; }
alerta() { echo -e "${VERMELHO}[EXPOSTO]${NC} $1"; ACHOU=1; }
aviso()  { echo -e "${AMARELO}[ATENÇÃO]${NC} $1"; }
ok()     { echo -e "${VERDE}[OK]${NC} $1"; }

# Diretórios a ignorar na busca
EXCLUDES=(--exclude-dir=.git --exclude-dir=node_modules --exclude-dir=target
          --exclude-dir=dist --exclude-dir=build --exclude-dir=.venv
          --exclude-dir=venv --exclude-dir=__pycache__)

# ----------------------------------------------------------------------------
# 1. Padrões de chaves conhecidas (provedores usados no OXY + genéricos)
# ----------------------------------------------------------------------------
titulo "1/6 · Padrões de chaves de API no código"

declare -A PADROES=(
  ["Anthropic"]='sk-ant-[A-Za-z0-9_-]{20,}'
  ["OpenAI"]='sk-(proj-)?[A-Za-z0-9_-]{20,}'
  ["Google (AIza)"]='AIza[0-9A-Za-z_-]{35}'
  ["GitHub token"]='gh[pousr]_[A-Za-z0-9]{36,}'
  ["Chave privada PEM"]='-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
  ["JWT hardcoded"]='eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}'
  ["AWS access key"]='AKIA[0-9A-Z]{16}'
  ["URL com senha"]='(postgres(ql)?|mysql|mongodb|redis|amqp)://[^:/@[:space:]]+:[^@[:space:]]+@'
  ["Senha inline (PGPASSWORD/DB_PASSWORD)"]='(PGPASSWORD|DB_PASSWORD|DATABASE_PASSWORD)=['\''"]?[A-Za-z0-9]{6,}'
)

for nome in "${!PADROES[@]}"; do
  RES=$(grep -rInE "${EXCLUDES[@]}" "${PADROES[$nome]}" "$ALVO" 2>/dev/null | head -20)
  if [ -n "$RES" ]; then
    alerta "Padrão '$nome' encontrado:"
    echo "$RES" | sed 's/^/    /'
  fi
done
[ $ACHOU -eq 0 ] && ok "Nenhum padrão de chave conhecido no working tree."

# ----------------------------------------------------------------------------
# 2. Atribuições suspeitas em código e configuração
# ----------------------------------------------------------------------------
titulo "2/6 · Atribuições suspeitas (senha/segredo/token = valor literal)"

SUSPEITOS=$(grep -rInE "${EXCLUDES[@]}" \
  --include='*.java' --include='*.properties' --include='*.yml' --include='*.yaml' \
  --include='*.js' --include='*.ts' --include='*.html' --include='*.json' \
  --include='*.xml' --include='*.sh' --include='*.md' \
  '(password|passwd|senha|secret|segredo|token|api[_-]?key|apikey|credencial)[[:space:]]*[:=][[:space:]]*["'\''][^"'\''$\{]{8,}' \
  "$ALVO" 2>/dev/null \
  | grep -viE 'example|exemplo|placeholder|changeme|sua[_-]?chave|xxx|\*\*\*|dummy|sample|fake|env\.|System\.getenv|process\.env|\$\{' \
  | head -30)

if [ -n "$SUSPEITOS" ]; then
  aviso "Atribuições com valor literal (revisar manualmente — pode haver falso positivo):"
  echo "$SUSPEITOS" | sed 's/^/    /'
  ACHOU=1
else
  ok "Nenhuma atribuição literal suspeita."
fi

# ----------------------------------------------------------------------------
# 3. Arquivos .env e afins versionados no git
# ----------------------------------------------------------------------------
titulo "3/6 · Arquivos de segredo rastreados pelo git"

if git -C "$ALVO" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  RASTREADOS=$(git -C "$ALVO" ls-files | grep -E '(^|/)\.env($|\.)|\.pem$|\.p12$|\.pfx$|\.jks$|id_rsa|credentials' | grep -v '\.example')
  if [ -n "$RASTREADOS" ]; then
    alerta "Arquivos sensíveis VERSIONADOS (estão no histórico do git):"
    echo "$RASTREADOS" | sed 's/^/    /'
  else
    ok "Nenhum .env/.pem/keystore rastreado pelo git."
  fi

  # .gitignore cobre .env?
  if ! grep -qE '(^|/)\.env' "$ALVO/.gitignore" 2>/dev/null; then
    aviso ".gitignore não cobre '.env' — adicione antes que alguém commite."
  fi
else
  aviso "'$ALVO' não é repositório git — pulando checagens de git."
fi

# ----------------------------------------------------------------------------
# 4. Histórico do git (chaves que já foram commitadas e 'apagadas')
# ----------------------------------------------------------------------------
titulo "4/6 · Histórico do git (commits antigos)"

if git -C "$ALVO" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  HIST=$(git -C "$ALVO" log --all -p --no-color 2>/dev/null \
    | grep -nE '^\+.*(sk-ant-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|sk-(proj-)?[A-Za-z0-9_-]{30,}|AKIA[0-9A-Z]{16})' \
    | head -10)
  if [ -n "$HIST" ]; then
    alerta "Chaves encontradas no HISTÓRICO do git (mesmo revogadas, considere reescrever com git filter-repo se o repo for compartilhado):"
    echo "$HIST" | cut -c1-160 | sed 's/^/    /'
  else
    ok "Nenhuma chave conhecida no histórico."
  fi
fi

# ----------------------------------------------------------------------------
# 5. Configurações do Claude Code
# ----------------------------------------------------------------------------
titulo "5/6 · Configuração do Claude Code"

for f in "$HOME/.claude.json" "$HOME/.claude/settings.json" "$ALVO/.claude/settings.json" "$ALVO/.claude/settings.local.json" "$ALVO/CLAUDE.md"; do
  if [ -f "$f" ]; then
    # Exige a FORMA de uma chave/atribuição real — evita casar com regras de permissão
    # do próprio Claude Code (ex.: "Bash(grep ... 'sk-ant-|password' ...)").
    VAZOU=$(grep -InE 'sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|(password|senha)[[:space:]]*[:=][[:space:]]*['\''"]?[A-Za-z0-9._-]{8,}' "$f" 2>/dev/null | head -5)
    if [ -n "$VAZOU" ]; then
      alerta "Possível segredo em $f:"
      echo "$VAZOU" | cut -c1-160 | sed 's/^/    /'
    fi
  fi
done

# O Claude Code NÃO lê .claudeignore; o controle correto é 'permissions.deny' com
# regras Read() no .claude/settings.json (ou settings.local.json).
CC_DENY=0
for s in "$ALVO/.claude/settings.json" "$ALVO/.claude/settings.local.json"; do
  [ -f "$s" ] && grep -qE 'Read\(\.env' "$s" 2>/dev/null && CC_DENY=1
done
if { [ -d "$ALVO/.claude" ] || [ -f "$ALVO/CLAUDE.md" ]; } && [ $CC_DENY -eq 0 ]; then
  aviso "Projeto usa Claude Code mas não bloqueia leitura de segredos. Adicione em .claude/settings.json:"
  echo '        "permissions": { "deny": ["Read(.env)", "Read(**/*.pem)", "Read(**/*.key)", "Read(secrets/**)"] }'
  echo "    (o .claudeignore NÃO é lido pelo Claude Code — não adianta criar.)"
fi
ok "Checagem de configuração concluída."

# ----------------------------------------------------------------------------
# 6. Ferramenta especializada (recomendação)
# ----------------------------------------------------------------------------
titulo "6/6 · Varredura profunda (opcional, recomendado)"

if command -v gitleaks >/dev/null 2>&1; then
  echo "Rodando gitleaks..."
  gitleaks detect --source "$ALVO" --no-banner || ACHOU=1
else
  aviso "gitleaks não instalado. Para varredura completa do histórico:"
  echo "    brew install gitleaks        # macOS"
  echo "    ou baixe em https://github.com/gitleaks/gitleaks/releases"
  echo "    depois: gitleaks detect --source $ALVO"
fi

# ----------------------------------------------------------------------------
echo
if [ $ACHOU -eq 1 ]; then
  echo -e "${VERMELHO}RESULTADO: itens encontrados. Siga o checklist-rotacao-chaves.md${NC}"
  exit 1
else
  echo -e "${VERDE}RESULTADO: nada encontrado pelos padrões verificados.${NC}"
  exit 0
fi
