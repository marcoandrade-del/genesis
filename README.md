# Gênesis

**https://github.com/marcoandrade-del/genesis**

Framework provedor de infraestrutura para aplicações web. Abstrai a gestão de menus, módulos, funcionalidades e permissões para sistemas satélites.

## Stack

- **Runtime:** Node.js (LTS) + TypeScript
- **Framework:** Fastify 5
- **ORM:** Prisma 7
- **Banco:** PostgreSQL
- **Templates:** EJS
- **Testes:** Vitest

## Hierarquia de Navegação

```
Sistema → Módulo → Menu → Item (Funcionalidade | Submenu)
```

## Funcionalidades

- Gestão de Sistemas, Módulos, Menus e Itens de Funcionalidade
- Controle de permissões por usuário/perfil
- Autenticação JWT com validação dupla (e-mail + SMS)
- Favoritos com organização em pastas
- Relatórios personalizados
- Painel administrativo

## Pré-requisitos

- Node.js 20+
- PostgreSQL
- Conta Twilio (SMS) e SMTP (e-mail)

## Instalação

```bash
npm install
cp .env.example .env   # configure as variáveis de ambiente
npm run db:migrate
npm run dev
```

## Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` | Servidor em modo desenvolvimento |
| `npm run build` | Compila para `dist/` |
| `npm start` | Inicia a build compilada |
| `npm run db:migrate` | Executa migrações do banco |
| `npm run db:studio` | Abre o Prisma Studio |
| `npm test` | Executa os testes unitários |

## Variáveis de Ambiente

```env
DATABASE_URL=postgresql://user:password@localhost:5432/genesis
JWT_SECRET=
SMTP_HOST=
SMTP_USER=
SMTP_PASS=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_FROM=
```

## Licença

ISC — Marco Andrade
