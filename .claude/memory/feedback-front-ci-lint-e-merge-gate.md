---
name: feedback-front-ci-lint-e-merge-gate
description: No front (oxy-dashboards), o CI roda lint+build+test; rodar eslint local antes do push e NÃO mergear sem o CI verde
metadata:
  type: feedback
---

Mergeei o PR #18 do oxy-dashboards com o CI **vermelho** (regra `react-hooks/set-state-in-effect`: `setState` síncrono no corpo de um `useEffect`). Dois erros meus:

1. Rodei só `tsc --noEmit` + `vitest run` antes do push — mas o CI do front é **`lint · build · test`**. O `eslint` pega coisas que o tsc/vitest não pegam.
2. Encadeei `gh run watch ...; gh pr merge ...` — o watch reportou *fail* e o merge **rodou mesmo assim** (sem branch protection bloqueando).

**Why:** main quebrada + retrabalho (precisei de um fix-forward, #19).

**How to apply:** antes de push em repo de front, rodar `npm run lint` (ou `npx eslint .`) junto com typecheck+test. E nunca encadear merge após o watch: checar o resultado do CI e só então mergear. Ver [[salvar-erros-em-memoria]], [[feedback-claude-dirige-versionamento]].
