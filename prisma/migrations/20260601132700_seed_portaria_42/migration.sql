-- Seed da Portaria MOG nº 42/1999: classificação funcional brasileira.
-- 28 funções + 109 subfunções. Lei federal, aplicável a todos os entes.

-- Função: usar UUIDs determinísticos baseados no código? Não — geramos via
-- gen_random_uuid() (já carregada via pgcrypto no Postgres). Subfunção
-- referencia pelo código.

INSERT INTO "funcoes" (id, codigo, nome) VALUES
  (gen_random_uuid(), '01', 'LEGISLATIVA'),
  (gen_random_uuid(), '02', 'JUDICIÁRIA'),
  (gen_random_uuid(), '03', 'ESSENCIAL À JUSTIÇA'),
  (gen_random_uuid(), '04', 'ADMINISTRAÇÃO'),
  (gen_random_uuid(), '05', 'DEFESA NACIONAL'),
  (gen_random_uuid(), '06', 'SEGURANÇA PÚBLICA'),
  (gen_random_uuid(), '07', 'RELAÇÕES EXTERIORES'),
  (gen_random_uuid(), '08', 'ASSISTÊNCIA SOCIAL'),
  (gen_random_uuid(), '09', 'PREVIDÊNCIA SOCIAL'),
  (gen_random_uuid(), '10', 'SAÚDE'),
  (gen_random_uuid(), '11', 'TRABALHO'),
  (gen_random_uuid(), '12', 'EDUCAÇÃO'),
  (gen_random_uuid(), '13', 'CULTURA'),
  (gen_random_uuid(), '14', 'DIREITOS DA CIDADANIA'),
  (gen_random_uuid(), '15', 'URBANISMO'),
  (gen_random_uuid(), '16', 'HABITAÇÃO'),
  (gen_random_uuid(), '17', 'SANEAMENTO'),
  (gen_random_uuid(), '18', 'GESTÃO AMBIENTAL'),
  (gen_random_uuid(), '19', 'CIÊNCIA E TECNOLOGIA'),
  (gen_random_uuid(), '20', 'AGRICULTURA'),
  (gen_random_uuid(), '21', 'ORGANIZAÇÃO AGRÁRIA'),
  (gen_random_uuid(), '22', 'INDÚSTRIA'),
  (gen_random_uuid(), '23', 'COMÉRCIO E SERVIÇOS'),
  (gen_random_uuid(), '24', 'COMUNICAÇÕES'),
  (gen_random_uuid(), '25', 'ENERGIA'),
  (gen_random_uuid(), '26', 'TRANSPORTE'),
  (gen_random_uuid(), '27', 'DESPORTO E LAZER'),
  (gen_random_uuid(), '28', 'ENCARGOS ESPECIAIS');

