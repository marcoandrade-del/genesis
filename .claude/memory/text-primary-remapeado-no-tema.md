---
name: text-primary-remapeado-no-tema
description: "No tema Wise do Gênesis, .text-primary vira ink (preto), não lime — usar var(--primary) direto se precisar do verde"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e7c5e4bc-c2fc-4b70-a4b9-da9bd1f36c67
---

Tentei usar `class="text-primary"` num ícone do sidebar pra dar cor lime,
esperando o comportamento Bootstrap padrão (primary color). Mas no
`src/views/layouts/_theme.ejs` há a regra:

```css
.text-primary { color: var(--ink) !important; }
```

…porque a paleta Wise reserva o lime SÓ pra CTA, e brand-em-texto é ink.
Resultado: o ícone ficaria preto sobre fundo ink (invisível no sidebar
dark).

Override só existe em escopo bem específico:
`.navbar-dark .navbar-brand .text-primary { color: var(--primary) !important; }`.

**Why:** A regra é design-system — não é Bootstrap-vanilla. Quem chega
no codebase assume comportamento Bootstrap e quebra.

**How to apply:** Quando precisar do verde lime fora do CTA (badge, ícone
decorativo, etc), usar `style="color: var(--primary)"` (ou criar uma
classe utilitária dedicada tipo `.text-lime` no tema). Nunca confiar em
`text-primary` para significar verde no Gênesis.
