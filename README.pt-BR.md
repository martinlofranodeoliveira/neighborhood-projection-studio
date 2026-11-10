# Neighborhood Projection Studio

SDK Python e CLI locais para ajustar PCA real do scikit-learn e explicar quais
vizinhos mudam na projeção de uma tabela numérica para três dimensões. Recibos
por ponto mostram vizinhos mantidos, perdidos e introduzidos; frações inteiras
resumem penalidades de rank. Os exemplos são sintéticos. A análise não usa API,
download de modelo, telemetria ou envio dos dados.

Este repositório inclui o SDK/CLI Python e o inspetor React/Three.js. O Python
executa o ajuste PCA real; o navegador lê o relatório exportado. Testes nativos
Python/CPU/JSDOM e revisão estática não comprovam WebGL renderizado, ponteiro
físico, acabamento responsivo ou conformidade de acessibilidade. O DESIGN.md
derivado da fonte mantém a necessidade de capturas e revisão visual.

## Instalação e comandos

Foi qualificada a tupla Linux x86_64/CPython 3.13.18, NumPy 2.5.4, SciPy 1.18.1,
scikit-learn 1.9.1 e threadpoolctl 3.8.0. Outros ambientes não foram qualificados.
Os locks/hashes são genuínos; o backend é setuptools 84.2.1/wheel 0.48.0.

```sh
python3.13 -m venv .venv
.venv/bin/python -m pip install --only-binary=:all: --require-hashes -r requirements-dev.lock
.venv/bin/python -m pip install --no-build-isolation --no-deps .
.venv/bin/neighborhood-projection-studio --version
.venv/bin/neighborhood-projection-studio demo --assert
.venv/bin/neighborhood-projection-studio analyze --input examples/weighted.input.json --format csv
.venv/bin/python -O -m neighborhood_projection_studio demo --assert
```

A instalação adquire os pacotes fixados. A análise funciona offline.
`demo --assert` ajusta PCA real em 64 linhas/8 atributos e confere todos os ranks
por laços escalares e a fração 115/128. As verificações explícitas continuam
ativas sob `-O`. Esse resultado descreve o fixture; não é benchmark de qualidade.

`--input -` lê stdin binário em blocos até EOF; leitura não bloqueante
pendente(None), mesmo após prefixo válido, é INPUT_IO. `--format json|csv` escolhe a saída inteira;
`--max-output-bytes N` aceita inteiros canônicos 0..16777216. Cap 0 do formato é
avaliado depois da entrada e do núcleo; `budget.max_report_bytes:0` continua no
preflight anterior do SDK. Sucesso exige exit0 e enquadramento completo com LF.
Stdout pode falhar depois de um prefixo. Erros são JSON fixo em stderr, sem
caminhos, valores ou texto arbitrário do SDK. Se stderr também falhar, somente
o FD já falho é silenciado e o exit original é preservado; falha de entrega de
stdout/help/version resulta em OUTPUT_IO/exit4.

## Python → JSON → React

Depois da instalação Python acima, gere um relatório:

```sh
.venv/bin/neighborhood-projection-studio analyze --input examples/weighted.input.json --format json > study.json
```

Continue somente após exit0: falha na saída pode deixar arquivo incompleto.
Em um checkout do repositório, use Node22.23.4/npm10.9.9, a tupla qualificada:

```sh
cd web
npm ci --ignore-scripts
npm run dev
```

Abra o endereço localhost mostrado pelo Vite, escolha **Abrir estudo** e selecione
`study.json`. Importe a **saída do SDK**, não a tabela `*.input.json`. O navegador
valida o contrato fechado e recalcula o resumo da entrada antes de aceitar o
estudo. Arquivos importados continuam com **execução não verificada**: hash ou
producer correspondente não comprova que um PCA foi executado. Os dados não são
enviados a um servidor.

Os quatro exemplos incluídos foram realmente exportados pelo SDK a partir de
dados sintéticos, com hashes e proveniência da fonte/versões observadas. Selecione
um registro e compare seus vizinhos originais/projetados. PT-BR/EN, visibilidade e
câmera alteram somente a apresentação; não ajustam PCA nem recalculam ranks.
k é somente leitura: gere outro relatório Python para alterá-lo. A vista2D é a
alternativa quando WebGL está indisponível. Não há imagem de mockup, pesos de
modelo ou análise inventada na interface.

```sh
npm run typecheck
npm test
npm run test:foundation
npm run build
npm run check:html
```

O build gera arquivos estáticos em `web/dist`. Sirva essa pasta em localhost ou
HTTPS para disponibilizar WebCrypto; não espere essas capacidades abrindo
index.html por file://. O wheel contém SDK/CLI Python; o repositório e o arquivo
de fonte completo incluem o React. Use o checkout para desenvolvimento web.
Página e assets são servidos normalmente; inspecionar um relatório não chama
backend nem modelo.

## Entrada e uso do SDK

