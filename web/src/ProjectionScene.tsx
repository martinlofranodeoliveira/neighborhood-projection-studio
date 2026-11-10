import React, {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import { Canvas, type ThreeEvent, useThree } from '@react-three/fiber';
import type { Locale, RelationCategory, Study } from './study';
import {
  buildIdIndexMap,
  type CategoryVisibility,
  computeAxisRanges,
  displayPositions,
  findCoincidentIds,
  formatNumber,
  type RelationLineSegment,
  selectedRelationLines,
} from './view';

export interface ProjectionSceneProps {
  readonly study: Study;
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
  readonly visible: CategoryVisibility;
  readonly locale: Locale;
  readonly force2D?: boolean;
}

interface CameraPose {
  readonly azimuth: number;
  readonly elevation: number;
  readonly distance: number;
}

const INITIAL_CAMERA_POSE: CameraPose = Object.freeze({
  azimuth: 0.62,
  elevation: 0.42,
  distance: 3.4,
});

const MAX_DRAWING_PIXELS = 4194304;

const COLOR_SELECTED = '#1d4ed8';
const COLOR_RETAINED = '#15803d';
const COLOR_LOST = '#52525b';
const COLOR_INTRODUCED = '#b45309';
const COLOR_DEFAULT_POINT = '#64748b';
const COLOR_GRID_BOX = '#cbd5e1';

const SCENE_TEXT = {
  'pt-BR': {
    plotTitle3D: 'Campo de projeção 3D (PC1 · PC2 · PC3)',
    plotTitle2D: 'Folha de projeção ortográfica 2D (PC1 × PC2)',
    mode3D: 'Vista 3D',
    mode2D: 'Vista 2D (PC1 × PC2)',
    viewModeLabel: 'Modo de projeção',
    cameraStepLabel: 'Controles incrementais da câmera 3D',
    cameraOptIn: 'Explorar câmera 3D',
    cameraExit: 'Sair da câmera (Esc)',
    cameraHintActive:
      'Modo câmera ativo: arraste para girar, roda para zoom, Esc ou desfocar para sair.',
    cameraHintIdle:
      'Seleção direta de pontos ativa. Ative a câmera ou use os botões para girar o campo.',
    rotateLeft: 'Girar à esquerda',
    rotateRight: 'Girar à direita',
    tiltUp: 'Inclinar para cima',
    tiltDown: 'Inclinar para baixo',
    zoomIn: 'Aproximar',
    zoomOut: 'Afastar',
    resetCamera: 'Enquadramento padrão',
    note2D:
      'A vista 2D projeta PC1 × PC2 apenas para leitura; vizinhanças, postos e métricas permanecem avaliados no subespaço 3D (PC1–PC3).',
    fallbackNotice:
      'WebGL indisponível ou interrompido neste ambiente. Exibindo a folha ortográfica 2D com seleção completa.',
    retry3D: 'Tentar vista 3D novamente',
    constantTitle: 'Entrada constante — dispersão espacial ocultada',
    constantBody:
      'Todas as linhas de entrada possuem valores idênticos em todos os atributos (CONSTANT_INPUT / UNAVAILABLE_CONSTANT_INPUT). Não há variação geométrica real para projetar; selecione qualquer registro abaixo para inspecionar seus valores originais.',
    coincidentLabel: 'Registros coincidentes nesta coordenada projetada:',
    coincidentMore: 'Os demais registros coincidentes continuam disponíveis no catálogo paginado abaixo.',
    axisScaleNote:
      'Geometria normalizada uniformemente em binary64 para exibição; limites canônicos observados:',
    categoryRetained: 'Retido',
    categoryLost: 'Perdido',
    categoryIntroduced: 'Introduzido',
    selectedTag: 'Selecionado',
    svgAriaLabel: 'Gráfico de dispersão ortográfica PC1 por PC2',
    SelectRecordAria: 'Selecionar registro',
  },
  en: {
    plotTitle3D: '3D Projection Field (PC1 · PC2 · PC3)',
    plotTitle2D: '2D Orthographic Survey Sheet (PC1 × PC2)',
    mode3D: '3D View',
    mode2D: '2D View (PC1 × PC2)',
    viewModeLabel: 'Projection view mode',
    cameraStepLabel: '3D camera step controls',
    cameraOptIn: 'Explore 3D camera',
    cameraExit: 'Exit camera (Esc)',
    cameraHintActive:
      'Camera mode active: drag to orbit, wheel to zoom, press Esc or blur to exit.',
    cameraHintIdle:
      'Direct point picking active. Enable camera mode or use step buttons to rotate field.',
    rotateLeft: 'Rotate left',
    rotateRight: 'Rotate right',
    tiltUp: 'Tilt up',
    tiltDown: 'Tilt down',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    resetCamera: 'Reset framing',
    note2D:
      'The 2D view plots PC1 × PC2 for reading only; neighborhoods, ranks, and metrics remain evaluated in the 3D subspace (PC1–PC3).',
    fallbackNotice:
      'WebGL is unavailable or was interrupted in this environment. Showing the 2D orthographic survey sheet with full selection.',
    retry3D: 'Retry 3D view',
    constantTitle: 'Constant input — spatial scatter hidden',
    constantBody:
      'All input rows have identical values across every feature (CONSTANT_INPUT / UNAVAILABLE_CONSTANT_INPUT). There is no true geometric variation to plot; select any record below to inspect its original values.',
    coincidentLabel: 'Coincident records at this projected coordinate:',
    coincidentMore: 'The remaining coincident records are available in the paginated catalogue below.',
    axisScaleNote:
      'Geometry uniformly normalized in binary64 for display; observed canonical bounds:',
    categoryRetained: 'Retained',
    categoryLost: 'Lost',
    categoryIntroduced: 'Introduced',
    selectedTag: 'Selected',
    svgAriaLabel: 'Orthographic scatter plot of PC1 by PC2',
    SelectRecordAria: 'Select record',
  },
} as const;

function checkWebGLSupport(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof ResizeObserver === 'undefined' ||
    typeof WebGLRenderingContext === 'undefined'
  ) {
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return Boolean(ctx);
  } catch {
    return false;
  }
}

