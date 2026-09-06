import React, {useMemo, useRef, useState} from 'react';
import {geoMercator, geoNaturalEarth1, geoPath} from 'd3-geo';
import type {Feature, FeatureCollection, Geometry} from 'geojson';
import {feature} from 'topojson-client';
import type {GeometryCollection, Topology} from 'topojson-specification';
import chinaAtlas from 'cn-atlas/cn-atlas.json';
import worldAtlas from 'world-atlas/countries-110m.json';
import {
    ComputeClusterNode,
    ComputeResourceGraph,
    ComputeResourceGraphEntity,
    computeNodeState,
    aggregateCommunicationStates,
} from '../../services/ComputeClusterService';

type MapLevel = 'world' | 'china' | 'province';
type MapTransform = {x: number; y: number; scale: number};
type MapMarkerTone = 'healthy' | 'warning';
type MapStatusCounts = Record<MapMarkerTone, number>;
type WorldProperties = {name: string};
type ProvinceProperties = {'地名': string; name: string; id: string};
type MapFeature = Feature<Geometry, WorldProperties | ProvinceProperties>;

interface ClusterGeographicMapProps {
    graph: ComputeResourceGraph | null;
    nodes: ComputeClusterNode[];
    zh: boolean;
}

const WIDTH = 1000;
const HEIGHT = 500;
const IDENTITY: MapTransform = {x: 0, y: 0, scale: 1};
const worldTopology = worldAtlas as unknown as Topology<{countries: GeometryCollection<WorldProperties>}>;
const chinaTopology = chinaAtlas as unknown as Topology<{
    provinces: GeometryCollection<ProvinceProperties>;
    prefectures: GeometryCollection<ProvinceProperties>;
}>;
const worldFeatures = feature<WorldProperties>(
    worldTopology,
    worldTopology.objects.countries,
).features;
const provinceFeatures = feature<ProvinceProperties>(
    chinaTopology,
    chinaTopology.objects.provinces,
).features;
const prefectureFeatures = feature<ProvinceProperties>(
    chinaTopology,
    chinaTopology.objects.prefectures,
).features;
const normalizedRegion = (value: string | null | undefined): string => (value || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/(壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区|省|市)$/u, '');

const displayCountryName = (name: string, zh: boolean): string =>
    zh && name === 'China' ? '中国' : name;

const regionForNode = (
    graph: ComputeResourceGraph | null,
    entity: ComputeResourceGraphEntity,
): ComputeResourceGraphEntity | undefined => {
    if (entity.region_id || entity.region_name) return entity;
    const relation = graph?.relations.find(item => item.kind === 'contains' && item.target_id === entity.entity_id);
    return relation ? graph?.entities.find(item => item.entity_id === relation.source_id) : undefined;
};

const provinceMatches = (featureValue: Feature<Geometry, ProvinceProperties>, values: string[]): boolean => {
    const candidates = [featureValue.properties.name, featureValue.properties['地名'], featureValue.properties.id]
        .map(normalizedRegion);
    return values.some(value => candidates.includes(normalizedRegion(value)));
};

const prefectureMatches = (
    featureValue: Feature<Geometry, ProvinceProperties>,
    node: ComputeClusterNode,
): boolean => provinceMatches(featureValue, [node.labels?.city, node.labels?.city_name]
    .filter((value): value is string => Boolean(value)));

const mapNodeTone = (node: ComputeClusterNode): MapMarkerTone =>
    computeNodeState(node) === 'normal' ? 'healthy' : 'warning';

const mapStatusCounts = (markerNodes: ComputeClusterNode[]): MapStatusCounts => markerNodes.reduce(
    (counts, node) => ({...counts, [mapNodeTone(node)]: counts[mapNodeTone(node)] + 1}),
    {healthy: 0, warning: 0},
);

