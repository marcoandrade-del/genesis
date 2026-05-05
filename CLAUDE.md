Markdown

@/home/marco/claude/skills/karpathy-guidelines.md

# Projeto Gênesis - Especificação Técnica & Guia de Engenharia

## 1. Visão Geral do Produto
O **Gênesis** é um framework provedor de infraestrutura para aplicações web. Ele abstrai a gestão de menus, módulos, funcionalidades e permissões para sistemas satélites.

### Hierarquia de Navegação (Core Logic)
1.  **Sistema**: Entidade raiz.
2.  **Módulo**: Pertence obrigatoriamente a um Sistema.
3.  **Menu**: Vinculado a um Módulo.
4.  **Item de Funcionalidade**: Pode ser uma funcionalidade final (CRUD, Tela, Relatório) ou um **Submenu**.

## 2. Princípios de Engenharia (Senior Level)
* **Arquitetura:** Utilize *Clean Architecture*. Separe claramente:
    * `Schemas/Models`: Definições de banco de dados (Prisma).
    * `Repositories`: Acesso a dados e persistência.
    * `Services`: Regras de negócio e casos de uso (onde a lógica Gênesis reside).
    * `Controllers/Routes`: Interfaces de entrada.
* **Tratamento de Erros:** Implemente um middleware global de erros. Use classes de erro customizadas (ex: `AppError`, `ValidationError`). Nunca retorne erros genéricos 500 sem log.
* **Segurança & Dados:** * Utilize **UUID** para IDs primários em vez de inteiros sequenciais.
    * Implemente **Transações de Banco** (Atomicity) ao criar Sistemas, garantindo que o administrador inicial seja vinculado no mesmo processo.
* **Código Limpo:** TypeScript rigoroso (strict mode). Use JSDoc para explicar o "porquê" de lógicas complexas.

## 3. Regras de Negócio Críticas
* **Trava de Administrador:** Nenhum Sistema ou Módulo pode ficar sem ao menos um administrador ativo. Proibir exclusão do último admin.
* **Identificação Única:** Usuários são pessoas físicas identificadas unicamente por CPF (ou ID estrangeiro). Documentos duplicados são proibidos.
* **Fluxo de Ativação:** Cadastro exige validação dupla obrigatória (Código via E-mail + Código via Celular/SMS).
* **UX de Favoritos:** Relatórios personalizados devem permitir organização em pastas, mimetizando a experiência de favoritos do Google Chrome.

## 4. Instruções para o Claude Code (CLI)
* **Auto-Review:** Antes de finalizar qualquer tarefa, faça um self-code-review procurando por code smells e vulnerabilidades.
* **Test-Driven:** Sempre que criar um novo Service ou funcionalidade crítica, sugira e crie os respectivos testes unitários.
* **Custom Skills:** Utilize o diretório `.claude/skills/` para criar ferramentas que automatizem o boilerplate do projeto e validem a integridade da hierarquia de menus.

## 5. Stack Tecnológica
* **Runtime:** Node.js (LTS)
* **Linguagem:** TypeScript
* **ORM:** Prisma
* **Database:** PostgreSQL (User: mandrade1965)

## 6. Skills do Projeto

### `admin-page`
TRIGGER: Use a skill `admin-page` sempre que o usuário pedir para criar uma nova tela, página ou CRUD no painel admin. Palavras-chave: "tela admin", "página admin", "gerenciar X no painel", "CRUD admin de X".

### `api-standards`
TRIGGER: Use a skill `api-standards` sempre que criar ou modificar rotas Fastify da API REST (arquivos em `src/routes/`).

### `prisma-patterns`
TRIGGER: Use a skill `prisma-patterns` sempre que escrever queries Prisma, services ou lógica de banco de dados.