Os exemplos*.input.json têm os campos obrigatórios schema exatamente
`neighborhood-projection-input/1`, row_ids, feature_names, values e plan somente
`{k:...}`. Budget é opcional e aceita apenas max_rows, max_distance_entries,
max_neighbor_slots e max_report_bytes; os demais valores usam defaults do SDK.
Chaves desconhecidas/duplicadas e números JSON não finitos, inclusive 1e309,
são rejeitados. O núcleo valida os metadados, valores e limites sem coerção.

`analyze_projection(row_ids,values,feature_names,ProjectionPlan(k),budget=...)`
retorna resultado tipado: COMPLETE com relatório imutável, ou falha sem relatório.
Use serialize_json/serialize_point_csv para o protocolo; dataclasses.asdict não
é o adaptador. ProjectionReport.from_dict é um construtor passivo de DTO, não
um leitor limitado de arquivo não confiável nem certificado de execução.

São 8..4096 linhas, 4..16 atributos sem escala, valores finitos dentro de ±1000000
e k 1..min(16,floor((n-1)/2)). IDs/nomes obedecem
`[A-Za-z0-9_][A-Za-z0-9_-]{0,31}`. IDs numéricos continuam strings; JSON é
autoritativo porque planilhas podem converter tipos ou eliminar zeros iniciais.
Sequências comuns usam int/float builtin, nunca bool. Ndarrays não mascarados
aceitam inteiros de 8..64 bits e float32/float64 em ambas as ordens de bytes.
MaskedArray é rejeitado inclusive com nomask; não há imputação de ausentes.

## Leitura correta

PCA centra e não escala os atributos. O espectro completo vem da SVD mantida;
as primeiras três colunas são a geometria analisada. Câmera e pixels da tela
não definem essas distâncias. Unidades diferentes podem dominar o PCA sem
escala; a projeção não estabelece clusters, previsão, verdade semântica ou ação.

O próprio ponto é excluído por ID, inclusive quando há observações coincidentes.
Empates seguem IDs ASCII; vizinhanças são dirigidas. Um vizinho introduzido
contribui input_rank−k. Trustworthiness e retenção são frações reduzidas exatas,
com aproximações apenas na apresentação. Variância retida é outra propriedade.

Entrada constante ainda executa PCA real, mas retorna leituras indisponíveis/null
e nenhum recibo de vizinhança; arredondamento não deve virar dispersão ampliada.
Flags de empate próximo/rank são políticas numéricas descritivas, sem prova de
rank exato, base única, incerteza ou estabilidade. Eixos/empates podem mudar por
arredondamento nativo; não há promessa bit a bit entre ambientes. Os relatórios
em examples/reports têm proveniência de ajustes locais reais, não são goldens
bit a bit para qualquer máquina.

O JSON canônico completo precisa caber em16 MiB antes de COMPLETE, mesmo que CSV
seja escolhido depois. Admitir forma/trabalho não garante espaço no relatório.
O caso real 4096x16/k16 produziu 23895444 bytes privados e retornou corretamente
UNKNOWN_BUDGET/JSON_BUDGET, sem relatório ou truncamento. Cada serializador tem
cap próprio contando LF. Esses limites lógicos não garantem memória/tempo
nativos, isolamento de parser ou retorno de um processo morto por OOM.

## Verificação

```sh
sh scripts/check.sh
sh scripts/check_web.sh
```

A preparação explícita adquire wheels PyPI e artefatos npm fixados pelos hashes,
com TLS normal nas respectivas fontes. As verificações seguintes são offline.
O pipeline público Python SDK/runtime
rodam sem rede e sem bind do host, UID 1000, capsALLdrop, no-new-privileges,
PIDs 256, 1 GiB e 2 CPU; runtime readonly. O gate verifica fonte/pacote, cria sdist e
wheel, reconstrói DO sdist, executa testes instalados e consumidor limpo com sete
dependências, ajustes nativos moderado/máximo e comandos CLI reais. Dist é saída
marcada do gate e é limpa antes da preparação; dados não marcados ou symlinks
são recusados. Não guarde arquivos pessoais ali.

O SDK Node vinculado à fonte usa somente o bind do projeto e trabalho temporário,
sem rede, UID1000, capsALLdrop, NNP, PIDs256/1GiB/2CPUs. Executa50testes de
runtime CPU/JSDOM, cinco checks da foundation, TypeScript estrito e build real
Vite/HTML. Isso não comprova GPU/navegador. A CI contém jobs Python e Node,
checkout fixado e permissões apenas de leitura do repositório.

Os testes Python são suporte Codex. Quatro módulos completos do núcleo Argon
foram preservados de uma resposta parcial; nenhum teste truncado foi reparado
ou usado. Revisão do núcleo e triagem nativa são evidências separadas dos testes
da CLI. Ter workflow não significa CI hospedado aprovado. Não há alegação de
clientes, produção, certificação, acurácia ou adoção.

Consulte docs/contract.md, LICENSE e NOTICE.md. Contexto do projeto:
https://lofranotecnologia.com.br.
