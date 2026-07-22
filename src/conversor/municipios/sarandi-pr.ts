import type { MunicipioConfig } from '../nucleo/tipos.js'

/**
 * Config de Sarandi/PR (fabricante ELOTECH, produto OXY). Caso "difícil" do teste
 * de fogo: o host ativo é o LEGADO `sarandi.eloweb.net` (v3.100, mais antigo). A
 * RECEITA usa o mesmo formato dos hosts novos → importa 100% do portal
 * (`tce:'portal'`). A DESPESA, porém, vem com programática CONCATENADA sem pontos
 * (`040010412200061061449040`) e folha no nível 10 — o `parseProgramatica` só
 * decodifica o formato pontuado, então as dotações são ignoradas (0). Fica como
 * follow-up: parser do formato antigo (via `inicio`/`tamanho`) OU aguardar a
 * migração p/ `sarandi.oxy.elotech.com.br`. Ver [[conversor-turn-key-tracker]].
 */
export const sarandiPr: MunicipioConfig = {
  nome: 'Sarandi',
  ibge: '4126256',
  uf: 'PR',
  ano: 2026,
  fabricante: 'elotech',
  tce: 'portal',
  pularCreditos: true,
  portalUrl: 'https://sarandi.eloweb.net/portaltransparencia-api',
  entidades: [
    { nome: 'Prefeitura Municipal de Sarandi', tipo: 'PREFEITURA', params: { idPortal: '1' } },
    { nome: 'Câmara Municipal de Sarandi', tipo: 'CAMARA', params: { idPortal: '3' } },
    { nome: 'PreSERV — Previdência dos Servidores de Sarandi', tipo: 'ADM_INDIRETA', params: { idPortal: '2' } },
  ],
}
