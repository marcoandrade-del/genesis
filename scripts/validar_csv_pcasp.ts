import { readFileSync } from 'node:fs'
import { parseCSV, validar } from '../src/services/importador-plano-contas.js'

// Caminho do CSV via argumento; default mantém a fonte padrão em data/.
const arquivo = process.argv[2] ?? 'data/pcasp_estendido_2024.csv'
const csv = readFileSync(arquivo, 'utf-8')
const linhas = parseCSV(csv)
console.log(`parseCSV: ${linhas.length} linhas`)
const niveis = validar(linhas)
console.log(`validar: OK — ${niveis.size} contas`)
const dist: Record<number, number> = {}
for (const n of niveis.values()) dist[n] = (dist[n] ?? 0) + 1
for (const k of Object.keys(dist).sort()) console.log(`  nível ${k}: ${dist[+k]}`)
const folhas = linhas.filter((l) => l.admiteMovimento).length
console.log(`folhas (admiteMovimento=true): ${folhas}`)