-- Subfunções: cada uma vinculada a sua função "natural" (1ª linha do anexo
-- da Portaria). Subfunções podem ser combinadas com qualquer função no uso
-- da execução orçamentária — a vinculação aqui é apenas para classificação
-- de origem.
WITH f AS (SELECT codigo, id FROM "funcoes")
INSERT INTO "subfuncoes" (id, codigo, nome, "funcaoId")
SELECT gen_random_uuid(), s.codigo, s.nome, f.id
FROM (VALUES
  -- 01 LEGISLATIVA
  ('031', 'AÇÃO LEGISLATIVA', '01'),
  ('032', 'CONTROLE EXTERNO', '01'),
  -- 02 JUDICIÁRIA
  ('061', 'AÇÃO JUDICIÁRIA', '02'),
  ('062', 'DEFESA DO INTERESSE PÚBLICO NO PROCESSO JUDICIÁRIO', '02'),
  -- 03 ESSENCIAL À JUSTIÇA
  ('091', 'DEFESA DA ORDEM JURÍDICA', '03'),
  ('092', 'REPRESENTAÇÃO JUDICIAL E EXTRAJUDICIAL', '03'),
  -- 04 ADMINISTRAÇÃO
  ('121', 'PLANEJAMENTO E ORÇAMENTO', '04'),
  ('122', 'ADMINISTRAÇÃO GERAL', '04'),
  ('123', 'ADMINISTRAÇÃO FINANCEIRA', '04'),
  ('124', 'CONTROLE INTERNO', '04'),
  ('125', 'NORMATIZAÇÃO E FISCALIZAÇÃO', '04'),
  ('126', 'TECNOLOGIA DA INFORMAÇÃO', '04'),
  ('127', 'ORDENAMENTO TERRITORIAL', '04'),
  ('128', 'FORMAÇÃO DE RECURSOS HUMANOS', '04'),
  ('129', 'ADMINISTRAÇÃO DE RECEITAS', '04'),
  ('130', 'ADMINISTRAÇÃO DE CONCESSÕES', '04'),
  ('131', 'COMUNICAÇÃO SOCIAL', '04'),
  -- 05 DEFESA NACIONAL
  ('151', 'DEFESA AÉREA', '05'),
  ('152', 'DEFESA NAVAL', '05'),
  ('153', 'DEFESA TERRESTRE', '05'),
  -- 06 SEGURANÇA PÚBLICA
  ('181', 'POLICIAMENTO', '06'),
  ('182', 'DEFESA CIVIL', '06'),
  ('183', 'INFORMAÇÃO E INTELIGÊNCIA', '06'),
  -- 07 RELAÇÕES EXTERIORES
  ('211', 'RELAÇÕES DIPLOMÁTICAS', '07'),
  ('212', 'COOPERAÇÃO INTERNACIONAL', '07'),
  -- 08 ASSISTÊNCIA SOCIAL
  ('241', 'ASSISTÊNCIA AO IDOSO', '08'),
  ('242', 'ASSISTÊNCIA AO PORTADOR DE DEFICIÊNCIA', '08'),
  ('243', 'ASSISTÊNCIA À CRIANÇA E AO ADOLESCENTE', '08'),
  ('244', 'ASSISTÊNCIA COMUNITÁRIA', '08'),
  -- 09 PREVIDÊNCIA SOCIAL
  ('271', 'PREVIDÊNCIA BÁSICA', '09'),
  ('272', 'PREVIDÊNCIA DO REGIME ESTATUTÁRIO', '09'),
  ('273', 'PREVIDÊNCIA COMPLEMENTAR', '09'),
  ('274', 'PREVIDÊNCIA ESPECIAL', '09'),
  -- 10 SAÚDE
  ('301', 'ATENÇÃO BÁSICA', '10'),
  ('302', 'ASSISTÊNCIA HOSPITALAR E AMBULATORIAL', '10'),
  ('303', 'SUPORTE PROFILÁTICO E TERAPÊUTICO', '10'),
  ('304', 'VIGILÂNCIA SANITÁRIA', '10'),
  ('305', 'VIGILÂNCIA EPIDEMIOLÓGICA', '10'),
  ('306', 'ALIMENTAÇÃO E NUTRIÇÃO', '10'),
  -- 11 TRABALHO
  ('331', 'PROTEÇÃO E BENEFÍCIOS AO TRABALHADOR', '11'),
  ('332', 'RELAÇÕES DE TRABALHO', '11'),
  ('333', 'EMPREGABILIDADE', '11'),
  ('334', 'FOMENTO AO TRABALHO', '11'),
  -- 12 EDUCAÇÃO
  ('361', 'ENSINO FUNDAMENTAL', '12'),
  ('362', 'ENSINO MÉDIO', '12'),
  ('363', 'ENSINO PROFISSIONAL', '12'),
  ('364', 'ENSINO SUPERIOR', '12'),
  ('365', 'EDUCAÇÃO INFANTIL', '12'),
  ('366', 'EDUCAÇÃO DE JOVENS E ADULTOS', '12'),
  ('367', 'EDUCAÇÃO ESPECIAL', '12'),
  ('368', 'EDUCAÇÃO BÁSICA', '12'),
  -- 13 CULTURA
  ('391', 'PATRIMÔNIO HISTÓRICO, ARTÍSTICO E ARQUEOLÓGICO', '13'),
  ('392', 'DIFUSÃO CULTURAL', '13'),
  -- 14 DIREITOS DA CIDADANIA
  ('421', 'CUSTÓDIA E REINTEGRAÇÃO SOCIAL', '14'),
  ('422', 'DIREITOS INDIVIDUAIS, COLETIVOS E DIFUSOS', '14'),
  ('423', 'ASSISTÊNCIA AOS POVOS INDÍGENAS', '14'),
  -- 15 URBANISMO
  ('451', 'INFRA-ESTRUTURA URBANA', '15'),
  ('452', 'SERVIÇOS URBANOS', '15'),
  ('453', 'TRANSPORTES COLETIVOS URBANOS', '15'),
  -- 16 HABITAÇÃO
  ('481', 'HABITAÇÃO RURAL', '16'),
  ('482', 'HABITAÇÃO URBANA', '16'),
  -- 17 SANEAMENTO
  ('511', 'SANEAMENTO BÁSICO RURAL', '17'),
  ('512', 'SANEAMENTO BÁSICO URBANO', '17'),
  -- 18 GESTÃO AMBIENTAL
  ('541', 'PRESERVAÇÃO E CONSERVAÇÃO AMBIENTAL', '18'),
  ('542', 'CONTROLE AMBIENTAL', '18'),
  ('543', 'RECUPERAÇÃO DE ÁREAS DEGRADADAS', '18'),
  ('544', 'RECURSOS HÍDRICOS', '18'),
  ('545', 'METEOROLOGIA', '18'),
  -- 19 CIÊNCIA E TECNOLOGIA
  ('571', 'DESENVOLVIMENTO CIENTÍFICO', '19'),
  ('572', 'DESENVOLVIMENTO TECNOLÓGICO E ENGENHARIA', '19'),
  ('573', 'DIFUSÃO DO CONHECIMENTO CIENTÍFICO E TECNOLÓGICO', '19'),
  -- 20 AGRICULTURA
  ('601', 'PROMOÇÃO DA PRODUÇÃO VEGETAL', '20'),
  ('602', 'PROMOÇÃO DA PRODUÇÃO ANIMAL', '20'),
  ('603', 'DEFESA SANITÁRIA VEGETAL', '20'),
  ('604', 'DEFESA SANITÁRIA ANIMAL', '20'),
  ('605', 'ABASTECIMENTO', '20'),
  ('606', 'EXTENSÃO RURAL', '20'),
  ('607', 'IRRIGAÇÃO', '20'),
  -- 21 ORGANIZAÇÃO AGRÁRIA
  ('631', 'REFORMA AGRÁRIA', '21'),
  ('632', 'COLONIZAÇÃO', '21'),
  -- 22 INDÚSTRIA
  ('661', 'PROMOÇÃO INDUSTRIAL', '22'),
  ('662', 'PRODUÇÃO INDUSTRIAL', '22'),
  ('663', 'MINERAÇÃO', '22'),
  ('664', 'PROPRIEDADE INDUSTRIAL', '22'),
  ('665', 'NORMALIZAÇÃO E QUALIDADE', '22'),
  -- 23 COMÉRCIO E SERVIÇOS
  ('691', 'PROMOÇÃO COMERCIAL', '23'),
  ('692', 'COMERCIALIZAÇÃO', '23'),
  ('693', 'COMÉRCIO EXTERIOR', '23'),
  ('694', 'SERVIÇOS FINANCEIROS', '23'),
  ('695', 'TURISMO', '23'),
  -- 24 COMUNICAÇÕES
  ('721', 'COMUNICAÇÕES POSTAIS', '24'),
  ('722', 'TELECOMUNICAÇÕES', '24'),
  -- 25 ENERGIA
  ('751', 'CONSERVAÇÃO DE ENERGIA', '25'),
  ('752', 'ENERGIA ELÉTRICA', '25'),
  ('753', 'COMBUSTÍVEIS MINERAIS', '25'),
  ('754', 'BIOCOMBUSTÍVEIS', '25'),
  -- 26 TRANSPORTE
  ('781', 'TRANSPORTE AÉREO', '26'),
  ('782', 'TRANSPORTE RODOVIÁRIO', '26'),
  ('783', 'TRANSPORTE FERROVIÁRIO', '26'),
  ('784', 'TRANSPORTE HIDROVIÁRIO', '26'),
  ('785', 'TRANSPORTES ESPECIAIS', '26'),
  -- 27 DESPORTO E LAZER
  ('811', 'DESPORTO DE RENDIMENTO', '27'),
  ('812', 'DESPORTO COMUNITÁRIO', '27'),
  ('813', 'LAZER', '27'),
  -- 28 ENCARGOS ESPECIAIS
  ('841', 'REFINANCIAMENTO DA DÍVIDA INTERNA', '28'),
  ('842', 'REFINANCIAMENTO DA DÍVIDA EXTERNA', '28'),
  ('843', 'SERVIÇO DA DÍVIDA INTERNA', '28'),
  ('844', 'SERVIÇO DA DÍVIDA EXTERNA', '28'),
  ('845', 'OUTRAS TRANSFERÊNCIAS', '28'),
  ('846', 'OUTROS ENCARGOS ESPECIAIS', '28'),
  ('847', 'TRANSFERÊNCIAS PARA A EDUCAÇÃO BÁSICA', '28')
) AS s(codigo, nome, funcao_codigo)
JOIN f ON f.codigo = s.funcao_codigo;
