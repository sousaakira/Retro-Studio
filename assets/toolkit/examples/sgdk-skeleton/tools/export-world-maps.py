#!/usr/bin/env python3
"""Compile world TMX resources into a new staging directory; never publish them."""
import argparse
import hashlib
import importlib.util
import json
from io import BytesIO
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
ID = re.compile(r'[A-Za-z][A-Za-z0-9_-]{0,63}\Z')
OBJECT = re.compile(r'GAME_MAP_OBJECT_[A-F0-9]{16}\Z')


def numeric_id(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError('Invalid world room ID.')
    number = 2166136261
    for byte in value.encode('ascii'):
        number = ((number ^ byte) * 16777619) & 0xffffffff
    return number % 65535


def regular(project, filename, base=None, limit=32*1024*1024, optional=False):
    if not isinstance(filename, str) or not filename or '\\' in filename or any(ord(c)<32 for c in filename):
        raise ValueError('Invalid world map input path.')
    target = (base or project) / filename
    # Resolve lexical .. only after checking every traversed component for links.
    if Path(filename).is_absolute():
        raise ValueError('Absolute world map input path.')
    cursor = project
    relative = target.relative_to(project)
    for part in relative.parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValueError('World map inputs cannot contain symlinks.')
        if not cursor.resolve().is_relative_to(project):
            raise ValueError('World map input escapes project.')
    if optional and not target.exists():
        return None
    if not target.is_file() or target.stat().st_size > limit:
        raise ValueError('Missing or oversized world map input: '+filename)
    return target.resolve()


def inspect_map(project, filename):
    source = regular(project, filename, limit=4*1024*1024)
    def xml(file):
        data = file.read_bytes()
        if re.search(br'<!DOCTYPE|<!ENTITY', data, re.I):
            raise ValueError('World map XML declarations are unsupported.')
        return ET.fromstring(data)
    root = xml(source)
    if root.tag != 'map' or root.get('orientation', 'orthogonal') != 'orthogonal' or root.get('infinite', '0') != '0':
        raise ValueError('World requires finite orthogonal maps.')
    from PIL import Image
    def image(base, name):
        path = regular(project, name, base)
        with Image.open(path) as opened:
            if opened.width*opened.height > 16*1024*1024:
                raise ValueError('World map image exceeds 16 million pixels.')
    for node in root.findall('tileset'):
        base = source.parent
        if node.get('source'):
            tsx = regular(project, node.get('source'), base, 4*1024*1024)
            node, base = xml(tsx), tsx.parent
        for item in node.findall('.//image'):
            image(base, item.get('source'))
    for prop in root.findall('./properties/property'):
        if prop.get('name') == 'retroStudio.backgroundImage':
            image(source.parent, prop.get('value', prop.text or ''))
        if prop.get('name') == 'retroStudio.parallaxLayers':
            layers = json.loads(prop.get('value', prop.text or '') or '[]')
            if not isinstance(layers, list) or len(layers) > 8:
                raise ValueError('Invalid panoramas in world map.')
            for layer in layers:
                image(source.parent, str(layer.get('path', '')))
    return root


def compile_world(project, world, configuration):
    project = project.resolve()
    if world.get('format') != 'retro-studio.world' or world.get('version') != 1:
        raise ValueError('Unsupported world format.')
    rooms = world.get('rooms')
    if not isinstance(rooms, list) or not 1 <= len(rooms) <= 64:
        raise ValueError('World requires 1..64 rooms.')
    spec = importlib.util.spec_from_file_location('retro_map_compiler', Path(__file__).with_name('export-map.py'))
    compiler = importlib.util.module_from_spec(spec);spec.loader.exec_module(compiler)
    compiler.ROOT = project
    resource_file = regular(project, 'res/resources.res', limit=4*1024*1024)
    manifest_file = regular(project, 'res/generated/map-manifest.json', limit=4*1024*1024, optional=True)
    resource_text = resource_file.read_text()
    prior_manifest = json.loads(manifest_file.read_text()) if manifest_file else {}
    outputs, records, definitions, bindings, geometries, scenes, sceneries = {}, [], {}, [], [], [], []
    needs_drifts = False
    ids = set()
    total = 0
    def add(name, data):
        nonlocal total
        data = data.encode() if isinstance(data, str) else data
        if name in outputs and outputs[name] != data:
            raise ValueError('Conflicting world output: '+name)
        if name not in outputs:
            total += len(data)
        if total > 64*1024*1024:
            raise ValueError('World outputs exceed 64 MiB.')
        outputs[name] = data
    for room in sorted(rooms, key=lambda r:r['id']):
        number = numeric_id(room['id'])
        if number in ids:
            raise ValueError('Duplicate or colliding world room ID.')
        ids.add(number)
        root = inspect_map(project, room['map'])
        if int(root.get('width'))*int(root.get('tilewidth')) != room['width'] or int(root.get('height'))*int(root.get('tileheight')) != room['height']:
            raise ValueError('World/map dimensions disagree: '+room['id'])
        prefix = 'RETRO_WORLD_ROOM_'+str(number)
        variable = 'retroWorldRoom'+str(number)
        captured = {}
        def capture(path, data):
            captured[path.relative_to(project).as_posix()] = data.encode() if isinstance(data, str) else data
        config = json.loads(json.dumps(configuration))
        config.setdefault('mapExport', {})['runtimeGeometry'] = True
        properties = {item.get('name'): item.get('value', item.text or '') for item in root.findall('./properties/property')}
        # Rooms with panoramas use the scenery runtime: one streamed map layer on
        # BG_A and the panoramas on BG_B. The others keep the resident tileset unless
        # their patterns do not fit VRAM (#90): then both map layers are streamed.
        panoramas = bool(json.loads(properties.get('retroStudio.parallaxLayers', '[]') or '[]'))
        compiler.export_map(config=config, source_maps=[room['map']], writer=capture,
                            prior_manifest=prior_manifest, resource_text=resource_text, scenery=True if panoramas else None, world_music=True)
        def namespace(text):
            def token(match):
                value = match[0]
                if OBJECT.fullmatch(value):
                    return value
                if value.startswith('GAME_MAP'):
                    return prefix+value[len('GAME_MAP'):]
                if value.startswith('GAME_PLAYER'):
                    return prefix+'_PLAYER'+value[len('GAME_PLAYER'):]
                if value.startswith('gameMap'):
                    return variable+value[len('gameMap'):]
                return 'RETROSTUDIO_WORLD_'+str(number)+value[len('RETROSTUDIO_MAP'):]
            return re.sub(r'\b(?:GAME_MAP\w*|GAME_PLAYER\w*|gameMap\w*|RETROSTUDIO_MAP\w*)\b', token, text)
        for name, data in captured.items():
            if name.startswith('res/generated/map-object-'):
                add(name, data)
            elif name.startswith('res/generated/map-') and (name.endswith('.png') or name.endswith('.bin')):
                add(name.replace('map-', 'world-'+str(number)+'-', 1), data)
            elif name in ('src/generated/map_data.h', 'src/generated/map_objects.h'):
                add('src/generated/world_room_'+str(number)+('_objects.h' if name.endswith('objects.h') else '.h'), namespace(data.decode()))
        manifest = json.loads(captured['res/generated/map-manifest.json'])
        streamed = 'scenery' in manifest
        symbols = {r['symbol'] for r in manifest['objectResources']}
        for line in captured['res/resources.res'].decode().splitlines():
            tokens = line.split()
            wanted = {'GAME_MAP_PALETTE','GAME_MAP_STREAM_PATTERNS','GAME_MAP_STREAM_CELLS','GAME_MAP_STREAM_IDS','GAME_MAP_BACK_CELLS','GAME_MAP_BACK_IDS','GAME_MAP_PAN_TILES','GAME_MAP_PAN'} if streamed else {'GAME_MAP_PALETTE','GAME_MAP_TILES','GAME_MAP','GAME_MAP_FG_TILES','GAME_MAP_FG'}
            if len(tokens)<2 or not (tokens[1] in symbols or tokens[1] in wanted):
                continue
            line = namespace(line)
            for layer in ('bg.png', 'fg.png', 'pan.png', 'stream-patterns.bin', 'stream-cells.bin', 'stream-ids.bin', 'back-cells.bin', 'back-ids.bin'):
                line = line.replace('generated/map-'+layer, 'generated/world-'+str(number)+'-'+layer)
            symbol = line.split()[1]
            if symbol in definitions and definitions[symbol] != line:
                raise ValueError('Conflicting world resource declaration: '+symbol)
            definitions[symbol] = line
        object_count = int(re.search(r'#define GAME_MAP_OBJECT_COUNT (\d+)', captured['src/generated/map_objects.h'].decode())[1])
        records.append({'id':room['id'],'numericId':number,'map':room['map'],'manifest':manifest,'objectCount':object_count})
        scene_data = variable+'ObjectDefinitions,'+prefix+'_OBJECT_COUNT,'+variable+'ObjectPalette,'+variable+'ObjectTileBudget' if object_count else '0,0,0,0'
        scenes.append(' {'+str(number)+','+scene_data+'}')
        from PIL import Image
        with Image.open(BytesIO(captured['res/generated/map-fg.png'])) as front:
            has_front = any(p[3] for p in front.convert('RGBA').getdata())
        foreground = '&'+prefix+'_FG_TILES,&'+prefix+'_FG' if has_front else '0,0'
        palettes = '{{&'+prefix+'_PALETTE,0},{0,0},{&'+prefix+'_PALETTE,32},{&'+prefix+'_PALETTE,48}}'
        if streamed:
            plan = manifest['scenery']
            panorama = '0'
            if plan['panorama']:
                sceneries.append('static const RetroSceneryBand '+variable+'Bands[]={'+','.join('{'+','.join(str(v) for v in band)+'}' for band in plan['bands'])+'};')
                sceneries.append('static const RetroSceneryPanorama '+variable+'Panorama={&'+prefix+'_PAN_TILES,&'+prefix+'_PAN,'+variable+'Bands,'+str(len(plan['bands']))+','+str(plan['factorY'])+'};')
                panorama = '&'+variable+'Panorama'
            # Binary data (#90): patterns, VDP attribute words and 16-bit pattern ids per plane.
            # The casts drop const: SGDK's TileSet/TileMap point at mutable data, the runtime never writes.
            columns, rows = manifest['width'], manifest['height']
            sceneries.append('static const TileSet '+variable+'StreamTiles={COMPRESSION_NONE,'+str(plan['patterns'])+',(u32*)'+prefix+'_STREAM_PATTERNS};')
            sceneries.append('static const TileMap '+variable+'StreamCells={COMPRESSION_NONE,'+str(columns)+','+str(rows)+',(u16*)'+prefix+'_STREAM_CELLS};')
            back = '0,0'
            if plan.get('planes', 1) > 1:
                sceneries.append('static const TileMap '+variable+'BackCells={COMPRESSION_NONE,'+str(columns)+','+str(rows)+',(u16*)'+prefix+'_BACK_CELLS};')
                back = '&'+variable+'BackCells,(const u16*)'+prefix+'_BACK_IDS'
            # minimumSlots: the most patterns any drawn window of this room needs at once.
            # Drift bands (runtime version 3): water currents on BG_B, by world rows.
            # The fields are always written (0,0,0 without bands): runtime 3 is required either way.
            drifts = ',0,0,0'
            if plan.get('drifts'):
                needs_drifts = True
                sceneries.append('static const RetroSceneryDrift '+variable+'Drifts[]={'+','.join('{'+','.join(str(v) for v in band)+'}' for band in plan['drifts'])+'};')
                drifts = ','+variable+'Drifts,'+str(len(plan['drifts']))+','+str(plan['marginX'])
            sceneries.append('static const RetroScenerySgdkRoom '+variable+'Scenery={&'+variable+'StreamTiles,&'+variable+'StreamCells,'+panorama+','+','.join(str(plan[key]) for key in ('firstTile','tiles','windowPatterns','dmaBytes','dmaEntries'))+',(const u16*)'+prefix+'_STREAM_IDS,'+back+drifts+'};')
            bindings.append('{'+str(number)+',0,0,0,0,'+palettes+',&retroScenerySgdkRenderer,&'+variable+'Scenery}')
        else:
            bindings.append('{'+str(number)+',&'+prefix+'_TILES,&'+prefix+','+foreground+','+palettes+',0,0}')
        frame = config['mapExport'].get('playerFrame', {})
        frame_width, frame_height = int(frame.get('width', 8)), int(frame.get('height', 8))
        # Authored hitbox uses sprite top-left; runtime bodies use centered feet.
        body = '{'+prefix+'_PLAYER_HITBOX_X-'+str(frame_width//2)+','+prefix+'_PLAYER_HITBOX_Y-'+str(frame_height)+','+prefix+'_PLAYER_HITBOX_W,'+prefix+'_PLAYER_HITBOX_H}'
        geometries.append(' {'+str(number)+','+variable+'Colliders,'+prefix+'_COLLIDER_COUNT,'+variable+'Slopes,'+prefix+'_SLOPE_COUNT,'+body+','+str(frame_width)+','+str(frame_height)+'}')
    header = '#ifndef RETROSTUDIO_WORLD_MAPS_H\n#define RETROSTUDIO_WORLD_MAPS_H\n#include "../retro_runtime/retro_world_sgdk.h"\n#include "../retro_runtime/retro_slopes.h"\n#include "../../res/resources.h"\n'
    for record in records:
        header += '#include "world_room_'+str(record['numericId'])+'.h"\n#include "world_room_'+str(record['numericId'])+'_objects.h"\n'
    if sceneries:
        # Streamed rooms need the scenery runtime (Jogo → Módulos de apoio: "scenery-sgdk").
        header = header.replace('#include "../retro_runtime/retro_world_sgdk.h"\n', '#include "../retro_runtime/retro_world_sgdk.h"\n#include "../retro_runtime/retro_scenery_sgdk.h"\n')
        header += '#if RETRO_RUNTIME_SCENERY_SGDK_VERSION < 3\n#error "Atualize o runtime scenery-sgdk (Jogo -> Modulos de apoio): este mundo foi exportado para a versao 3."\n#endif\n'
        if needs_drifts:
            header += '/* Faixas de correnteza: chame retroScenerySgdkTick(&ponte) todo quadro, depois de retroWorldSgdkScroll. */\n'
        header += '\n'.join(sceneries)+'\n'
    header += '#if RETRO_RUNTIME_WORLD_SGDK_VERSION < 3\n#error "Atualize o runtime world-sgdk (Runtime -> Modulos): este mundo foi exportado para a versao 3."\n#endif\n'
    header += '#define RETRO_WORLD_MAP_COUNT '+str(len(records))+'\nstatic const RetroWorldSgdkRoom retroWorldMapBindings[]={\n'+',\n'.join(bindings)+'\n};\n'
    header += '/* body is relative to centered bottom/feet, independent of camera. */\ntypedef struct {u16 room;const RetroCollider *colliders;u16 colliderCount;const RetroSlope *slopes;u16 slopeCount;RetroRect body;u16 frameWidth,frameHeight;} RetroWorldMapGeometry;\nstatic const RetroWorldMapGeometry retroWorldMapGeometry[]={\n'+',\n'.join(geometries)+'\n};\n'
    scene_count = len(records) if any(record['objectCount'] for record in records) else 0
    header += '#define RETRO_WORLD_SCENE_COUNT '+str(scene_count)+'\n'
    if scene_count:
        header += '/* Palette upload is explicit: host must ensure shared PAL1 compatibility. */\ntypedef struct {u16 room;const RetroSceneObjectDefinition *objects;u16 count;void (*palette)(void);u32 (*tileBudget)(void);} RetroWorldMapScene;\nstatic const RetroWorldMapScene retroWorldMapScenes[]={\n'+',\n'.join(scenes)+'\n};\n'
        header += 'static inline const RetroWorldMapScene *retroWorldMapSceneFind(u16 room) { u16 i;for(i=0;i<RETRO_WORLD_SCENE_COUNT;i++)if(retroWorldMapScenes[i].room==room)return &retroWorldMapScenes[i];return 0; }\n'
    header += '#endif\n'
    add('src/generated/world_maps.h', header)
    # ResComp resolves MAP's TILESET immediately, so declaration order matters.
    order = {'PALETTE':0, 'BIN':1, 'TILESET':1, 'MAP':2, 'TILEMAP':2, 'SPRITE':3}
    symbols = sorted(definitions, key=lambda k:(order[definitions[k].split()[0]], k))
    add('res/generated/world-resources.res', '\n'.join(definitions[k] for k in symbols)+'\n')
    manifest = {'version':1,'rooms':records,'outputs':[{'path':k,'hash':hashlib.sha256(v).hexdigest()} for k,v in sorted(outputs.items())]}
    add('res/generated/world-map-manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
    return outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', required=True, help='New empty output directory; publication belongs to the IDE transaction.')
    args = parser.parse_args()
    destination = Path(args.stage)
    if destination.exists():
        raise ValueError('Refuse existing world map stage.')
    project = ROOT.resolve()
    world = json.loads(regular(project, 'world/world.json', limit=1024*1024).read_text())
    configuration = json.loads(regular(project, 'retro-studio.json', limit=1024*1024).read_text())
    outputs = compile_world(project, world, configuration)
    destination.mkdir(parents=True)
    for name, data in outputs.items():
        target = destination/name;target.parent.mkdir(parents=True, exist_ok=True);target.write_bytes(data)
    print('World maps staged: '+str(len(outputs))+' outputs. Project files unchanged.')


if __name__ == '__main__':
    main()
