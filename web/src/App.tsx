import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import './styles.css';
import ProjectionScene from './ProjectionScene';
import {
  createImportLease,
  type Locale,
  MAX_STUDY_BYTES,
  type PcaFlag,
  readStudy,
  type RelationCategory,
  type Study,
  StudyError,
  type StudyErrorCode,
} from './study';
import {
  type CategoryVisibility,
  formatFractionDecimal,
  formatFractionPercent,
  formatNumber,
  getSelectedRowSummary,
  resolveSelectedId,
} from './view';

export interface BundledSample {
  readonly id: string;
  readonly labels: {
    readonly 'pt-BR': string;
    readonly en: string;
  };
  readonly json: string;
}

export interface AppProps {
  readonly samples: readonly BundledSample[];
  readonly force2D?: boolean;
}

type StudyProvenance =
  | {
      readonly kind: 'BUNDLED_SYNTHETIC_SAMPLE';
      readonly sampleId: string;
    }
  | {
      readonly kind: 'IMPORTED_ANALYSIS_UNVERIFIED';
      readonly fileName: string;
    };

const PAGE_SIZE = 16;

const UI_COPY = {
  'pt-BR': {
    appTitle: 'Neighborhood Projection Studio',
    diagnosticsLabel: 'Diagnósticos do estudo',
    subtitle: 'Caderno de inspeção de vizinhanças sob projeção PCA (PC1–PC3)',
    openStudyBtn: 'Abrir estudo',
    exportJsonBtn: 'Exportar JSON',
    samplesLabel: 'Exemplo sintético:',
    provenanceBundled: 'Exemplo sintético incluído',
    provenanceImported: 'Importado · execução não verificada (IMPORTED_ANALYSIS_UNVERIFIED)',
    loadingStatus: 'Validando estrutura e resumo SHA-256 (NPSinput1)…',
    dismissError: 'Fechar aviso',
    preservedNote: 'O último estudo válido, a seleção e os filtros atuais foram preservados.',
    diagRecords: 'Registros (n)',
    diagFeatures: 'Atributos (d)',
    diagK: 'Vizinhos (k fixo)',
    diagKNote: 'Somente leitura; alterar k exige nova execução no SDK Python.',
    diagRetention: 'Retenção (R / nk)',
    diagTrustworthiness: 'Confiabilidade (T)',
    diagVariance: 'Variância retida (PC1–PC3)',
    diagConstantUnavailable: 'Indisponível (entrada constante)',
    diagTauScreen: 'Triagem espectral (s > τ)',
    diagFlagsLabel: 'Avisos de triagem numérica:',
    diagNoFlags: 'Nenhum aviso de quase-empate espectral ou posto < 3',
    filterLabel: 'Camadas de relação do ponto selecionado:',
    filterRetained: 'Retidos',
    filterLost: 'Perdidos',
    filterIntroduced: 'Introduzidos',
    marginTitle: 'Registro selecionado',
    marginCoordinates: 'Coordenadas projetadas canônicas',
    marginFeaturesTitle: 'Valores originais de entrada (UNSCALED_INPUT)',
    marginNeighborsTitle: 'Comparação ordenada de vizinhos (1..k)',
    marginInputCol: 'Espaço original (entrada)',
    marginProjectedCol: 'Subespaço projetado (PC1–PC3)',
    marginUnionTitle: 'Recibo de relações na união (k..2k)',
    colId: 'ID',
    colCategory: 'Categoria',
    colInRank: 'Posto orig.',
    colProjRank: 'Posto proj.',
    colInDist: 'Dist. orig.',
    colProjDist: 'Dist. proj.',
    colPenalty: 'Penalidade',
    colRetainedCount: 'Retidos',
    catRETAINED: 'Retido',
    catLOST: 'Perdido',
    catINTRODUCED: 'Introduzido',
    constantReceiptNotice:
      'Vizinhanças indisponíveis (UNAVAILABLE_CONSTANT_INPUT): todas as linhas de entrada são idênticas.',
    recordListTitle: 'Catálogo completo de registros do estudo',
    searchPlaceholder: 'Filtrar por ID literal (ASCII)…',
    searchClear: 'Limpar',
    showingRecords: 'Exibindo',
    ofRecords: 'de',
    prevPage: 'Anterior',
    nextPage: 'Próxima',
    pageLabel: 'Página',
    selectAction: 'Inspecionar',
    selectedAction: 'Ativo',
    emptyStateTitle: 'Nenhum estudo carregado',
    emptyStateBody:
      'Abra um arquivo JSON de estudo local (esquema neighborhood-projection-study/1, até 16 MiB) para validar o quadro de entrada NPSinput1 via WebCrypto SHA-256 e inspecionar vizinhanças.',
    methodTitle: 'Notas de método e leitura numérica',
    methodRetention:
      'Retenção mede a fração exata dos k vizinhos originais preservados entre os k vizinhos projetados.',
    methodTrust:
      'Confiabilidade (Trustworthiness) penaliza vizinhos introduzidos proporcionalmente ao posto original acima de k (penalidade total P).',
    methodVariance:
      'Variância retida mede a energia global L2 nos três primeiros eixos principais; alta variância global não garante preservação da vizinhança local de cada ponto.',
    methodProvenance:
      'Arquivos abertos localmente permanecem sempre marcados como IMPORTED_ANALYSIS_UNVERIFIED. O hash SHA-256 valida a integridade da tabela de entrada, não atesta execução de PCA nem versões observadas no fit_receipt.',
    flagDescriptions: {
      CUTOFF_NEAR_TIE:
        'CUTOFF_NEAR_TIE (gap34 ≤ τ): fronteira entre o 3º e o 4º valor singular próxima de empate numérico.',
      RETAINED_AXES_NEAR_TIE:
        'RETAINED_AXES_NEAR_TIE (gap12 ≤ τ ou gap23 ≤ τ): eixos principais retidos com valores singulares quase iguais.',
      RANK_BELOW_3_POLICY:
        'RANK_BELOW_3_POLICY (count(s > τ) < 3): posto numérico efetivo abaixo de 3 dimensões.',
    } as Record<PcaFlag, string>,
    errors: {
      FILE_TOO_LARGE:
        'O arquivo excede o limite máximo de 16 MiB (16.777.216 bytes). Exporte um estudo dentro do orçamento permitido.',
      INVALID_JSON:
        'O arquivo não pôde ser lido como JSON UTF-8 válido. Verifique a codificação UTF-8 e a sintaxe JSON.',
      INVALID_STUDY:
        'O documento JSON violou o contrato estrutural ou matemático do esquema neighborhood-projection-study/1.',
      DIGEST_MISMATCH:
        'O resumo SHA-256 calculado para o quadro NPSinput1 não coincide com input.digest_sha256.',
      CRYPTO_UNAVAILABLE:
        'WebCrypto SHA-256 indisponível. Sirva a aplicação em contexto seguro (HTTPS ou localhost).',
      INPUT_IO:
        'Falha de leitura do arquivo local. Selecione novamente um arquivo JSON legível.',
    } as Record<StudyErrorCode, string>,
  },
  en: {
    appTitle: 'Neighborhood Projection Studio',
    diagnosticsLabel: 'Study diagnostics',
    subtitle: 'Survey drawing folio for neighborhood preservation under PCA projection (PC1–PC3)',
    openStudyBtn: 'Import study',
    exportJsonBtn: 'Download JSON',
    samplesLabel: 'Synthetic sample:',
    provenanceBundled: 'Bundled synthetic sample',
    provenanceImported: 'Imported · unverified execution (IMPORTED_ANALYSIS_UNVERIFIED)',
    loadingStatus: 'Validating closed schema and NPSinput1 SHA-256 digest…',
    dismissError: 'Dismiss notice',
    preservedNote: 'The last accepted study, selection, and presentation filters were preserved.',
    diagRecords: 'Records (n)',
    diagFeatures: 'Features (d)',
    diagK: 'Neighbors (fixed k)',
    diagKNote: 'Read-only metadata; changing k requires a new Python SDK run.',
    diagRetention: 'Retention (R / nk)',
    diagTrustworthiness: 'Trustworthiness (T)',
    diagVariance: 'Retained variance (PC1–PC3)',
    diagConstantUnavailable: 'Unavailable (constant input)',
    diagTauScreen: 'Spectral screen (s > τ)',
    diagFlagsLabel: 'Numerical screening flags:',
    diagNoFlags: 'No spectral near-tie or rank < 3 screening flags',
    filterLabel: 'Selected point relation layers:',
    filterRetained: 'Retained',
    filterLost: 'Lost',
    filterIntroduced: 'Introduced',
    marginTitle: 'Selected record',
    marginCoordinates: 'Canonical projected coordinates',
    marginFeaturesTitle: 'Original input feature values (UNSCALED_INPUT)',
    marginNeighborsTitle: 'Ordered neighbor comparison (1..k)',
    marginInputCol: 'Original space (input)',
    marginProjectedCol: 'Projected subspace (PC1–PC3)',
    marginUnionTitle: 'Union relation receipt (k..2k)',
    colId: 'ID',
    colCategory: 'Category',
    colInRank: 'In rank',
    colProjRank: 'Proj rank',
    colInDist: 'In dist.',
    colProjDist: 'Proj dist.',
    colPenalty: 'Penalty',
    colRetainedCount: 'Retained',
    catRETAINED: 'Retained',
    catLOST: 'Lost',
    catINTRODUCED: 'Introduced',
    constantReceiptNotice:
      'Neighborhoods unavailable (UNAVAILABLE_CONSTANT_INPUT): all input rows are identical.',
    recordListTitle: 'Complete study record catalogue',
    searchPlaceholder: 'Filter by literal ASCII ID…',
    searchClear: 'Clear',
    showingRecords: 'Showing',
    ofRecords: 'of',
    prevPage: 'Previous',
    nextPage: 'Next',
    pageLabel: 'Page',
    selectAction: 'Inspect',
    selectedAction: 'Selected',
    emptyStateTitle: 'No study loaded',
    emptyStateBody:
      'Open a local study JSON file (schema neighborhood-projection-study/1, up to 16 MiB) to verify the NPSinput1 frame via WebCrypto SHA-256 and inspect neighborhood changes.',
    methodTitle: 'Method and numerical reading notes',
    methodRetention:
      'Retention measures the exact fraction of top-k original neighbors preserved among the top-k projected neighbors.',
    methodTrust:
      'Trustworthiness penalizes introduced neighbors proportionally to their original rank beyond k (total penalty P).',
    methodVariance:
      'Retained variance measures global L2 energy in the first three principal axes; high global variance does not guarantee local neighborhood preservation.',
    methodProvenance:
      'User-imported files are always labeled IMPORTED_ANALYSIS_UNVERIFIED. The SHA-256 digest verifies the input data frame, not PCA execution authenticity or fit_receipt runtime versions.',
    flagDescriptions: {
      CUTOFF_NEAR_TIE:
        'CUTOFF_NEAR_TIE (gap34 ≤ τ): boundary between 3rd and 4th singular values is near a numerical tie.',
      RETAINED_AXES_NEAR_TIE:
        'RETAINED_AXES_NEAR_TIE (gap12 ≤ τ or gap23 ≤ τ): retained principal axes have nearly equal singular values.',
      RANK_BELOW_3_POLICY:
        'RANK_BELOW_3_POLICY (count(s > τ) < 3): effective numerical rank is below 3 dimensions.',
    } as Record<PcaFlag, string>,
    errors: {
      FILE_TOO_LARGE:
        'File exceeds the 16 MiB (16,777,216 bytes) cap. Export a study within the permitted byte budget.',
      INVALID_JSON:
        'File could not be decoded as valid UTF-8 JSON. Check UTF-8 encoding and JSON syntax.',
      INVALID_STUDY:
        'JSON document failed structural or mathematical validation for schema neighborhood-projection-study/1.',
      DIGEST_MISMATCH:
        'Computed SHA-256 digest for the NPSinput1 frame did not match input.digest_sha256.',
      CRYPTO_UNAVAILABLE:
        'WebCrypto SHA-256 capability is unavailable. Serve the application over HTTPS or localhost.',
      INPUT_IO:
        'Could not read the selected local file. Choose a readable JSON study file.',
    } as Record<StudyErrorCode, string>,
  },
} as const;

