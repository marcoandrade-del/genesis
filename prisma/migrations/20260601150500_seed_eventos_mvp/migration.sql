-- MVP da Tabela de Eventos Contábeis (~30 eventos cobrindo as categorias
-- SIAFEM-SP). Aplicado APENAS se existir o modelo "PARANÁ" — em outros
-- ambientes (CI/test) a migration roda sem efeitos.
--
-- Convenção do código (6 dígitos): XX-X-XXX
--   XX  Transação: 10=Previsão Receita, 20=Dotação, 30=Mov. Crédito,
--                  40=Empenho, 51=Apropriação Despesa, 52=Retenção,
--                  53=Liquidação Obrigação, 55=Aprop. Direito,
--                  56=Liq. Direito, 61=Restos a Pagar, 70=Desembolso,
--                  80=Receita
--   X   Tipo:      0=Normal, 1=Interno, 5=Estorno Normal, 6=Estorno Interno
--   XXX Sequencial

DO $$
DECLARE
  v_modelo_id  TEXT;
BEGIN
  SELECT id INTO v_modelo_id FROM modelos_contabeis WHERE descricao = 'PARANÁ' LIMIT 1;
  IF v_modelo_id IS NULL THEN
    RAISE NOTICE 'Modelo PARANÁ não encontrado — seed de eventos pulado.';
    RETURN;
  END IF;

  -- Helper temporário: insere evento + seus pares D-C em ordem.
  -- Cada chamada cria 1 evento. Os lançamentos vêm em arrays paralelos.
  CREATE TEMP TABLE _ev (
    codigo TEXT, descricao TEXT,
    tipoInscricao TEXT,
    classCont TEXT, classOrc TEXT,
    debitos TEXT[], creditos TEXT[]
  ) ON COMMIT DROP;

  INSERT INTO _ev VALUES
    -- 10x — PREVISÃO DE RECEITA
    ('100001', 'PREVISÃO INICIAL DA RECEITA BRUTA',
     '11 - Natureza da Receita', '521920100', 'YYYYYYY',
     ARRAY['521920100','521919900'], ARRAY['521929900','621100000']),
    ('100002', 'PREVISÃO INICIAL DAS DEDUÇÕES (FUNDEB/RETENÇÕES)',
     '11 - Natureza da Receita', '52121XXXX', '9YYYYYYY',
     ARRAY['521929900','621100000'], ARRAY['52121XXXX','521910100']),
    ('100501', 'ESTORNO DA PREVISÃO INICIAL DA RECEITA',
     '11 - Natureza da Receita', '521920100', 'YYYYYYY',
     ARRAY['521929900','521910100'], ARRAY['521920100','621100000']),

    -- 20x — DOTAÇÃO DA DESPESA (LOA)
    ('200001', 'DOTAÇÃO INICIAL DA DESPESA (LOA)',
     '21 - Natureza da Despesa', '522110000', 'YYYYYYY',
     ARRAY['522110000','622110000'], ARRAY['522190000','522920000']),
    ('200002', 'CRÉDITO ADICIONAL SUPLEMENTAR',
     '21 - Natureza da Despesa', '522120000', 'YYYYYYY',
     ARRAY['522120000','622110000'], ARRAY['522190000','522920000']),
    ('200003', 'CRÉDITO ADICIONAL ESPECIAL',
     '21 - Natureza da Despesa', '522130000', 'YYYYYYY',
     ARRAY['522130000','622110000'], ARRAY['522190000','522920000']),
    ('200501', 'ESTORNO DE DOTAÇÃO/CRÉDITO ADICIONAL',
     '21 - Natureza da Despesa', '522110000', 'YYYYYYY',
     ARRAY['522190000','522920000'], ARRAY['522110000','622110000']),

    -- 30x — MOVIMENTAÇÃO DE CRÉDITO (descentralização)
    ('300001', 'DESCENTRALIZAÇÃO DE CRÉDITO ORÇAMENTÁRIO (CONCEDIDA)',
     '21 - Natureza da Despesa', '522210000', 'YYYYYYY',
     ARRAY['522210000'], ARRAY['522290000']),
    ('300002', 'DESCENTRALIZAÇÃO DE CRÉDITO ORÇAMENTÁRIO (RECEBIDA)',
     '21 - Natureza da Despesa', '522220000', 'YYYYYYY',
     ARRAY['522220000'], ARRAY['522190000']),
    ('300501', 'ESTORNO DE DESCENTRALIZAÇÃO DE CRÉDITO',
     '21 - Natureza da Despesa', '522210000', 'YYYYYYY',
     ARRAY['522290000'], ARRAY['522210000']),

    -- 40x — EMPENHO
    ('400001', 'EMPENHO ORDINÁRIO DE DESPESA',
     '21 - Natureza da Despesa', '622130100', 'YYYYYYY',
     ARRAY['522190000','622130100'], ARRAY['522920000','622130300']),
    ('400002', 'EMPENHO ESTIMATIVO DE DESPESA',
     '21 - Natureza da Despesa', '622130200', 'YYYYYYY',
     ARRAY['522190000','622130200'], ARRAY['522920000','622130300']),
    ('400003', 'EMPENHO GLOBAL DE DESPESA',
     '21 - Natureza da Despesa', '622130300', 'YYYYYYY',
     ARRAY['522190000','622130300'], ARRAY['522920000','622130100']),
    ('400501', 'ANULAÇÃO DE EMPENHO',
     '21 - Natureza da Despesa', '622130100', 'YYYYYYY',
     ARRAY['522920000','622130300'], ARRAY['522190000','622130100']),

    -- 51x — APROPRIAÇÃO DE DESPESA (in-natura, gera VPD)
    ('510001', 'APROPRIAÇÃO/LIQUIDAÇÃO DE DESPESA (FASE PATRIMONIAL)',
     '21 - Natureza da Despesa', '3XXXXXXXX', 'YYYYYYY',
     ARRAY['3XXXXXXXX','622130300'], ARRAY['2131XXX01','622130400']),
    ('510501', 'ESTORNO DE APROPRIAÇÃO DE DESPESA',
     '21 - Natureza da Despesa', '3XXXXXXXX', 'YYYYYYY',
     ARRAY['2131XXX01','622130400'], ARRAY['3XXXXXXXX','622130300']),

    -- 52x — RETENÇÕES NA SOURCE
    ('520001', 'RETENÇÃO DE INSS NA FONTE',
     '99 - CNPJ INSS', '2131XXX02', NULL,
     ARRAY['2131XXX01'], ARRAY['21881XXXX']),
    ('520002', 'RETENÇÃO DE IRRF NA FONTE',
     '99 - CNPJ Receita Federal', '2131XXX03', NULL,
     ARRAY['2131XXX01'], ARRAY['21881XXXX']),
    ('520003', 'RETENÇÃO DE ISS NA FONTE',
     '99 - CNPJ Município', '2131XXX04', NULL,
     ARRAY['2131XXX01'], ARRAY['21881XXXX']),

    -- 53x — LIQUIDAÇÃO DE OBRIGAÇÕES (pagamento da retenção)
    ('530001', 'PAGAMENTO DE RETENÇÃO (INSS/IRRF/ISS)',
     '99 - CNPJ Credor da Retenção', '21881XXXX', NULL,
     ARRAY['21881XXXX'], ARRAY['111110000']),

    -- 55x — APROPRIAÇÃO DE DIREITO (receita a receber)
    ('550001', 'LANÇAMENTO DE RECEITA (DIREITO A RECEBER)',
     '11 - Natureza da Receita', '11211XXXX', NULL,
     ARRAY['11211XXXX'], ARRAY['4XXXXXXXX']),

    -- 56x — LIQUIDAÇÃO DE DIREITO (recebimento)
    ('560001', 'RECEBIMENTO DE DIREITO LANÇADO',
     '11 - Natureza da Receita', '11211XXXX', NULL,
     ARRAY['111110000'], ARRAY['11211XXXX']),

    -- 61x — RESTOS A PAGAR
    ('610001', 'INSCRIÇÃO EM RESTOS A PAGAR PROCESSADOS',
     '21 - Natureza da Despesa', '21311XXXX', 'YYYYYYY',
     ARRAY['622130400','632000000'], ARRAY['622130500','633000000']),
    ('610002', 'INSCRIÇÃO EM RESTOS A PAGAR NÃO-PROCESSADOS',
     '21 - Natureza da Despesa', '622130300', 'YYYYYYY',
     ARRAY['622130300','632000000'], ARRAY['622130600','633000000']),
    ('610501', 'CANCELAMENTO DE RESTOS A PAGAR',
     '21 - Natureza da Despesa', '21311XXXX', 'YYYYYYY',
     ARRAY['21311XXXX'], ARRAY['4912XXXXX']),

    -- 70x — DESEMBOLSOS
    ('700001', 'PAGAMENTO DIRETO AO CREDOR (SEM RETENÇÃO)',
     '99 - CNPJ Credor', '2131XXX01', NULL,
     ARRAY['2131XXX01','622130500'], ARRAY['111110000','622130700']),
    ('700002', 'PAGAMENTO COM RETENÇÃO',
     '99 - CNPJ Credor', '2131XXX01', NULL,
     ARRAY['2131XXX01','622130500'], ARRAY['111110000','622130700']),
    ('700501', 'ESTORNO DE PAGAMENTO',
     '99 - CNPJ Credor', '2131XXX01', NULL,
     ARRAY['111110000','622130700'], ARRAY['2131XXX01','622130500']),

    -- 80x — RECEITA / ARRECADAÇÃO
    ('800001', 'ARRECADAÇÃO DIRETA DA RECEITA (CAIXA)',
     '11 - Natureza da Receita', '4XXXXXXXX', 'YYYYYYY',
     ARRAY['111110000','621200000'], ARRAY['4XXXXXXXX','621300000']),
    ('800002', 'ARRECADAÇÃO DA RECEITA LANÇADA',
     '11 - Natureza da Receita', '4XXXXXXXX', 'YYYYYYY',
     ARRAY['111110000','621200000'], ARRAY['11211XXXX','621300000']),
    ('800501', 'ESTORNO DE ARRECADAÇÃO',
     '11 - Natureza da Receita', '4XXXXXXXX', 'YYYYYYY',
     ARRAY['4XXXXXXXX','621300000'], ARRAY['111110000','621200000']);

  -- Insere os eventos
  WITH inseridos AS (
    INSERT INTO eventos_contabeis (
      id, "modeloContabilId", codigo, descricao,
      "tipoInscricao", "classificacaoContabilMascara",
      "classificacaoOrcamentariaMascara", ativo, "atualizadoEm"
    )
    SELECT gen_random_uuid(), v_modelo_id, codigo, descricao,
           tipoInscricao, classCont, classOrc, true, NOW()
    FROM _ev
    RETURNING id, codigo
  )
  -- E os lançamentos: zip dos arrays debitos/creditos com ordem 1..N
  INSERT INTO eventos_lancamentos (id, "eventoId", ordem, "contaDebitoMascara", "contaCreditoMascara")
  SELECT gen_random_uuid(), i.id, ord, d, c
  FROM inseridos i
  JOIN _ev e ON e.codigo = i.codigo,
  LATERAL UNNEST(e.debitos, e.creditos) WITH ORDINALITY AS x(d, c, ord);

  RAISE NOTICE 'Seed de eventos contábeis inserido para modelo PARANÁ.';
END $$;