export function computeBoundedDpr(
  width: number,
  height: number,
  rawDpr: number,
): number {
  const base = Number.isFinite(rawDpr) && rawDpr > 0 ? Math.min(2, rawDpr) : 1;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return base;
  }
  const maxByBudget = Math.sqrt(MAX_DRAWING_PIXELS) / Math.sqrt(width) / Math.sqrt(height);
  return Math.min(base, maxByBudget);
}

function buildPatternedLineBuffer(
  segments: readonly RelationLineSegment[],
  category: RelationCategory,
): Float32Array {
  const matching = segments.filter((s) => s.category === category);
  if (matching.length === 0) {
    return new Float32Array(0);
  }
  if (category === 'RETAINED') {
    const coords = new Float32Array(matching.length * 6);
    for (let i = 0; i < matching.length; i++) {
      const seg = matching[i]!;
      const base = i * 6;
      coords[base] = seg.from[0];
      coords[base + 1] = seg.from[1];
      coords[base + 2] = seg.from[2];
      coords[base + 3] = seg.to[0];
      coords[base + 4] = seg.to[1];
      coords[base + 5] = seg.to[2];
    }
    return coords;
  }

  const stepCount = category === 'LOST' ? 9 : 11;
  const pieces: number[] = [];
  for (let i = 0; i < matching.length; i++) {
    const seg = matching[i]!;
    const dx = seg.to[0] - seg.from[0];
    const dy = seg.to[1] - seg.from[1];
    const dz = seg.to[2] - seg.from[2];
    for (let s = 0; s < stepCount; s += 2) {
      const t0 = s / stepCount;
      const t1 = Math.min(1, (s + 1) / stepCount);
      pieces.push(
        seg.from[0] + dx * t0,
        seg.from[1] + dy * t0,
        seg.from[2] + dz * t0,
        seg.from[0] + dx * t1,
        seg.from[1] + dy * t1,
        seg.from[2] + dz * t1,
      );
    }
  }
  return new Float32Array(pieces);
}