function toErrorCode(err: unknown): StudyErrorCode {
  if (err instanceof StudyError) {
    return err.code;
  }
  return 'INVALID_STUDY';
}

function categorySymbol(cat: RelationCategory): string {
  if (cat === 'RETAINED') return '●';
  if (cat === 'LOST') return '□';
  return '◆';
}

export function App({
  samples,
  force2D = false,
}: AppProps): React.JSX.Element {
  const [locale, setLocale] = useState<Locale>('pt-BR');
  const [study, setStudy] = useState<Study | null>(null);
  const [acceptedJsonText, setAcceptedJsonText] = useState<string>('');
  const [provenance, setProvenance] = useState<StudyProvenance | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [visible, setVisible] = useState<CategoryVisibility>({
    retained: true,
    lost: true,
    introduced: true,
  });
  const [errorCode, setErrorCode] = useState<StudyErrorCode | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(0);

  const leaseRef = useRef(createImportLease());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputId = useId();
  const searchInputId = useId();

  const t = UI_COPY[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const loadBundledSample = useCallback(async (sample: BundledSample) => {
    const token = leaseRef.current.begin();
    setIsLoading(true);
    try {
      const validated = await readStudy(sample.json);
      if (!leaseRef.current.owns(token)) {
        return;
      }
      setStudy(validated);
      setAcceptedJsonText(sample.json);
      setProvenance({ kind: 'BUNDLED_SYNTHETIC_SAMPLE', sampleId: sample.id });
      setSelectedId((prev) => resolveSelectedId(validated, prev));
      setErrorCode(null);
      setIsLoading(false);
    } catch (err) {
      if (!leaseRef.current.owns(token)) {
        return;
      }
      setErrorCode(toErrorCode(err));
      setIsLoading(false);
    }
  }, []);

  const importUserFile = useCallback(async (file: File | null | undefined) => {
    const token = leaseRef.current.begin();
    setIsLoading(true);
    try {
      if (!file || typeof file.arrayBuffer !== 'function') {
        throw new StudyError('INPUT_IO', 'Missing readable File.');
      }
      if (typeof file.size === 'number' && file.size > MAX_STUDY_BYTES) {
        throw new StudyError('FILE_TOO_LARGE', 'File size exceeds 16 MiB.');
      }
      let buffer: ArrayBuffer;
      try {
        buffer = await file.arrayBuffer();
      } catch {
        throw new StudyError('INPUT_IO', 'Failed to read File ArrayBuffer.');
      }
      if (!leaseRef.current.owns(token)) {
        return;
      }
      if (buffer.byteLength > MAX_STUDY_BYTES) {
        throw new StudyError('FILE_TOO_LARGE', 'ArrayBuffer exceeds 16 MiB.');
      }
      let decodedText: string;
      try {
        decodedText = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        throw new StudyError('INVALID_JSON', 'Invalid UTF-8 byte sequence.');
      }
      const validated = await readStudy(decodedText);
      if (!leaseRef.current.owns(token)) {
        return;
      }
      setStudy(validated);
      setAcceptedJsonText(decodedText);
      setProvenance({
        kind: 'IMPORTED_ANALYSIS_UNVERIFIED',
        fileName: file.name || 'study.json',
      });
      setSelectedId((prev) => resolveSelectedId(validated, prev));
      setErrorCode(null);
      setIsLoading(false);
    } catch (err) {
      if (!leaseRef.current.owns(token)) {
        return;
      }
      setErrorCode(toErrorCode(err));
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const lease = leaseRef.current;
    if (samples.length > 0) {
      void loadBundledSample(samples[0]!);
    }
    return () => {
      lease.revoke();
    };
  }, [samples, loadBundledSample]);

  const effectiveSelectedId = useMemo(() => {
    if (!study) return '';
    return resolveSelectedId(study, selectedId);
  }, [study, selectedId]);

  const selectedSummary = useMemo(() => {
    if (!study || !effectiveSelectedId) return null;
    return getSelectedRowSummary(study, effectiveSelectedId);
  }, [study, effectiveSelectedId]);

  const filteredRowIndices = useMemo(() => {
    if (!study) return [];
    const q = searchQuery.trim();
    const rowIds = study.input.row_ids;
    const indices: number[] = [];
    for (let i = 0; i < rowIds.length; i++) {
      if (q.length === 0 || rowIds[i]!.includes(q)) {
        indices.push(i);
      }
    }
    return indices;
  }, [study, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredRowIndices.length / PAGE_SIZE));
  const clampedPage = Math.min(currentPage, totalPages - 1);

  const pageRowIndices = useMemo(() => {
    const start = clampedPage * PAGE_SIZE;
    return filteredRowIndices.slice(start, start + PAGE_SIZE);
  }, [filteredRowIndices, clampedPage]);

  const handleSelectRecord = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) {
        void importUserFile(file);
      }
    },
    [importUserFile],
  );

  const handleDownloadJson = useCallback(() => {
    if (!study) return;
    const payload = acceptedJsonText || JSON.stringify(study, null, 2);
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'neighborhood-projection-study.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [study, acceptedJsonText]);

  const toggleCategory = useCallback((key: keyof CategoryVisibility) => {
    setVisible((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  return (
    <div className="folio-Shell">
      <header className="folio-TopBar">
        <div className="folio-BrandBlock">
          <h1 className="folio-AppTitle">{t.appTitle}</h1>
          <p className="folio-AppSubtitle">{t.subtitle}</p>
        </div>

        <div className="folio-ActionsBar">
          {provenance && (
            <span
              className={`folio-ProvenanceBadge ${
                provenance.kind === 'IMPORTED_ANALYSIS_UNVERIFIED'
                  ? 'is-unverified'
                  : 'is-bundled'
              }`}
              data-testid="study-provenance"
            >
              {provenance.kind === 'IMPORTED_ANALYSIS_UNVERIFIED'
                ? t.provenanceImported
                : t.provenanceBundled}
            </span>
          )}

          {samples.length > 0 && (
            <div className="folio-SampleGroup" role="group" aria-label={t.samplesLabel}>
              <span className="folio-ControlLabel">{t.samplesLabel}</span>
              {samples.map((s) => {
                const isCurrent =
                  provenance?.kind === 'BUNDLED_SYNTHETIC_SAMPLE' &&
                  provenance.sampleId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`folio-btn folio-btn-sm ${isCurrent ? 'is-active' : ''}`}
                    aria-pressed={isCurrent}
                    onClick={() => {
                      void loadBundledSample(s);
                    }}
                  >
                    {s.labels[locale]}
                  </button>
                );
              })}
            </div>
          )}

          <input
            ref={fileInputRef}
            id={fileInputId}
            type="file"
            accept=".json,application/json"
            className="folio-FileInputHidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            className="folio-btn folio-btn-primary"
            onClick={() => fileInputRef.current?.click()}
          >
            {t.openStudyBtn}
          </button>

          {study && (
            <button
              type="button"
              className="folio-btn"
              onClick={handleDownloadJson}
            >
              {t.exportJsonBtn}
            </button>
          )}

          <div className="folio-LocaleSwitch" role="group" aria-label="Language / Idioma">
            <button
              type="button"
              className={`folio-btn folio-btn-sm ${locale === 'pt-BR' ? 'is-active' : ''}`}
              aria-pressed={locale === 'pt-BR'}
              onClick={() => setLocale('pt-BR')}
            >
              PT-BR
            </button>
            <button
              type="button"
              className={`folio-btn folio-btn-sm ${locale === 'en' ? 'is-active' : ''}`}
              aria-pressed={locale === 'en'}
              onClick={() => setLocale('en')}
            >
              EN
            </button>
          </div>
        </div>
      </header>

      {isLoading && (
        <div className="folio-StatusBanner is-loading" role="status" aria-live="polite">
          <span>{t.loadingStatus}</span>
        </div>
      )}

      {errorCode && (
        <div
          className="folio-StatusBanner is-error"
          role="alert"
          data-testid="import-error-banner"
        >
          <div className="folio-ErrorTextGroup">
            <strong>[{errorCode}]</strong> <span>{t.errors[errorCode]}</span>
            {study && <span className="folio-ErrorPreserved"> {t.preservedNote}</span>}
          </div>
          <button
            type="button"
            className="folio-btn folio-btn-sm"
            onClick={() => setErrorCode(null)}
          >
            {t.dismissError}
          </button>
        </div>
      )}

      {!study ? (
        <section className="folio-EmptyState" data-testid="empty-study-state">
          <h2 className="folio-SectionTitle">{t.emptyStateTitle}</h2>
          <p className="folio-EmptyCopy">{t.emptyStateBody}</p>
          <button
            type="button"
            className="folio-btn folio-btn-primary"
            onClick={() => fileInputRef.current?.click()}
          >
            {t.openStudyBtn}
          </button>
        </section>
      ) : (
        <>
          <section className="folio-DiagnosticStrip" aria-label={t.diagnosticsLabel}>
            <div className="folio-DiagnosticMetrics">
              <span className="folio-DiagItem">
                <span className="folio-DiagLabel">{t.diagRecords}:</span>{' '}
                <strong className="tabular-num">{study.input.row_ids.length}</strong>
              </span>
              <span className="folio-DiagItem">
                <span className="folio-DiagLabel">{t.diagFeatures}:</span>{' '}
                <strong className="tabular-num">{study.input.feature_names.length}</strong>
              </span>
              <span className="folio-DiagItem" title={t.diagKNote}>
                <span className="folio-DiagLabel">{t.diagK}:</span>{' '}
                <strong className="tabular-num">{study.plan.k}</strong>
              </span>
              <span className="folio-DiagItem">
                <span className="folio-DiagLabel">{t.diagRetention}:</span>{' '}
                {study.neighborhood.retention_fraction ? (
                  <strong className="tabular-num">
                    {study.neighborhood.retention_fraction.numerator}/
                    {study.neighborhood.retention_fraction.denominator} (
                    {formatFractionPercent(study.neighborhood.retention_fraction)})
                  </strong>
                ) : (
                  <strong>{t.diagConstantUnavailable}</strong>
                )}
              </span>
              <span className="folio-DiagItem">
                <span className="folio-DiagLabel">{t.diagTrustworthiness}:</span>{' '}
                {study.neighborhood.trustworthiness_fraction ? (
                  <strong className="tabular-num">
                    {study.neighborhood.trustworthiness_fraction.numerator}/
                    {study.neighborhood.trustworthiness_fraction.denominator} (
                    {formatFractionDecimal(study.neighborhood.trustworthiness_fraction)})
                  </strong>
                ) : (
                  <strong>{t.diagConstantUnavailable}</strong>
                )}
              </span>
              <span className="folio-DiagItem">
                <span className="folio-DiagLabel">{t.diagVariance}:</span>{' '}
                {study.pca.retained_variance_fraction !== null ? (
                  <strong className="tabular-num">
                    {(study.pca.retained_variance_fraction * 100).toFixed(2)}%
                  </strong>
                ) : (
                  <strong>{t.diagConstantUnavailable}</strong>
                )}
              </span>
              <span className="folio-DiagItem">
                <span className="folio-DiagLabel">{t.diagTauScreen}:</span>{' '}
                <strong className="tabular-num">
                  {study.pca.rank_screen_count}/{study.pca.singular_values.length}
                </strong>
              </span>
            </div>

            <div className="folio-DiagnosticFlags">
              <span className="folio-DiagLabel">{t.diagFlagsLabel}</span>
              {study.pca.flags.length === 0 ? (
                <span className="folio-FlagClean">{t.diagNoFlags}</span>
              ) : (
                <ul className="folio-FlagList">
                  {study.pca.flags.map((flag) => (
                    <li key={flag} className="folio-FlagBadge">
                      {t.flagDescriptions[flag]}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <div className="folio-Workspace">
            <main className="folio-PlotColumn">
              <div className="folio-LayerLegendBar" role="group" aria-label={t.filterLabel}>
                <span className="folio-ControlLabel">{t.filterLabel}</span>
                <button
                  type="button"
                  className={`folio-LayerToggle is-retained ${visible.retained ? 'is-on' : 'is-off'}`}
                  aria-pressed={visible.retained}
                  onClick={() => toggleCategory('retained')}
                >
                  <span className="layer-symbol" aria-hidden="true">
                    ●───
                  </span>
                  <span>{t.filterRetained}</span>
                </button>
                <button
                  type="button"
                  className={`folio-LayerToggle is-lost ${visible.lost ? 'is-on' : 'is-off'}`}
                  aria-pressed={visible.lost}
                  onClick={() => toggleCategory('lost')}
                >
                  <span className="layer-symbol" aria-hidden="true">
                    □ - - -
                  </span>
                  <span>{t.filterLost}</span>
                </button>
                <button
                  type="button"
                  className={`folio-LayerToggle is-introduced ${visible.introduced ? 'is-on' : 'is-off'}`}
                  aria-pressed={visible.introduced}
                  onClick={() => toggleCategory('introduced')}
                >
                  <span className="layer-symbol" aria-hidden="true">
                    ◆ — · —
                  </span>
                  <span>{t.filterIntroduced}</span>
                </button>
              </div>

              <ProjectionScene
                study={study}
                selectedId={effectiveSelectedId}
                onSelect={handleSelectRecord}
                visible={visible}
                locale={locale}
                force2D={force2D}
              />
            </main>

            <aside className="folio-MarginColumn" aria-label={t.marginTitle}>
              {selectedSummary && (
                <div className="folio-InspectorCard">
                  <div className="folio-SelectedHeader">
                    <div>
                      <span className="folio-MarginLabel">{t.marginTitle}</span>
                      <h2 className="folio-SelectedId mono-id" data-testid="selected-record-id">
                        {selectedSummary.id}
                      </h2>
                    </div>
                    {selectedSummary.receipt && (
                      <div className="folio-SelectedQuickStats tabular-num">
                        <span className="folio-StatPill">
                          {t.colRetainedCount}: {selectedSummary.receipt.retained_count}/
                          {study.plan.k}
                        </span>
                        <span className="folio-StatPill">
                          {t.colPenalty}: {selectedSummary.receipt.penalty}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="folio-SectionBlock">
                    <h3 className="folio-Subheading">{t.marginCoordinates}</h3>
                    <div className="folio-CoordGrid tabular-num">
                      <div className="folio-CoordCell">
                        <span className="coord-axis">PC1</span>
                        <strong>{formatNumber(selectedSummary.scores3[0], 4)}</strong>
                      </div>
                      <div className="folio-CoordCell">
                        <span className="coord-axis">PC2</span>
                        <strong>{formatNumber(selectedSummary.scores3[1], 4)}</strong>
                      </div>
                      <div className="folio-CoordCell">
                        <span className="coord-axis">PC3</span>
                        <strong>{formatNumber(selectedSummary.scores3[2], 4)}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="folio-SectionBlock">
                    <h3 className="folio-Subheading">{t.marginFeaturesTitle}</h3>
                    <dl className="folio-FeatureList tabular-num">
                      {selectedSummary.featureValues.map((fv) => (
                        <div key={fv.name} className="folio-FeatureRow">
                          <dt className="mono-id">{fv.name}</dt>
                          <dd>{formatNumber(fv.value, 4)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  {study.neighborhood.state === 'UNAVAILABLE_CONSTANT_INPUT' ? (
                    <div className="folio-SectionBlock">
                      <p className="folio-ConstantNote">{t.constantReceiptNotice}</p>
                    </div>
                  ) : (
                    <>
                      <div className="folio-SectionBlock">
                        <h3 className="folio-Subheading">{t.marginNeighborsTitle}</h3>
                        <div className="folio-NeighborComparisonGrid">
                          <div className="folio-NeighborCol">
                            <h4 className="folio-ColHeader">{t.marginInputCol}</h4>
                            <ol className="folio-OrderedNeighborList">
                              {selectedSummary.inputNeighbors.map((rel, idx) => (
                                <li key={`in-${rel.id}`} className="folio-NeighborRow">
                                  <span className="neighbor-rank tabular-num">#{idx + 1}</span>
                                  <button
                                    type="button"
                                    className="folio-LinkBtn mono-id"
                                    onClick={() => handleSelectRecord(rel.id)}
                                  >
                                    {rel.id}
                                  </button>
                                  <span className={`cat-tag is-${rel.category.toLowerCase()}`}>
                                    {categorySymbol(rel.category)}{' '}
                                    {t[`cat${rel.category}` as const]}
                                  </span>
                                </li>
                              ))}
                            </ol>
                          </div>

                          <div className="folio-NeighborCol">
                            <h4 className="folio-ColHeader">{t.marginProjectedCol}</h4>
                            <ol className="folio-OrderedNeighborList">
                              {selectedSummary.projectedNeighbors.map((rel, idx) => (
                                <li key={`proj-${rel.id}`} className="folio-NeighborRow">
                                  <span className="neighbor-rank tabular-num">#{idx + 1}</span>
                                  <button
                                    type="button"
                                    className="folio-LinkBtn mono-id"
                                    onClick={() => handleSelectRecord(rel.id)}
                                  >
                                    {rel.id}
                                  </button>
                                  <span className={`cat-tag is-${rel.category.toLowerCase()}`}>
                                    {categorySymbol(rel.category)}{' '}
                                    {t[`cat${rel.category}` as const]}
                                  </span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        </div>
                      </div>

                      <div className="folio-SectionBlock">
                        <h3 className="folio-Subheading">{t.marginUnionTitle}</h3>
                        <div className="folio-TableScroll">
                          <table className="folio-Table tabular-num">
                            <thead>
                              <tr>
                                <th scope="col">{t.colId}</th>
                                <th scope="col">{t.colCategory}</th>
                                <th scope="col">{t.colInRank}</th>
                                <th scope="col">{t.colProjRank}</th>
                                <th scope="col">{t.colInDist}</th>
                                <th scope="col">{t.colProjDist}</th>
                                <th scope="col">{t.colPenalty}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedSummary.relations.map((rel) => (
                                <tr key={rel.id}>
                                  <td>
                                    <button
                                      type="button"
                                      className="folio-LinkBtn mono-id"
                                      onClick={() => handleSelectRecord(rel.id)}
                                    >
                                      {rel.id}
                                    </button>
                                  </td>
                                  <td>
                                    <span className={`cat-tag is-${rel.category.toLowerCase()}`}>
                                      {categorySymbol(rel.category)}{' '}
                                      {t[`cat${rel.category}` as const]}
                                    </span>
                                  </td>
                                  <td>{rel.input_rank}</td>
                                  <td>{rel.projected_rank}</td>
                                  <td>{formatNumber(rel.input_distance, 3)}</td>
                                  <td>{formatNumber(rel.projected_distance, 3)}</td>
                                  <td>{rel.penalty > 0 ? `+${rel.penalty}` : '0'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </aside>
          </div>

          <section className="folio-LowerDeck" aria-label={t.recordListTitle}>
            <div className="folio-CatalogueHeader">
              <h2 className="folio-SectionTitle">{t.recordListTitle}</h2>
              <div className="folio-SearchControls">
                <label htmlFor={searchInputId} className="folio-ControlLabel">
                  {t.colId}:
                </label>
                <input
                  id={searchInputId}
                  type="search"
                  className="folio-SearchInput"
                  placeholder={t.searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(0);
                  }}
                />
                {searchQuery.length > 0 && (
                  <button
                    type="button"
                    className="folio-btn folio-btn-sm"
                    onClick={() => {
                      setSearchQuery('');
                      setCurrentPage(0);
                    }}
                  >
                    {t.searchClear}
                  </button>
                )}
              </div>

              <div className="folio-PaginationControls tabular-num">
                <span className="folio-PageInfo">
                  {t.showingRecords} {filteredRowIndices.length} {t.ofRecords}{' '}
                  {study.input.row_ids.length} · {t.pageLabel} {clampedPage + 1}/{totalPages}
                </span>
                <button
                  type="button"
                  className="folio-btn folio-btn-sm"
                  disabled={clampedPage <= 0}
                  onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                >
                  {t.prevPage}
                </button>
                <button
                  type="button"
                  className="folio-btn folio-btn-sm"
                  disabled={clampedPage >= totalPages - 1}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                >
                  {t.nextPage}
                </button>
              </div>
            </div>

            <div className="folio-TableScroll">
              <table className="folio-Table folio-CatalogueTable tabular-num">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">{t.colId}</th>
                    <th scope="col">PC1</th>
                    <th scope="col">PC2</th>
                    <th scope="col">PC3</th>
                    <th scope="col">{t.colRetainedCount}</th>
                    <th scope="col">{t.colPenalty}</th>
                    <th scope="col">{t.selectAction}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRowIndices.map((rowIndex) => {
                    const id = study.input.row_ids[rowIndex]!;
                    const sc = study.pca.scores3[rowIndex]!;
                    const rec =
                      study.neighborhood.state === 'AVAILABLE'
                        ? study.neighborhood.receipts[rowIndex]
                        : null;
                    const isSel = id === effectiveSelectedId;
                    return (
                      <tr
                        key={id}
                        className={isSel ? 'is-selected-row' : ''}
                        aria-current={isSel ? 'true' : undefined}
                      >
                        <td>{rowIndex}</td>
                        <td className="mono-id">{id}</td>
                        <td>{formatNumber(sc[0], 4)}</td>
                        <td>{formatNumber(sc[1], 4)}</td>
                        <td>{formatNumber(sc[2], 4)}</td>
                        <td>{rec ? `${rec.retained_count}/${study.plan.k}` : '—'}</td>
                        <td>{rec ? rec.penalty : '—'}</td>
                        <td>
                          <button
                            type="button"
                            className={`folio-btn folio-btn-sm ${isSel ? 'is-active' : ''}`}
                            aria-pressed={isSel}
                            onClick={() => handleSelectRecord(id)}
                          >
                            {isSel ? t.selectedAction : t.selectAction}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <footer className="folio-MethodNote">
            <h3 className="folio-Subheading">{t.methodTitle}</h3>
            <ul className="folio-MethodList">
              <li>{t.methodRetention}</li>
              <li>{t.methodTrust}</li>
              <li>{t.methodVariance}</li>
              <li>{t.methodProvenance}</li>
            </ul>
          </footer>
        </>
      )}
    </div>
  );
}

export default App;
