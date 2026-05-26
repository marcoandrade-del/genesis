# Dicas de Otimização para Claude Code

Diretrizes para escrever (ou converter de PDF) documentação que o Claude Code
consome bem. Movido daqui: `docs/arquitetura_sistema.md` (template original).

1. **Substitua diagramas visuais por Mermaid.js.** Se o PDF original tem
   diagramas de blocos, fluxogramas ou sequência, **não tente descrevê-los em
   texto longo**. Converta para blocos de código **Mermaid**. O Claude lê e
   entende a sintaxe perfeitamente.

   ```mermaid
   graph TD
     A[Cliente] -->|Requisição| B(API Gateway)
     B -->|Valida Permissão| C{Serviço de Autenticação}
     C -->|Sucesso| D[Serviço de Negócio]
   ```

2. **Evite históricos e contextos longos.** PDFs de arquitetura costumam ter
   seções como "Histórico de Versões do Documento", "Participantes das
   Reuniões" ou "Justificativas de Negócio Passadas". **Delete tudo isso.**
   Foque no estado *atual* e técnico do sistema.

3. **Instrua o Claude no início do arquivo.** Você pode colocar um comentário
   explícito no topo do `.md` para guiar o comportamento do Claude Code, por
   exemplo:

   ```markdown
   <!-- Claude: este documento descreve o estado atual da arquitetura.
        Use-o como fonte da verdade antes de modificar src/. -->
   ```

   > Observação: o item 3 estava incompleto no template original (o bloco
   > `markdown` ficou aberto sem conteúdo). O exemplo acima é uma
   > reconstrução plausível — ajuste conforme o que você quis dizer.