function buildWireframeBoxPositions(halfExtent = 1.04): Float32Array {
  const h = halfExtent;
  const corners: readonly (readonly [number, number, number])[] = [
    [-h, -h, -h],
    [h, -h, -h],
    [h, h, -h],
    [-h, h, -h],
    [-h, -h, h],
    [h, -h, h],
    [h, h, h],
    [-h, h, h],
  ];
  const edges: readonly (readonly [number, number])[] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const out = new Float32Array(edges.length * 6);
  for (let i = 0; i < edges.length; i++) {
    const [a, b] = edges[i]!;
    const ca = corners[a]!;
    const cb = corners[b]!;
    const base = i * 6;
    out[base] = ca[0];
    out[base + 1] = ca[1];
    out[base + 2] = ca[2];
    out[base + 3] = cb[0];
    out[base + 4] = cb[1];
    out[base + 5] = cb[2];
  }
  return out;
}

interface SceneErrorBoundaryProps {
  readonly onError: () => void;
  readonly children: React.ReactNode;
}

interface SceneErrorBoundaryState {
  readonly hasError: boolean;
}

class SceneErrorBoundary extends Component<
  SceneErrorBoundaryProps,
  SceneErrorBoundaryState
> {
  constructor(props: SceneErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): SceneErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(): void {
    this.props.onError();
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

interface ThreeProjectionContentProps {
  readonly rowIds: readonly string[];
  readonly positions: readonly (readonly [number, number, number])[];
  readonly selectedIndex: number;
  readonly segments: readonly RelationLineSegment[];
  readonly cameraPose: CameraPose;
  readonly dragMovedRef: React.RefObject<boolean>;
  readonly onSelect: (id: string) => void;
}

function ThreeProjectionContent({
  rowIds,
  positions,
  selectedIndex,
  segments,
  cameraPose,
  dragMovedRef,
  onSelect,
}: ThreeProjectionContentProps): React.JSX.Element {
  const { camera, size, invalidate } = useThree();

  useLayoutEffect(() => {
    const width = size.width;
    const height = size.height;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return;
    }
    const aspect = width / height;
    if (!Number.isFinite(aspect) || aspect <= 0) {
      return;
    }
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = aspect;
      camera.near = 0.05;
      camera.far = 50;
    }
    const aspectScale = aspect < 1 ? 1 / Math.max(0.45, aspect) : 1;
    const r = cameraPose.distance * aspectScale;
    const cosElev = Math.cos(cameraPose.elevation);
    const x = r * cosElev * Math.sin(cameraPose.azimuth);
    const y = r * Math.sin(cameraPose.elevation);
    const z = r * cosElev * Math.cos(cameraPose.azimuth);

    camera.position.set(x, y, z);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, cameraPose, invalidate]);

  const frameBoxLine = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(buildWireframeBoxPositions(1.05), 3));
    geom.computeBoundingSphere();
    const mat = new THREE.LineBasicMaterial({ color: COLOR_GRID_BOX });
    return new THREE.LineSegments(geom, mat);
  }, []);

  useEffect(() => {
    return () => {
      frameBoxLine.geometry.dispose();
      (frameBoxLine.material as THREE.Material).dispose();
    };
  }, [frameBoxLine]);

  const instancedPointsMesh = useMemo(() => {
    const count = Math.max(1, rowIds.length);
    const geom = new THREE.SphereGeometry(0.032, 12, 10);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const mesh = new THREE.InstancedMesh(geom, mat, count);
    mesh.count = rowIds.length;
    mesh.frustumCulled = false;
    return mesh;
  }, [rowIds.length]);

  useEffect(() => {
    return () => {
      instancedPointsMesh.geometry.dispose();
      (instancedPointsMesh.material as THREE.Material).dispose();
    };
  }, [instancedPointsMesh]);

  useLayoutEffect(() => {
    const n = rowIds.length;
    instancedPointsMesh.count = n;

    const categoryByIndex = new Map<number, RelationCategory>();
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      categoryByIndex.set(seg.targetIndex, seg.category);
    }

    const dummyMatrix = new THREE.Matrix4();
    const positionVec = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scaleVec = new THREE.Vector3();
    const color = new THREE.Color();

    for (let i = 0; i < n; i++) {
      const pos = positions[i] ?? [0, 0, 0];
      positionVec.set(pos[0], pos[1], pos[2]);

      let pointScale = 1.0;
      if (i === selectedIndex) {
        color.set(COLOR_SELECTED);
        pointScale = 1.75;
      } else {
        const relCat = categoryByIndex.get(i);
        if (relCat === 'RETAINED') {
          color.set(COLOR_RETAINED);
          pointScale = 1.35;
        } else if (relCat === 'INTRODUCED') {
          color.set(COLOR_INTRODUCED);
          pointScale = 1.35;
        } else if (relCat === 'LOST') {
          color.set(COLOR_LOST);
          pointScale = 1.25;
        } else {
          color.set(COLOR_DEFAULT_POINT);
          pointScale = 0.92;
        }
      }

      scaleVec.set(pointScale, pointScale, pointScale);
      dummyMatrix.compose(positionVec, quaternion, scaleVec);
      instancedPointsMesh.setMatrixAt(i, dummyMatrix);
      instancedPointsMesh.setColorAt(i, color);
    }

    instancedPointsMesh.instanceMatrix.needsUpdate = true;
    if (instancedPointsMesh.instanceColor) {
      instancedPointsMesh.instanceColor.needsUpdate = true;
    }
    instancedPointsMesh.computeBoundingSphere();
    invalidate();
  }, [instancedPointsMesh, rowIds, positions, selectedIndex, segments, invalidate]);

  const relationLinesGroup = useMemo(() => {
    const group = new THREE.Group();

    const addCategoryLines = (cat: RelationCategory, hexColor: string) => {
      const coords = buildPatternedLineBuffer(segments, cat);
      if (coords.length === 0) {
        return;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(coords, 3));
      geom.computeBoundingSphere();
      const mat = new THREE.LineBasicMaterial({ color: hexColor });
      group.add(new THREE.LineSegments(geom, mat));
    };

    addCategoryLines('RETAINED', COLOR_RETAINED);
    addCategoryLines('LOST', COLOR_LOST);
    addCategoryLines('INTRODUCED', COLOR_INTRODUCED);
    return group;
  }, [segments]);

  useEffect(() => {
    invalidate();
    return () => {
      for (let i = 0; i < relationLinesGroup.children.length; i++) {
        const child = relationLinesGroup.children[i];
        if (child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      }
    };
  }, [relationLinesGroup, invalidate]);

  const handleInstanceClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      if (dragMovedRef.current) {
        return;
      }
      const idx = event.instanceId;
      if (typeof idx === 'number' && idx >= 0 && idx < rowIds.length) {
        const targetId = rowIds[idx];
        if (targetId !== undefined) {
          onSelect(targetId);
        }
      }
    },
    [dragMovedRef, onSelect, rowIds],
  );

  return (
    <group>
      <primitive object={frameBoxLine} />
      <primitive object={relationLinesGroup} />
      <primitive object={instancedPointsMesh} onClick={handleInstanceClick} />
    </group>
  );
}