// Geographic gestures, drill-down, and cluster overlays intentionally share one local state owner.
// eslint-disable-next-line complexity
export const ClusterGeographicMap: React.FC<ClusterGeographicMapProps> = ({graph, nodes, zh}) => {
    const [level, setLevel] = useState<MapLevel>('world');
    const [selectedProvince, setSelectedProvince] = useState<Feature<Geometry, ProvinceProperties> | null>(null);
    const [transform, setTransform] = useState<MapTransform>(IDENTITY);
    const [hoveredName, setHoveredName] = useState('');
    const [dragging, setDragging] = useState(false);
    const svgRef = useRef<SVGSVGElement | null>(null);
    const drag = useRef<{pointerId: number; x: number; y: number; originX: number; originY: number; moved: boolean} | null>(null);
    const suppressClick = useRef(false);
    const nodeIndex = useMemo(() => new Map(nodes.map(node => [node.node_id, node])), [nodes]);
    const regionStats = useMemo(() => {
        const nodeEntities = graph?.entities.filter(entity => entity.kind === 'compute_node') || [];
        return provinceFeatures.map(province => {
            const regionNodes = nodeEntities.flatMap(entity => {
                const region = regionForNode(graph, entity);
                const values = [region?.region_id, region?.region_name, region?.label]
                    .filter((value): value is string => Boolean(value));
                const node = entity.node_id ? nodeIndex.get(entity.node_id) : undefined;
                return node && provinceMatches(province, values) ? [node] : [];
            });
            return {feature: province, name: zh ? province.properties['地名'] : province.properties.name, nodes: regionNodes};
        });
    }, [graph, nodeIndex, zh]);
    const activeFeatures: MapFeature[] = level === 'world'
        ? worldFeatures
        : level === 'china'
            ? provinceFeatures
            : prefectureFeatures.filter(item => item.properties.id.slice(0, 2) === selectedProvince?.properties.id.slice(0, 2));
    const collection = useMemo<FeatureCollection<Geometry>>(() => ({
        type: 'FeatureCollection',
        features: activeFeatures,
    }), [activeFeatures]);
    const projection = useMemo(() => {
        const next = level === 'world'
            ? geoNaturalEarth1()
            : geoMercator();
        return next.fitExtent([[24, 22], [WIDTH - 24, HEIGHT - 22]], collection);
    }, [collection, level]);
    const path = useMemo(() => geoPath(projection), [projection]);
    const statusCounts = mapStatusCounts(nodes);
    const markerNodeCount = (markerNodes: ComputeClusterNode[]): string => {
        const parentIds = new Set(markerNodes.map(node => node.node_id));
        const childCount = graph?.entities.filter(entity =>
            entity.kind === 'managed_device'
            && entity.device_kind === 'edge_compute'
            && Boolean(entity.node_id && parentIds.has(entity.node_id))).length || 0;
        return `${markerNodes.length}/${childCount}`;
    };
    const markerTone = (markerNodes: ComputeClusterNode[]): MapMarkerTone => {
        const state = aggregateCommunicationStates(markerNodes.map(computeNodeState));
        return state === 'normal' ? 'healthy' : 'warning';
    };
    const markerStatusLabel = (markerNodes: ComputeClusterNode[]): string => {
        const counts = mapStatusCounts(markerNodes);
        return zh
            ? `正常 ${counts.healthy} · 故障 ${counts.warning}`
            : `Normal ${counts.healthy} · Fault ${counts.warning}`;
    };
    // ponytail: The graph currently exposes province-level regions only; add country/coordinates to the API before placing non-China nodes.
    const chinaNodes = useMemo(() => [...new Map(regionStats
        .flatMap(region => region.nodes)
        .map(node => [node.node_id, node])).values()], [regionStats]);
    const hoveredStats = level === 'china'
        ? regionStats.find(region => region.name === hoveredName)
        : undefined;
    const selectedRegion = selectedProvince
        ? regionStats.find(region => region.feature.properties.id === selectedProvince.properties.id)
        : undefined;
    const prefectureStats = useMemo(() => prefectureFeatures
        .filter(item => item.properties.id.slice(0, 2) === selectedProvince?.properties.id.slice(0, 2))
        .map(prefecture => ({
            feature: prefecture,
            name: zh ? prefecture.properties['地名'] : prefecture.properties.name,
            nodes: selectedRegion?.nodes.filter(node =>
                prefecture.properties.id === selectedProvince?.properties.id
                || prefectureMatches(prefecture, node),
            ) || [],
        })), [selectedProvince, selectedRegion, zh]);
    const hoveredPrefectureStats = level === 'province'
        ? prefectureStats.find(prefecture => prefecture.name === hoveredName)
        : undefined;
    const selectedProvinceLabel = selectedProvince
        ? (zh ? selectedProvince.properties['地名'] : selectedProvince.properties.name)
        : '';
    const cityLocation = selectedRegion
        ? Array.from(new Set(selectedRegion.nodes.map(node => node.labels?.city_name)
            .filter((value): value is string => Boolean(value)))).join(' · ')
        : '';
    const changeLevel = (next: MapLevel) => {
        setLevel(next);
        if (next === 'world' || next === 'china') setSelectedProvince(null);
        setTransform(IDENTITY);
        setHoveredName('');
    };
    const openProvince = (selected: MapFeature) => {
        const province = selected as Feature<Geometry, ProvinceProperties>;
        setSelectedProvince(province);
        setLevel('province');
        setTransform(IDENTITY);
        setHoveredName('');
    };
    const zoomAt = (factor: number, x = WIDTH / 2, y = HEIGHT / 2) => setTransform(current => {
        const scale = Math.max(1, Math.min(12, current.scale * factor));
        const ratio = scale / current.scale;
        return {scale, x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio};
    });
    const zoomTo = (selected: MapFeature) => {
        const [[x0, y0], [x1, y1]] = path.bounds(selected);
        const scale = Math.max(1, Math.min(10, .82 / Math.max((x1 - x0) / WIDTH, (y1 - y0) / HEIGHT)));
        setTransform({
            scale,
            x: WIDTH / 2 - scale * (x0 + x1) / 2,
            y: HEIGHT / 2 - scale * (y0 + y1) / 2,
        });
    };
    const selectFeature = (selected: MapFeature, name: string) => {
        if (suppressClick.current) {
            suppressClick.current = false;
            return;
        }
        if (level === 'world' && name === 'China') changeLevel('china');
        else if (level === 'china') openProvince(selected);
        else zoomTo(selected);
    };
    const selectMarker = (event: React.KeyboardEvent<SVGGElement>, selected: MapFeature, name: string) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        selectFeature(selected, name);
    };
    const svgPoint = (clientX: number, clientY: number): [number, number] => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect?.width || !rect.height) return [WIDTH / 2, HEIGHT / 2];
        return [(clientX - rect.left) * WIDTH / rect.width, (clientY - rect.top) * HEIGHT / rect.height];
    };
    const markerTransform = (item: MapFeature): string => {
        const [x, y] = path.centroid(item);
        return `translate(${transform.x + x * transform.scale} ${transform.y + y * transform.scale})`;
    };

    return <section className='ComputeKnowledgePanel ControlGeoMapPanel' aria-label={zh ? '计算群地理地图' : 'Compute cluster geographic map'}>
        <div className='ComputeKnowledgeHeading'>
            <div>
                <span>{zh ? '地理视角 · 悬浮轮廓 / 点击下钻' : 'Geographic view · Hover outlines / click to drill down'}</span>
                <h3>{level === 'world'
                    ? (zh ? '全球节点地图' : 'Global node map')
                    : level === 'china'
                        ? (zh ? '中国节点地图' : 'China node map')
                        : `${selectedProvinceLabel}${zh && selectedProvinceLabel.endsWith('市') ? '地图' : zh ? '市级地图' : ' city map'}`}</h3>
                <p>{zh
                    ? '滚轮缩放、拖拽移动；点击省份进入市级地图。'
                    : 'Scroll to zoom and drag to pan. Click a province to open its city map.'}</p>
            </div>
            <div className='ComputeKnowledgeStats'>
                <div><strong>{graph?.summary.regions || 0}</strong><span>{zh ? '地域' : 'regions'}</span></div>
                <div><strong>{nodes.length}</strong><span>{zh ? '主节点' : 'main nodes'}</span></div>
                <div className='online'><strong>{statusCounts.healthy}</strong><span>{zh ? '正常' : 'Normal'}</span></div>
                <div className='warning'><strong>{statusCounts.warning}</strong><span>{zh ? '故障' : 'Fault'}</span></div>
            </div>
        </div>

        <div className='ComputeKnowledgeLegend ControlGeoMapToolbar'>
            <div className='ControlGeoMapLevels' role='group' aria-label={zh ? '地图范围' : 'Map scope'}>
                <button type='button' className={level === 'world' ? 'active' : ''} aria-pressed={level === 'world'} onClick={() => changeLevel('world')}>
                    {zh ? '全球' : 'World'}
                </button>
                <span>/</span>
                <button type='button' className={level === 'china' ? 'active' : ''} aria-pressed={level === 'china'} onClick={() => changeLevel('china')}>
                    {zh ? '中国' : 'China'}
                </button>
                {selectedProvince && <>
                    <span>/</span>
                    <button type='button' className={level === 'province' ? 'active' : ''} aria-pressed={level === 'province'} onClick={() => changeLevel('province')}>
                        {zh ? selectedProvince.properties['地名'] : selectedProvince.properties.name}
                    </button>
                </>}
            </div>
            <span><i className='ControlGeoMapDot online'/>{zh ? '正常节点' : 'Normal node'}</span>
            <span><i className='ControlGeoMapDot warning'/>{zh ? '故障节点' : 'Fault node'}</span>
            <small>{zh ? '边界数据仅用于节点位置展示' : 'Boundaries are for node location display only'}</small>
        </div>

        <div className='ControlGeoMapViewport'>
            <div className='ControlGeoMapInspector' role='status' aria-live='polite'>
                <strong>{hoveredName || (level === 'world'
                    ? (zh ? '悬浮查看国家' : 'Hover a country')
                    : level === 'china'
                        ? (zh ? '悬浮查看省份' : 'Hover a province')
                        : (zh ? '悬浮查看城市' : 'Hover a city'))}</strong>
                <span>{hoveredPrefectureStats?.nodes.length
                    ? markerStatusLabel(hoveredPrefectureStats.nodes)
                    : hoveredStats
                    ? markerStatusLabel(hoveredStats.nodes)
                    : level === 'province' && selectedRegion
                        ? `${markerStatusLabel(selectedRegion.nodes)} · ${cityLocation || (zh ? '城市位置待细化' : 'city pending')}`
                    : level === 'world' && hoveredName === (zh ? '中国' : 'China')
                        ? markerStatusLabel(chinaNodes)
                        : (zh ? '点击放大' : 'Click to zoom')}</span>
            </div>
            <div className='ControlGeoMapZoom' role='group' aria-label={zh ? '地图缩放' : 'Map zoom'}>
                <button type='button' onClick={() => zoomAt(1.45)} aria-label={zh ? '放大地图' : 'Zoom in'}>+</button>
                <button type='button' onClick={() => zoomAt(1 / 1.45)} aria-label={zh ? '缩小地图' : 'Zoom out'}>−</button>
                <button type='button' onClick={() => setTransform(IDENTITY)} aria-label={zh ? '重置地图' : 'Reset map'}>◎</button>
            </div>
            <svg
                ref={svgRef}
                className={dragging ? 'dragging' : ''}
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                role='img'
                aria-label={level === 'world'
                    ? (zh ? '可交互全球节点地图' : 'Interactive global node map')
                    : level === 'china'
                        ? (zh ? '可交互中国省级节点地图' : 'Interactive China province node map')
                        : (zh ? '可交互中国市级节点地图' : 'Interactive China city node map')}
                onWheel={event => {
                    event.preventDefault();
                    const [x, y] = svgPoint(event.clientX, event.clientY);
                    zoomAt(event.deltaY < 0 ? 1.18 : 1 / 1.18, x, y);
                }}
                onPointerDown={event => {
                    if (event.button !== 0) return;
                    drag.current = {pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: transform.x, originY: transform.y, moved: false};
                }}
                onPointerMove={event => {
                    const activeDrag = drag.current;
                    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const dx = (event.clientX - activeDrag.x) * WIDTH / Math.max(1, rect.width);
                    const dy = (event.clientY - activeDrag.y) * HEIGHT / Math.max(1, rect.height);
                    if (Math.abs(dx) + Math.abs(dy) <= 3) return;
                    if (!activeDrag.moved) {
                        activeDrag.moved = true;
                        event.currentTarget.setPointerCapture(event.pointerId);
                        setDragging(true);
                    }
                    setTransform(current => ({...current, x: activeDrag.originX + dx, y: activeDrag.originY + dy}));
                }}
                onPointerUp={event => {
                    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
                    suppressClick.current = drag.current.moved;
                    if (drag.current.moved) window.setTimeout(() => { suppressClick.current = false; }, 0);
                    drag.current = null;
                    setDragging(false);
                }}
                onPointerCancel={() => {
                    drag.current = null;
                    suppressClick.current = false;
                    setDragging(false);
                }}
            >
                <rect className='ControlGeoMapOcean' width={WIDTH} height={HEIGHT}/>
                <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
                    {activeFeatures.map((item, index) => {
                        const rawName = level === 'world'
                            ? (item.properties as WorldProperties).name
                            : (item.properties as ProvinceProperties)['地名'];
                        const name = level === 'world'
                            ? displayCountryName(rawName, zh)
                            : zh ? rawName : (item.properties as ProvinceProperties).name;
                        return <path
                            key={`${rawName}-${index}`}
                            d={path(item) || undefined}
                            className={hoveredName === name ? 'hovered' : ''}
                            data-map-feature={rawName}
                            onMouseEnter={() => setHoveredName(name)}
                            onMouseLeave={() => setHoveredName(current => current === name ? '' : current)}
                            onClick={() => selectFeature(item, rawName)}
                        ><title>{name}</title></path>;
                    })}
                </g>
                {level === 'world' ? (() => {
                    const china = worldFeatures.find(item => item.properties.name === 'China');
                    if (!china || !chinaNodes.length) return null;
                    return <g
                        className={`ControlGeoMapMarker ${markerTone(chinaNodes)}`}
                        transform={markerTransform(china)}
                        role='button'
                        tabIndex={0}
                        aria-label={zh ? '进入中国下一级地图' : 'Open the China map'}
                        data-map-marker='China'
                        onClick={() => selectFeature(china, 'China')}
                        onKeyDown={event => selectMarker(event, china, 'China')}
                    >
                        <circle r='12'/><text y='3'>{markerNodeCount(chinaNodes)}</text>
                    </g>;
                })() : level === 'china' ? regionStats.filter(region => region.nodes.length).map(region => {
                    return <g
                        key={region.feature.properties.id}
                        className={`ControlGeoMapMarker ${markerTone(region.nodes)}`}
                        transform={markerTransform(region.feature)}
                        role='button'
                        tabIndex={0}
                        aria-label={zh ? `进入${region.name}下一级地图` : `Open ${region.name}`}
                        data-map-marker={region.name}
                        onClick={() => selectFeature(region.feature, region.feature.properties['地名'])}
                        onKeyDown={event => selectMarker(event, region.feature, region.feature.properties['地名'])}
                    >
                        <circle r='12'/><text y='3'>{markerNodeCount(region.nodes)}</text>
                    </g>;
                }) : prefectureStats.filter(prefecture => prefecture.nodes.length).map(prefecture => <g
                    key={prefecture.feature.properties.id}
                    className={`ControlGeoMapMarker ${markerTone(prefecture.nodes)}`}
                    transform={markerTransform(prefecture.feature)}
                    data-map-prefecture={prefecture.name}
                    role='button'
                    tabIndex={0}
                    aria-label={zh ? `查看${prefecture.name}` : `View ${prefecture.name}`}
                    onClick={() => selectFeature(prefecture.feature, prefecture.feature.properties['地名'])}
                    onKeyDown={event => selectMarker(event, prefecture.feature, prefecture.feature.properties['地名'])}
                >
                    <circle r='12'/><text y='3'>{markerNodeCount(prefecture.nodes)}</text>
                </g>)}
            </svg>
        </div>
    </section>;
};
