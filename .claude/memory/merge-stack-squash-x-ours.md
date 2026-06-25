---
name: merge-stack-squash-x-ours
description: "Como mergear uma stack de PRs encadeadas com squash sem perder conteúdo de outra frente nas zonas de colisão — usar git merge -X ours, nunca git checkout --ours"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7542ce95-c63e-418e-b797-cdff6fa00d54
---

Ao mergear a stack Compras (#35⊂#36⊂#38) bottom-up com **squash**, cada PR superior fica CONFLICTING contra a master depois que o anterior é squashado (a master ganha o commit achatado com SHA novo; a branch superior carrega os commits originais).

**Erro que cometi:** resolvi os conflitos com `git checkout --ours <arquivo>`. Isso substitui o arquivo **inteiro** pela versão da branch, descartando todo o resultado auto-mesclado — inclusive métodos que a frente **App** havia adicionado a delegates existentes do `prisma-mock.ts` (ex.: `acessoEntidade.findFirst`). Os top-level delegates batiam (a branch era superset), então não vi pela contagem; só os **2244 testes** acusaram (`Cannot read properties of undefined (reading 'mockResolvedValue')` em 4 testes do App).

**Correção:** `git merge --no-commit --no-ff -X ours origin/master`. O `-X ours` (strategy-option, ≠ `-s ours` e ≠ `git checkout --ours`) resolve **só os hunks conflitantes** a favor de ours, mas mantém as mudanças não-conflitantes de theirs (o auto-merge do App). Resultado: zero marcador, App preservado, Compras intacta.

**Why:** num merge de stack-squash, os conflitos reais são "Compras adicionou aqui, App não" (theirs vazio ou subconjunto) → ficar com ours é correto POR HUNK; mas o App adiciona em OUTRAS regiões do mesmo arquivo (zonas de colisão `prisma-mock.ts`, `schema.prisma`, `admin/index.ts`, `views/layouts/main.ejs`) que precisam vir do auto-merge.

**How to apply:**
1. Bottom-up: squash #35→master; depois para cada PR superior, retarget base→master (`gh api -X PATCH repos/$REPO/pulls/N -f base=master` — o `gh pr edit --base` falha por GraphQL Projects-classic neste repo).
2. `git checkout <branch-superior>; git merge --no-commit --no-ff -X ours origin/master`.
3. Verificar SEMPRE com a suite inteira (`npm test`) + `npx tsc --noEmit | grep ^src/` ANTES de commitar — os testes do App são a rede que pega delegate/método dropado.
4. Confirmar diff líquido `git diff --name-only origin/master...HEAD` = só o delta daquela fase (sem vazar App nem fases anteriores).
5. Commit do merge, push (não-force), esperar CI verde, squash-merge.

Relacionado: [[coordenacao-sessoes]], [[compras-modulo-plano]], [[salvar-erros-em-memoria]].