export function ProjectionScene({
  study,
  selectedId,
  onSelect,
  visible,
  locale,
  force2D = false,
}: ProjectionSceneProps): React.JSX.Element {
  const t = SCENE_TEXT[locale];
  const isConstant = study.pca.signal_state === 'CONSTANT_INPUT';

  const [webglSupported, setWebglSupported] = useState<boolean>(() =>
    force2D ? false : checkWebGLSupport(),
  );
  const [renderFailed, setRenderFailed] = useState<boolean>(false);
  const [userPrefer2D, setUserPrefer2D] = useState<boolean>(false);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraPose, setCameraPose] = useState<CameraPose>(INITIAL_CAMERA_POSE);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: 800,
    height: 540,
  });

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragMovedRef = useRef<boolean>(false);
  const cleanupCanvasListenersRef = useRef<(() => void) | null>(null);

  const effectiveMode: '2d' | '3d' =
    force2D || userPrefer2D || !webglSupported || renderFailed ? '2d' : '3d';

  const rowIds = study.input.row_ids;
  const idIndexMap = useMemo(() => buildIdIndexMap(rowIds), [rowIds]);
  const selectedIndex = idIndexMap.get(selectedId) ?? 0;

  const positions = useMemo(
    () => displayPositions(study.pca.scores3, 2.0),
    [study.pca.scores3],
  );

  const segments = useMemo(
    () => selectedRelationLines(study, selectedId, positions, visible),
    [study, selectedId, positions, visible],
  );

  const axisRanges = useMemo(
    () => computeAxisRanges(study.pca.scores3),
    [study.pca.scores3],
  );

  const coincidentIds = useMemo(
    () => findCoincidentIds(study, selectedId, effectiveMode),
    [study, selectedId, effectiveMode],
  );

  useEffect(() => {
    if (effectiveMode !== '3d' && cameraActive) {
      setCameraActive(false);
    }
  }, [effectiveMode, cameraActive]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      for (let i = 0; i < entries.length; i++) {
        const rect = entries[i]!.contentRect;
        if (rect.width > 0 && rect.height > 0) {
          setViewportSize({ width: rect.width, height: rect.height });
        }
      }
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (cleanupCanvasListenersRef.current) {
        cleanupCanvasListenersRef.current();
        cleanupCanvasListenersRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const container = viewportRef.current;
    if (!container || !cameraActive || effectiveMode !== '3d' || isConstant) {
      return;
    }

    let activePointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;

    const previousTouchAction = container.style.touchAction;
    const previousCursor = container.style.cursor;
    container.style.touchAction = 'none';
    container.style.cursor = 'grab';

    const releaseCaptureSafely = (pid: number | null) => {
      if (pid === null) return;
      try {
        if (typeof container.hasPointerCapture === 'function' && container.hasPointerCapture(pid)) {
          container.releasePointerCapture(pid);
        }
      } catch {
        // Ignore capture release errors on detached nodes
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      activePointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      lastX = e.clientX;
      lastY = e.clientY;
      dragMovedRef.current = false;
      container.style.cursor = 'grabbing';
      try {
        if (typeof container.setPointerCapture === 'function') {
          container.setPointerCapture(e.pointerId);
        }
      } catch {
        // Ignore if synthetic event does not support pointer capture
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (activePointerId === null || e.pointerId !== activePointerId) return;
      const totalDx = e.clientX - startX;
      const totalDy = e.clientY - startY;
      if (Math.hypot(totalDx, totalDy) > 4) {
        dragMovedRef.current = true;
      }
      const stepDx = e.clientX - lastX;
      const stepDy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      setCameraPose((prev) => ({
        azimuth: prev.azimuth - stepDx * 0.0085,
        elevation: Math.max(-1.35, Math.min(1.35, prev.elevation + stepDy * 0.0085)),
        distance: prev.distance,
      }));
    };

    const onPointerUpOrCancel = (e: PointerEvent) => {
      if (activePointerId !== null && e.pointerId === activePointerId) {
        releaseCaptureSafely(activePointerId);
        activePointerId = null;
        container.style.cursor = 'grab';
        window.setTimeout(() => {
          dragMovedRef.current = false;
        }, 0);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.24 : -0.24;
      setCameraPose((prev) => ({
        ...prev,
        distance: Math.max(1.8, Math.min(8.0, prev.distance + delta)),
      }));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setCameraActive(false);
      }
    };

    const onWindowBlur = () => {
      setCameraActive(false);
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUpOrCancel);
    container.addEventListener('pointercancel', onPointerUpOrCancel);
    container.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onWindowBlur);

    return () => {
      releaseCaptureSafely(activePointerId);
      activePointerId = null;
      dragMovedRef.current = false;
      container.style.touchAction = previousTouchAction;
      container.style.cursor = previousCursor;
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUpOrCancel);
      container.removeEventListener('pointercancel', onPointerUpOrCancel);
      container.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [cameraActive, effectiveMode, isConstant]);

  const adjustCamera = useCallback((dAzimuth: number, dElevation: number, dDistance: number) => {
    setCameraPose((prev) => ({
      azimuth: prev.azimuth + dAzimuth,
      elevation: Math.max(-1.35, Math.min(1.35, prev.elevation + dElevation)),
      distance: Math.max(1.8, Math.min(8.0, prev.distance + dDistance)),
    }));
  }, []);

  const handleRetry3D = useCallback(() => {
    const ok = checkWebGLSupport();
    setWebglSupported(ok);
    setRenderFailed(false);
    if (ok) {
      setUserPrefer2D(false);
    }
  }, []);

  const boundedDpr = useMemo(() => {
    const raw = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    return computeBoundedDpr(viewportSize.width, viewportSize.height, raw);
  }, [viewportSize.width, viewportSize.height]);

  const categoryRelationMap = useMemo(() => {
    const map = new Map<string, RelationCategory>();
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      map.set(seg.id, seg.category);
    }
    return map;
  }, [segments]);

  if (isConstant) {
    return (
      <div className="scene-ConstantSheet" data-testid="constant-input-sheet">
        <div className="scene-ConstantHeader">
          <h2 className="scene-Title">{t.constantTitle}</h2>
          <p className="scene-ConstantCopy">{t.constantBody}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="scene-Container">
      <div className="scene-ControlBar">
        <div className="scene-HeadingGroup">
          <h2 className="scene-Title">
            {effectiveMode === '3d' ? t.plotTitle3D : t.plotTitle2D}
          </h2>
          {!force2D && (
            <div className="scene-ModeSwitch" role="group" aria-label={t.viewModeLabel}>
              <button
                type="button"
                className={`folio-btn folio-btn-sm ${effectiveMode === '3d' ? 'is-active' : ''}`}
                aria-pressed={effectiveMode === '3d'}
                disabled={!webglSupported || renderFailed}
                onClick={() => setUserPrefer2D(false)}
              >
                {t.mode3D}
              </button>
              <button
                type="button"
                className={`folio-btn folio-btn-sm ${effectiveMode === '2d' ? 'is-active' : ''}`}
                aria-pressed={effectiveMode === '2d'}
                onClick={() => {
                  setCameraActive(false);
                  setUserPrefer2D(true);
                }}
              >
                {t.mode2D}
              </button>
            </div>
          )}
        </div>

        {effectiveMode === '3d' && (
          <div className="scene-CameraToolbar">
            <button
              type="button"
              className={`folio-btn folio-btn-sm ${cameraActive ? 'is-camera-active' : ''}`}
              aria-pressed={cameraActive}
              onClick={() => setCameraActive((prev) => !prev)}
            >
              {cameraActive ? t.cameraExit : t.cameraOptIn}
            </button>
            <div className="scene-StepButtons" role="group" aria-label={t.cameraStepLabel}>
              <button
                type="button"
                className="folio-btn folio-btn-icon"
                title={t.rotateLeft}
                aria-label={t.rotateLeft}
                onClick={() => adjustCamera(-0.22, 0, 0)}
              >
                ↺
              </button>
              <button
                type="button"
                className="folio-btn folio-btn-icon"
                title={t.rotateRight}
                aria-label={t.rotateRight}
                onClick={() => adjustCamera(0.22, 0, 0)}
              >
                ↻
              </button>
              <button
                type="button"
                className="folio-btn folio-btn-icon"
                title={t.tiltUp}
                aria-label={t.tiltUp}
                onClick={() => adjustCamera(0, 0.18, 0)}
              >
                ↑
              </button>
              <button
                type="button"
                className="folio-btn folio-btn-icon"
                title={t.tiltDown}
                aria-label={t.tiltDown}
                onClick={() => adjustCamera(0, -0.18, 0)}
              >
                ↓
              </button>
              <button
                type="button"
                className="folio-btn folio-btn-icon"
                title={t.zoomIn}
                aria-label={t.zoomIn}
                onClick={() => adjustCamera(0, 0, -0.35)}
              >
                +
              </button>
              <button
                type="button"
                className="folio-btn folio-btn-icon"
                title={t.zoomOut}
                aria-label={t.zoomOut}
                onClick={() => adjustCamera(0, 0, 0.35)}
              >
                −
              </button>
              <button
                type="button"
                className="folio-btn folio-btn-sm"
                onClick={() => setCameraPose(INITIAL_CAMERA_POSE)}
              >
                {t.resetCamera}
              </button>
            </div>
          </div>
        )}
      </div>

      {effectiveMode === '3d' ? (
        <p className="scene-SubtleInstruction" aria-live="polite">
          {cameraActive ? t.cameraHintActive : t.cameraHintIdle}
        </p>
      ) : (
        <p className="scene-SubtleInstruction">{t.note2D}</p>
      )}

      {(!webglSupported || renderFailed) && !force2D && (
        <div className="scene-FallbackBanner" role="status">
          <span>{t.fallbackNotice}</span>
          <button type="button" className="folio-btn folio-btn-sm" onClick={handleRetry3D}>
            {t.retry3D}
          </button>
        </div>
      )}

      <div
        ref={viewportRef}
        className={`scene-Viewport ${cameraActive ? 'is-camera-exploring' : ''}`}
        data-testid="projection-viewport"
      >
        {effectiveMode === '3d' ? (
          <SceneErrorBoundary
            onError={() => {
              setCameraActive(false);
              setRenderFailed(true);
            }}
          >
            <Canvas
              frameloop="demand"
              dpr={boundedDpr}
              camera={{ position: [2.1, 1.4, 2.5], fov: 42, near: 0.05, far: 50 }}
              onCreated={({ gl }) => {
                if (cleanupCanvasListenersRef.current) {
                  cleanupCanvasListenersRef.current();
                }
                const domElement = gl.domElement;
                const onContextLost = (e: Event) => {
                  e.preventDefault();
                  setCameraActive(false);
                  setRenderFailed(true);
                };
                domElement.addEventListener('webglcontextlost', onContextLost);
                cleanupCanvasListenersRef.current = () => {
                  domElement.removeEventListener('webglcontextlost', onContextLost);
                };
              }}
            >
              <ThreeProjectionContent
                rowIds={rowIds}
                positions={positions}
                selectedIndex={selectedIndex}
                segments={segments}
                cameraPose={cameraPose}
                dragMovedRef={dragMovedRef}
                onSelect={onSelect}
              />
            </Canvas>
          </SceneErrorBoundary>
        ) : (
          <svg
            className="scene-Svg2D"
            viewBox="-1.28 -1.28 2.56 2.56"
            role="img"
            aria-label={t.svgAriaLabel}
          >
            <rect
              x="-1.08"
              y="-1.08"
              width="2.16"
              height="2.16"
              fill="#faf9f5"
              stroke="#cbd5e1"
              strokeWidth="0.008"
            />
            <line
              x1="-1.08"
              y1="0"
              x2="1.08"
              y2="0"
              stroke="#e2e8f0"
              strokeWidth="0.006"
            />
            <line
              x1="0"
              y1="-1.08"
              x2="0"
              y2="1.08"
              stroke="#e2e8f0"
              strokeWidth="0.006"
            />
            <text x="0.78" y="1.2" fontSize="0.075" fill="#475569">
              PC1 →
            </text>
            <text x="-1.22" y="-1.12" fontSize="0.075" fill="#475569">
              ↑ PC2
            </text>

            {segments.map((seg) => {
              const x1 = seg.from[0];
              const y1 = -seg.from[1];
              const x2 = seg.to[0];
              const y2 = -seg.to[1];
              const stroke =
                seg.category === 'RETAINED'
                  ? COLOR_RETAINED
                  : seg.category === 'LOST'
                    ? COLOR_LOST
                    : COLOR_INTRODUCED;
              const dash =
                seg.category === 'RETAINED'
                  ? undefined
                  : seg.category === 'LOST'
                    ? '0.045 0.035'
                    : '0.075 0.03 0.02 0.03';
              return (
                <line
                  key={`rel-${seg.category}-${seg.id}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={stroke}
                  strokeWidth="0.015"
                  strokeDasharray={dash}
                />
              );
            })}

            {rowIds.map((id, idx) => {
              const pos = positions[idx] ?? [0, 0, 0];
              const cx = pos[0];
              const cy = -pos[1];
              const isSelected = id === selectedId;
              const relCat = categoryRelationMap.get(id);

              let fill = COLOR_DEFAULT_POINT;
              let radius = 0.034;
              if (isSelected) {
                fill = COLOR_SELECTED;
                radius = 0.055;
              } else if (relCat === 'RETAINED') {
                fill = COLOR_RETAINED;
                radius = 0.044;
              } else if (relCat === 'INTRODUCED') {
                fill = COLOR_INTRODUCED;
                radius = 0.044;
              } else if (relCat === 'LOST') {
                fill = COLOR_LOST;
                radius = 0.04;
              }

              return (
                <g
                  key={id}
                  className="scene-SvgPointGroup"
                  onClick={() => onSelect(id)}
                >
                  {isSelected && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={0.082}
                      fill="none"
                      stroke={COLOR_SELECTED}
                      strokeWidth="0.012"
                    />
                  )}
                  {relCat === 'INTRODUCED' && !isSelected ? (
                    <polygon
                      points={`${cx},${cy - radius * 1.25} ${cx + radius * 1.25},${cy} ${cx},${cy + radius * 1.25} ${cx - radius * 1.25},${cy}`}
                      fill={fill}
                      stroke="#ffffff"
                      strokeWidth="0.008"
                    />
                  ) : relCat === 'LOST' && !isSelected ? (
                    <rect
                      x={cx - radius}
                      y={cy - radius}
                      width={radius * 2}
                      height={radius * 2}
                      fill="#ffffff"
                      stroke={fill}
                      strokeWidth="0.014"
                    />
                  ) : (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={radius}
                      fill={fill}
                      stroke="#ffffff"
                      strokeWidth="0.009"
                    />
                  )}
                  <title>{id}</title>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      <div className="scene-AxisScaleFooter">
        <span className="scene-AxisScaleLabel">{t.axisScaleNote}</span>
        <span className="scene-AxisScaleBadge">
          PC1 [{formatNumber(axisRanges[0].min, 3)}, {formatNumber(axisRanges[0].max, 3)}]
        </span>
        <span className="scene-AxisScaleBadge">
          PC2 [{formatNumber(axisRanges[1].min, 3)}, {formatNumber(axisRanges[1].max, 3)}]
        </span>
        <span className="scene-AxisScaleBadge">
          PC3 [{formatNumber(axisRanges[2].min, 3)}, {formatNumber(axisRanges[2].max, 3)}]
        </span>
      </div>

      {coincidentIds.length > 1 && (
        <div className="scene-CoincidentBar" role="region" aria-label={t.coincidentLabel}>
          <span className="scene-CoincidentTitle">{t.coincidentLabel}</span>
          <div className="scene-CoincidentChips">
            {coincidentIds.slice(0, 16).map((cid) => {
              const active = cid === selectedId;
              return (
                <button
                  key={cid}
                  type="button"
                  className={`scene-RecordChip ${active ? 'is-selected' : ''}`}
                  aria-pressed={active}
                  onClick={() => onSelect(cid)}
                >
                  <span className="mono-id">{cid}</span>
                </button>
              );
            })}
          </div>
          {coincidentIds.length > 16 && (
            <p className="scene-SubtleInstruction">
              16/{coincidentIds.length} · {t.coincidentMore}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default ProjectionScene;
