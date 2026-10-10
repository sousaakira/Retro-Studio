#!/usr/bin/env python3
"""Export a Retro Studio TMX map for the SGDK skeleton runtime."""
from pathlib import Path
from io import BytesIO
import json
import os
import re
import xml.etree.ElementTree as ET
from array import array

ROOT = Path(__file__).resolve().parents[1]


def runtime_geometry(field, groups, width, height, slopes):
    """Merge solids and exposed directional faces, never invent internal faces."""
    exposed = bytearray(len(field))
    for y in range(height):
        for x in range(width):
            index = y*width+x
            value, group = field[index], groups[index]
            if value == 15:
                exposed[index] = 1  # full solid, keep legacy kind
                continue
            if value == 0:
                continue
            faces = 0
            for bit, inside, neighbor in ((1, y>0, index-width), (2, y+1<height, index+width),
                                          (4, x>0, index-1), (8, x+1<width, index+1)):
                if value & bit and (not inside or not field[neighbor] & bit or groups[neighbor] != group):
                    faces |= bit
            # Drop-through belongs to the original region, not to a fragment
            # that happens to expose only TOP after contour decomposition.
            exposed[index] = (2 if value == 1 else 16 | faces) if faces else 0
    boxes, active = [], {}
    for y in range(height):
        row, x = {}, 0
        while x < width:
            value, group = exposed[y*width+x], groups[y*width+x]
            start = x
            while x < width and exposed[y*width+x] == value and groups[y*width+x] == group:
                x += 1
            if not value:
                continue
            key = (start, x-start, value, group)
            previous = active.pop(key, None)
            if previous is None:
                previous = [start, y, x-start, 1, group, value]
            else:
                previous[3] += 1
            row[key] = previous
        boxes.extend(active.values())
        if len(boxes)+len(row) > 4096:
            raise ValueError('Geometria do runtime excede 4096 retângulos. Simplifique as colisões.')
        active = row
    boxes.extend(active.values())
    header = f'#define GAME_MAP_COLLIDER_COUNT {len(boxes)}\n#define GAME_MAP_SLOPE_COUNT {len(slopes)}\n'
    header += '#ifdef RETRO_STUDIO_COLLISION_H\nstatic const RetroCollider gameMapColliders[] = {\n'
    header += ',\n'.join('{{'+','.join(map(str,b[:4]))+'},'+','.join(map(str,b[4:]))+'}' for b in (boxes or [[0,0,0,0,0,0]]))
    header += '\n};\n#endif\n#ifdef RETRO_STUDIO_SLOPES_H\nstatic const RetroSlope gameMapSlopes[] = {\n'
    header += ',\n'.join('{{'+','.join(map(str,s[:4]))+'},'+','.join(map(str,s[4:]))+'}' for s in (slopes or [[0,0,0,0,0,0,0]]))
    return header+'\n};\n#endif\n'


def write_changed(path, data):
    data = data.encode() if isinstance(data, str) else data
    stage = os.environ.get('RETROSTUDIO_EXPORT_STAGE')
    if stage:
        path = Path(stage) / path.relative_to(ROOT)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.read_bytes() != data:
        path.write_bytes(data)


def csv_values(layer, size):
    if layer is None:
        return [0] * size
    data = layer.find('data')
    if data is None or data.get('encoding') != 'csv':
        raise ValueError('Use camadas CSV no TMX.')
    values = [int(v) for v in re.split(r'[,\s]+', (data.text or '').strip()) if v]
    if len(values) != size:
        raise ValueError(f"Camada {layer.get('name')}: {len(values)} células, esperado {size}.")
    return values


def draw_background(canvas, source, props):
    from PIL import Image
    filename = props.get('retroStudio.backgroundImage')
    if not filename:
        return
    image = Image.open(source.parent / filename).convert('RGBA')
    width, height = canvas.size
    fit = props.get('retroStudio.backgroundFit', 'cover')
    if fit not in ('cover', 'contain', 'stretch', 'repeat', 'repeat-x', 'repeat-y'):
        raise ValueError(f'Modo de fundo inválido: {fit}')
    opacity = float(props.get('retroStudio.backgroundOpacity', 1))
    if not 0 <= opacity <= 1:
        raise ValueError('A opacidade do fundo precisa estar entre 0 e 1.')
    if opacity < 1:
        image.putalpha(image.getchannel('A').point(lambda v: round(v * opacity)))
    if fit.startswith('repeat'):
        repeat_x, repeat_y = fit != 'repeat-y', fit != 'repeat-x'
        for y in range(0 if repeat_y else (height-image.height)//2, height, image.height if repeat_y else height):
            for x in range(0 if repeat_x else (width-image.width)//2, width, image.width if repeat_x else width):
                canvas.alpha_composite(image, (x, y))
    else:
        if fit == 'stretch':
            target = (width, height)
        else:
            scale = (min if fit == 'contain' else max)(width/image.width, height/image.height)
            target = (max(1, round(image.width*scale)), max(1, round(image.height*scale)))
        image = image.resize(target, Image.Resampling.NEAREST)
        canvas.alpha_composite(image, ((width-image.width)//2, (height-image.height)//2))


PLANE_WIDTH, PLANE_HEIGHT = 512, 256


def scenery_settings(config):
    """Screen and per-frame allowances of streamed rooms (retro-studio.json: scenery)."""
    settings = config.get('scenery', {}) if isinstance(config.get('scenery', {}), dict) else {}
    budget = config.get('hardwareBudget') if isinstance(config.get('hardwareBudget'), dict) else {}
    target = config.get('retroStudio', {}).get('target', {}) if isinstance(config.get('retroStudio'), dict) else {}
    mode = budget.get('videoMode') or (target.get('videoMode') if isinstance(target, dict) else None) or 'H40'
    def number(name, default, low, high):
        value = settings.get(name, default)
        if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
            raise ValueError(f'scenery.{name}: use um inteiro entre {low} e {high}.')
        return value
    view_width = 256 if mode == 'H32' else 320
    result = {'viewWidth': view_width, 'viewHeight': 224,
              'firstTile': number('firstTile', 0, 0, 2047), 'tiles': number('tiles', 0, 0, 2047),
              'dmaBytes': number('dmaBytes', 2048, 256, 7200), 'dmaEntries': number('dmaEntries', 56, 8, 250)}
    # The runtime refuses a room whose allowance does not fit one row or column of its window
    # (every cell new: 2 bytes for the cell, 32 for its pattern; two transfers when the plane wraps).
    line = max(stream_window(view_width, 64), stream_window(224, 32))
    if result['dmaBytes'] < line * 34 or result['dmaEntries'] < line + 2:
        raise ValueError(f'scenery: o orçamento por quadro precisa comportar uma linha da janela do cenário — pelo menos {line*34} bytes (dmaBytes) e {line+2} transferências (dmaEntries) nesta largura de tela.')
    if 0 < result['firstTile'] < 16:
        raise ValueError('scenery.firstTile: os 16 primeiros tiles são do sistema; use 0 (automático) ou 16 em diante.')
    return result


def stream_window(view, plane):
    """Cells the runtime window spans on one axis (retro_scenery.c): screen + kept behind + lead + the step being drawn."""
    cells_seen = (view + 7) // 8 + 1
    extra = plane - cells_seen
    lead = 1 if extra >= 3 else 0
    keep = 2 if extra >= 4 else lead
    return cells_seen + keep + lead + 1


def compose_panorama(source, layers, view_width, view_height, room_width, room_height):
    """Fit the editor's panoramas into the one plane hardware has for them.

    Returns (512x256 RGBA image, bands, factorY). Each band is (factorX 8.8, first
    8-pixel screen row, rows). Whatever the plane cannot show is an error that
    says which panorama and why; nothing is dropped or approximated silently.
    """
    from PIL import Image
    if not isinstance(layers, list) or not layers:
        raise ValueError('Panoramas inválidos no mapa.')
    if len(layers) > 8:
        raise ValueError('O mapa tem mais de oito panoramas.')
    rendered = []
    for index, layer in enumerate(layers):
        name = f'Panorama {index+1} ({Path(str(layer.get("path", ""))).name})'
        fit = layer.get('fit', 'cover')
        if fit not in ('cover', 'contain', 'stretch', 'repeat', 'repeat-x', 'repeat-y'):
            raise ValueError(f'{name}: modo de ajuste inválido.')
        factors = []
        for key, default in (('factorX', 0.5), ('factorY', 1)):
            value = layer.get(key, default)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 2:
                raise ValueError(f'{name}: velocidade fora de 0 a 2.')
            factors.append(round(value * 256))
        if float(layer.get('opacity', 1)) != 1:
            raise ValueError(f'{name}: o console não mistura camadas; use opacidade 100%.')
        file = (source.parent / str(layer.get('path', ''))).resolve()
        if ROOT.resolve() not in file.parents or not file.is_file():
            raise ValueError(f'{name}: a imagem precisa estar dentro do projeto.')
        image = Image.open(file).convert('RGBA')
        if image.width * image.height > 16 * 1024 * 1024:
            raise ValueError(f'{name}: imagem grande demais.')
        if fit == 'stretch':
            image = image.resize((view_width, view_height), Image.Resampling.NEAREST)
        elif not fit.startswith('repeat'):
            scale = (min if fit == 'contain' else max)(view_width / image.width, view_height / image.height)
            image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.NEAREST)
        if any(alpha not in (0, 255) for alpha in image.getchannel('A').getdata()):
            raise ValueError(f'{name}: transparência parcial não existe no console. Use pixels totalmente opacos ou totalmente transparentes.')
        repeat_x = not fit.startswith('repeat') or fit != 'repeat-y'
        repeat_y = not fit.startswith('repeat') or fit != 'repeat-x'
        # Same tiling as the editor preview: the image repeats at its own size, or
        # once per screen (centered) on an axis it does not repeat.
        period_x = image.width if repeat_x else view_width
        period_y = image.height if repeat_y else view_height
        travel_x = -(-max(0, room_width - view_width) * factors[0] // 256)
        travel_y = -(-max(0, room_height - view_height) * factors[1] // 256)
        if factors[0] and PLANE_WIDTH % period_x and view_width + travel_x > PLANE_WIDTH:
            raise ValueError(f'{name}: repete a cada {period_x} px na horizontal e anda {travel_x} px nesta sala. O plano do console dá a volta a cada {PLANE_WIDTH} px: use uma largura que divida {PLANE_WIDTH} (32, 64, 128, 256 ou 512), velocidade horizontal 0, ou uma velocidade com que o panorama ande até {PLANE_WIDTH - view_width} px.')
        if factors[1] and PLANE_HEIGHT % period_y and view_height + travel_y > PLANE_HEIGHT:
            raise ValueError(f'{name}: repete a cada {period_y} px na vertical e anda {travel_y} px nesta sala. O plano do console dá a volta a cada {PLANE_HEIGHT} px: use uma altura que divida {PLANE_HEIGHT} (32, 64, 128 ou 256), velocidade vertical 0, ou uma velocidade com que o panorama ande até {PLANE_HEIGHT - view_height} px.')
        plane = Image.new('RGBA', (PLANE_WIDTH, PLANE_HEIGHT))
        offset_x = 0 if repeat_x else (view_width - image.width) // 2
        offset_y = 0 if repeat_y else (view_height - image.height) // 2
        for y in range(0, PLANE_HEIGHT, period_y):
            for x in range(0, PLANE_WIDTH, period_x):
                _paste(plane, image, x + offset_x, y + offset_y)
        alpha = plane.getchannel('A')
        rows = [alpha.crop((0, y, PLANE_WIDTH, y + 8)).getbbox() is not None for y in range(0, PLANE_HEIGHT, 8)]
        rendered.append({'name': name, 'image': plane, 'factorX': factors[0], 'factorY': factors[1], 'rows': rows})
    vertical = {item['factorY'] for item in rendered}
    if len(vertical) > 1:
        raise ValueError('Os panoramas do mapa têm velocidades verticais diferentes. Eles dividem um único plano do console, que só tem um scroll vertical: use a mesma velocidade vertical em todos.')
    factor_y = vertical.pop()
    screen_rows = view_height // 8
    owners = []
    # With no vertical scroll only the rows of the screen are ever shown; with it, the whole plane is.
    checked_rows = PLANE_HEIGHT // 8 if factor_y else screen_rows
    for row in range(checked_rows):
        speeds = {}
        for item in rendered:
            if item['rows'][row]:
                speeds.setdefault(item['factorX'], item['name'])
        if len(speeds) > 1:
            names = ' e '.join(speeds.values())
            raise ValueError(f'{names} têm velocidades horizontais diferentes e se sobrepõem nas linhas {row*8}–{row*8+7} do plano. O console tem um só plano para panoramas: velocidades diferentes só em faixas horizontais que não se sobrepõem. Deixe transparente a parte que cobre o outro panorama ou iguale as velocidades.')
        owners.append(next(iter(speeds), None))
    if all(owner is None for owner in owners):
        raise ValueError('Os panoramas do mapa são totalmente transparentes.')
    # Empty rows follow the band above (or the first band): they show only the backdrop.
    last = next(owner for owner in owners if owner is not None)
    for row, owner in enumerate(owners):
        if owner is None:
            owners[row] = last
        last = owners[row]
    bands = []
    for row in range(screen_rows):
        if bands and bands[-1][0] == owners[row]:
            bands[-1][2] += 1
        else:
            bands.append([owners[row], row, 1])
    if len(bands) > 8:
        raise ValueError(f'Os panoramas formam {len(bands)} faixas de velocidade; o limite é 8.')
    if factor_y and len(set(owners)) > 1:
        raise ValueError('Faixas com velocidades horizontais diferentes exigem velocidade vertical 0 em todos os panoramas: as faixas são fixas na tela, de 8 em 8 linhas.')
    canvas = Image.new('RGBA', (PLANE_WIDTH, PLANE_HEIGHT))
    for item in rendered:
        canvas.alpha_composite(item['image'])
    return canvas, [tuple(band) for band in bands], factor_y


def _paste(plane, image, x, y):
    """alpha_composite with clipping: the image may start before or end after the plane."""
    left, top = max(0, -x), max(0, -y)
    right, bottom = min(image.width, plane.width - x), min(image.height, plane.height - y)
    if left < right and top < bottom:
        plane.alpha_composite(image.crop((left, top, right, bottom)), (x + left, y + top))


def stream_requirement(encoded_png, cells_wide, cells_high, view_width, view_height):
    """(patterns, worst window): distinct 8x8 patterns of the layer as ResComp stores
    them (flips shared) and the most of them any drawn window holds at once."""
    from PIL import Image
    image = Image.open(BytesIO(encoded_png))
    width = image.width // 8
    pixels = image.tobytes()
    ids, cells = {}, []
    for cy in range(cells_high):
        row = []
        for cx in range(cells_wide):
            tile = [bytes(value & 15 for value in pixels[(cy*8+y)*image.width+cx*8:(cy*8+y)*image.width+cx*8+8]) for y in range(8)]
            flipped = [line[::-1] for line in tile]
            key = min(b''.join(tile), b''.join(flipped), b''.join(tile[::-1]), b''.join(flipped[::-1]))
            row.append(ids.setdefault(key, len(ids)))
        cells.append(row)
    win_w, win_h = min(cells_wide, stream_window(view_width, 64)), min(cells_high, stream_window(view_height, 32))
    worst = 0
    for top in range(cells_high - win_h + 1):
        counts = {}
        def add(column):
            for y in range(top, top + win_h):
                counts[cells[y][column]] = counts.get(cells[y][column], 0) + 1
        def remove(column):
            for y in range(top, top + win_h):
                value = cells[y][column]
                if counts[value] == 1:
                    del counts[value]
                else:
                    counts[value] -= 1
        for column in range(win_w):
            add(column)
        worst = max(worst, len(counts))
        for left in range(1, cells_wide - win_w + 1):
            remove(left - 1)
            add(left + win_w - 1)
            worst = max(worst, len(counts))
    return len(ids), worst, width


def encode_planes(outputs, width, height, layers):
    """Use up to three scenery palettes; PAL1 remains available to sprites.

    Each 8x8 hardware tile has one palette and index 0 is transparent.
    Assign whole tile color sets; never silently quantize the editor artwork.
    """
    from PIL import Image
    slots = [0, 2, 3]
    tile_sets = {}
    for suffix, canvas in outputs:
        for y in range(0, canvas.height, 8):
            for x in range(0, canvas.width, 8):
                colors = frozenset(pixel[:3] for pixel in canvas.crop((x,y,x+8,y+8)).getdata() if pixel[3])
                if len(colors) > 15:
                    raise ValueError(f'{suffix}: tile ({x//8}, {y//8}) tem {len(colors)} cores; o limite é 15 mais transparência.')
                tile_sets[(suffix,x//8,y//8)] = colors
    palettes = []
    assignments = {}
    for colors in sorted(set(tile_sets.values()), key=lambda c: (-len(c), sorted(c))):
        choices = [(len(colors | palette), i) for i, palette in enumerate(palettes) if len(colors | palette) <= 15]
        if choices:
            _, index = min(choices)
            palettes[index] |= colors
        else:
            if len(palettes) == len(slots):
                raise ValueError('O cenário precisa de mais de três paletas. Reduza as cores; nenhuma cor foi alterada automaticamente.')
            index = len(palettes)
            palettes.append(set(colors))
        assignments[colors] = index
    palette_rgb = [(0,0,0)] * 256
    indices = []
    for slot, colors in zip(slots, palettes):
        colors = sorted(colors)
        indices.append({color: slot*16+i+1 for i,color in enumerate(colors)})
        for i,color in enumerate(colors):
            for offset in (0,64,128,192): palette_rgb[offset+slot*16+i+1] = color
    palette = [v for color in palette_rgb for v in color]
    encoded = {}
    for suffix, canvas in outputs:
        indexed = Image.new('P', canvas.size)
        indexed.putpalette(palette)
        pixels = []
        priorities = layers.get('priority', [0]*width*height) if suffix == 'bg' else [1]*width*height
        panorama = suffix == 'pan'  # its own 512 x 256 plane, always behind the map
        for i, pixel in enumerate(canvas.getdata()):
            x, y = i % canvas.width, i // canvas.width
            palette_index = assignments[tile_sets[(suffix,x//8,y//8)]]
            slot = slots[palette_index]
            color = indices[palette_index].get(pixel[:3], slot*16) if pixel[3] else slot*16
            high = not panorama and x < width*8 and y < height*8 and priorities[(y//8)*width+x//8] != 0
            pixels.append(color | (128 if high else 0))
        indexed.putdata(pixels)
        indexed.info['transparency'] = bytes(0 if i%16==0 else 255 for i in range(256))
        buffer = BytesIO()
        indexed.save(buffer, format='PNG')
        encoded[suffix] = buffer.getvalue()
    return encoded


def object_visuals(project, source, root, video_rate=60):
    """Export independent sprites, never bake previews/objects into scenery."""
    from PIL import Image
    import hashlib
    def integer(value, label, low=0, high=32767):
        number = float(value)
        if not number.is_integer() or not low <= number <= high:
            raise ValueError(f'{label}: use um inteiro entre {low} e {high}.')
        return int(number)
    def confined(filename, base):
        target = (base / filename).resolve()
        if not target.is_relative_to(project.resolve()):
            raise ValueError('Imagem de objeto precisa estar dentro do projeto.')
        return target
    if video_rate not in (50,60):
        raise ValueError('videoRate precisa ser 50 ou 60.')
    tilesets = []
    for node in root.findall('tileset'):
        base = source.parent
        first = integer(node.get('firstgid'), 'firstgid', 1, 0x1fffffff)
        if node.get('source'):
            tsx = confined(node.get('source'), base)
            node, base = ET.parse(tsx).getroot(), tsx.parent
        tilesets.append((first, node, base))
    definitions, resources, ids = [], {}, set()
    colors = set()
    for obj in root.findall('objectgroup/object'):
        if obj.get('type') == 'player_spawn':
            continue
        properties = {p.get('name'): p.get('value', p.text or '') for p in obj.findall('properties/property')}
        raw = properties.get('retroStudio.visual')
        if not raw:
            continue
        if len(raw) > 4096:
            raise ValueError('Metadados do visual ultrapassam 4 KiB.')
        visual = json.loads(raw)
        if not isinstance(visual, dict):
            raise ValueError('Visual de objeto inválido.')
        oid = integer(obj.get('id'), 'ID do objeto', 0, 65534)
        if oid in ids:
            raise ValueError('ID de objeto visual duplicado.')
        ids.add(oid)
        if len(ids) > 80:
            raise ValueError('O mapa ultrapassa 80 objetos visuais.')
        gid = integer(visual.get('gid'), 'GID do visual', 1, 0x1fffffff)
        tw = integer(visual.get('width', 1), 'Largura do recorte', 1, 64)
        th = integer(visual.get('height', 1), 'Altura do recorte', 1, 64)
        count = integer(visual.get('frames', 1), 'Quadros', 1, 16)
        fps = integer(visual.get('fps', 4), 'FPS', 1, 12)
        loop = visual.get('loop', True)
        if not isinstance(loop, bool):
            raise ValueError('Loop do visual precisa ser booleano.')
        native_w, native_h = tw * 8, th * 8
        dw = visual.get('displayWidth') or (float(visual['displayHeight']) * native_w / native_h if visual.get('displayHeight') else native_w)
        dh = visual.get('displayHeight') or (float(visual['displayWidth']) * native_h / native_w if visual.get('displayWidth') else native_h)
        dw = integer(dw, 'Largura exibida', 1, 128)
        dh = integer(dh, 'Altura exibida', 1, 128)
        cw, ch = (dw + 7)//8*8, (dh + 7)//8*8
        match = next(((first, node, base) for first, node, base in sorted(tilesets, key=lambda ts: -ts[0])
                      if first <= gid < first + int(node.get('tilecount'))), None)
        if match is None:
            raise ValueError(f'Objeto {oid}: GID sem tileset.')
        first, node, base = match
        columns = integer(node.get('columns'), 'Colunas do tileset', 1, 4096)
        local = gid - first
        x, y = local % columns * 8, local // columns * 8
        image_node = node.find('image')
        if image_node is None:
            raise ValueError('Tileset de objeto sem imagem.')
        filename = confined(image_node.get('source'), base)
        with Image.open(filename) as opened:
            if opened.width * opened.height > 16*1024*1024:
                raise ValueError('Imagem de objeto ultrapassa 16 milhões de pixels.')
            image = opened.convert('RGBA')
        if x + native_w*count > columns*8 or x + native_w*count > image.width or y + native_h > image.height:
            raise ValueError(f'Objeto {oid}: quadros ultrapassam os limites do tileset.')
        sheet = Image.new('RGBA', (cw*count, ch))
        for frame in range(count):
            crop = image.crop((x+frame*native_w,y,x+(frame+1)*native_w,y+native_h))
            crop = crop.resize((dw,dh), Image.Resampling.NEAREST)
            if any(p[3] not in (0,255) for p in crop.getdata()):
                raise ValueError(f'Objeto {oid}: transparência parcial não é suportada.')
            if not any(p[3] for p in crop.getdata()):
                raise ValueError(f'Objeto {oid}: quadro {frame} vazio; o ResComp não preserva esse quadro.')
            colors.update(p[:3] for p in crop.getdata() if p[3])
            sheet.paste(crop, (frame*cw,0))
        key = hashlib.sha256(sheet.tobytes()+str((sheet.size,cw,ch,count)).encode()).hexdigest()
        resources.setdefault(key, {'sheet': sheet, 'w': cw, 'h': ch, 'frames': count})
        if len(resources) > 48:
            raise ValueError('O mapa ultrapassa 48 recursos de objetos distintos; reutilize visuais ou divida em salas.')
        anchor = visual.get('anchor', 'top-left')
        if anchor not in ('top-left','center','bottom-center'):
            raise ValueError('Apoio do visual inválido.')
        px, py = float(obj.get('x',0)), float(obj.get('y',0))
        bw, bh = float(obj.get('width',8)), float(obj.get('height',8))
        if anchor == 'center':
            px += (bw-dw)/2; py += (bh-dh)/2
        elif anchor == 'bottom-center':
            px += (bw-dw)/2; py += bh-dh
        px += float(properties.get('spriteOffsetX',0)); py += float(properties.get('spriteOffsetY',0))
        px, py = integer(px, 'Posição X do visual', -32768, 32767), integer(py, 'Posição Y do visual', -32768, 32767)
        # An object entirely outside the map can never be seen: refuse it instead of exporting it silently.
        map_w, map_h = int(root.get('width')) * 8, int(root.get('height')) * 8
        if px >= map_w or py >= map_h or px + dw <= 0 or py + dh <= 0:
            raise ValueError(f'Objeto {oid}: o visual fica fora do mapa ({px}, {py} em um mapa de {map_w} × {map_h} pixels).')
        priority = integer(properties.get('priority',1), 'Prioridade do objeto', 0, 1)
        def flip(name):
            value = properties.get(name, 'false')
            if value not in ('true','false','1','0',True,False,1,0):
                raise ValueError(f'{name}: use true ou false.')
            return int(value in ('true','1',True,1))
        flip_h, flip_v = flip('flipH'), flip('flipV')
        # Flip the displayed region, compensating transparent cell padding.
        px = integer(px + (dw if flip_h else 0), 'Apoio X do visual', -32768,32767)
        py = integer(py + (dh if flip_v else 0), 'Apoio Y do visual', -32768,32767)
        ticks = max(1, round(video_rate/fps))
        definitions.append({'id': oid, 'key': key, 'x': px, 'y': py,
                            'priority': priority, 'flipH': flip_h, 'flipV': flip_v, 'durations': [ticks]*count, 'loop': int(loop)})
    if definitions and not all((project / ('src/retro_runtime/retro_scene.'+ext)).is_file() for ext in ('h','c')):
        raise ValueError('Instale o módulo scene em Recursos > Runtime antes de exportar objetos.')
    if len(colors) > 15:
        raise ValueError(f'Objetos precisam de {len(colors)} cores; PAL1 admite 15 mais transparência. Nenhuma cor foi reduzida.')
    indices = {color:i+1 for i,color in enumerate(sorted(colors))}
    palette = [0,0,0]+[channel for color in sorted(colors) for channel in color]
    palette += [0]*(768-len(palette))
    files, records = {}, []
    for resource in resources.values():
        sheet = resource['sheet']
        indexed = Image.new('P', sheet.size)
        indexed.putpalette(palette)
        indexed.putdata([indices[p[:3]] if p[3] else 0 for p in sheet.getdata()])
        indexed.info['transparency'] = 0
        buffer = BytesIO(); indexed.save(buffer,format='PNG',bits=4)
        data = buffer.getvalue(); digest = hashlib.sha256(data).hexdigest()
        signature = hashlib.sha256(data+str((resource['w'],resource['h'],resource['frames'])).encode()).hexdigest()
        filename = 'res/generated/map-object-'+signature+'.png'
        symbol = 'GAME_MAP_OBJECT_'+signature[:16].upper()
        resource.update({'symbol':symbol,'path':filename})
        if any(r['symbol']==symbol and r['path']!=filename for r in records):
            raise ValueError('Colisão no ID do recurso visual.')
        if filename not in files:
            files[filename] = data
            records.append({'path':filename,'hash':digest,'symbol':symbol,'width':resource['w'],'height':resource['h']})
    header = '#ifndef RETROSTUDIO_MAP_OBJECTS_H\n#define RETROSTUDIO_MAP_OBJECTS_H\n'
    header += f'#define GAME_MAP_OBJECT_COUNT {len(definitions)}\n'
    lines = []
    if definitions:
        header += '#include "../retro_runtime/retro_scene.h"\n#include "../../res/resources.h"\n'
        rows = []
        for i,d in enumerate(sorted(definitions,key=lambda d:d['id'])):
            resource = resources[d['key']]
            header += f'static const u16 gameMapObjectTimes{i}[] = {{'+','.join(map(str,d['durations']))+'};\n'
            rows.append('{'+','.join(map(str,[d['id'],'&'+resource['symbol'],d['x'],d['y'],0,0,0,1,d['priority'],d['flipH'],d['flipV'],d['loop'],f'gameMapObjectTimes{i}',len(d['durations'])]))+'}')
        header += 'static const RetroSceneObjectDefinition gameMapObjectDefinitions[] = {\n'+',\n'.join(rows)+'\n};\n'
        header += 'static inline u32 gameMapObjectTileBudget(void) { return '
        header += '+'.join('(u32)'+resources[d['key']]['symbol']+'.maxNumTile' for d in definitions)+'; }\n'
        header += 'static inline void gameMapObjectPalette(void) { PAL_setPalette(PAL1,'
        header += next(iter(resources.values()))['symbol']+'.palette->data,DMA); }\n'
        for record in records:
            resource = next(r for r in resources.values() if r['path']==record['path'])
            lines.append(f'SPRITE {record["symbol"]} "{record["path"][4:]}" {resource["w"]//8} {resource["h"]//8} NONE 0 NONE')
    header += '#endif\n'
    return {'header':header,'files':files,'resources':records,'lines':lines,'objects':definitions}


def export_map(config=None, source_maps=None, writer=None, prior_manifest=None, resource_text=None, scenery=False):
    """Compile one map; an injected writer captures outputs without publication.

    scenery: the caller draws this room with the scenery runtime (one streamed map
    layer on BG_A, panoramas on BG_B). Only then are panoramas exported."""
    emit = writer or write_changed
    if config is None:
        config = json.loads((ROOT / 'retro-studio.json').read_text())
    if source_maps is None:
        source_maps = config.get('mapExport', {}).get('sourceMaps', [])
    if not source_maps:
        raise ValueError('Configure mapExport.sourceMaps em retro-studio.json.')
    if len(source_maps) != 1:
        raise ValueError('Este adaptador exibe um mapa inicial. Para várias salas, configure um exportador de jogo que faça a transição entre elas.')
    source = ROOT / source_maps[0]
    if not source.exists():
        # A newly created skeleton has no map yet; keep its normal sample build usable.
        emit(ROOT / 'src/generated/map_data.h', '''#ifndef RETROSTUDIO_MAP_DATA_H
#define RETROSTUDIO_MAP_DATA_H
#include <genesis.h>
#define GAME_MAP_ENABLED 0
#define GAME_MAP_WIDTH 0
#define GAME_MAP_HEIGHT 0
#define GAME_MAP_WIDTH_PIXELS 0
#define GAME_MAP_HEIGHT_PIXELS 0
#define GAME_MAP_SPAWN_X 0
#define GAME_MAP_SPAWN_Y 0
#endif
''')
        emit(ROOT / 'src/generated/map_objects.h', '#ifndef RETROSTUDIO_MAP_OBJECTS_H\n#define RETROSTUDIO_MAP_OBJECTS_H\n#define GAME_MAP_OBJECT_COUNT 0\n#endif\n')
        print(f'Mapa ainda não criado: {source.relative_to(ROOT)}; mantendo a tela de exemplo.')
        return
    try:
        from PIL import Image
    except ImportError as error:
        raise RuntimeError('Instale Pillow no Python usado para compilar para exportar mapas.') from error
    root = ET.parse(source).getroot()
    width, height = int(root.get('width')), int(root.get('height'))
    if root.get('tilewidth') != '8' or root.get('tileheight') != '8':
        raise ValueError('O mapa precisa usar tiles de 8 × 8 pixels.')
    if not 1 <= width <= 256 or not 1 <= height <= 256:
        raise ValueError('Dimensões do mapa fora do limite de 256 × 256 tiles.')
    props = {item.get('name'): item.get('value', item.text or '') for item in root.findall('./properties/property')}
    parallax = json.loads(props.get('retroStudio.parallaxLayers', '[]'))
    if parallax and not scenery:
        raise ValueError('Panoramas móveis são executados nas salas do mundo (Runtime → Mundo), com o runtime de cenário. O mapa inicial avulso não os desenha; o panorama não será descartado.')
    if scenery and props.get('retroStudio.backgroundImage'):
        raise ValueError('Fundo fixo e panoramas no mesmo mapa: o fundo fixo é desenhado junto do cenário e cobriria os panoramas. Transforme o fundo em um panorama (velocidade 1 acompanha o mapa) ou remova-o.')
    if props.get('retroStudio.musicTrack'):
        raise ValueError('A música do mapa exige integração com o catálogo de áudio do jogo. Configure o exportador desse jogo; a seleção de música não será ignorada.')
    # A spawn visual previews the player in the editor. The game creates its
    # player sprite separately; preserve this metadata without baking the
    # preview charset into scenery or requiring an extra object runtime.
    # Triggers are exported by the IDE into src/generated/cutscene_adapter.h; without
    # that export nothing would consume them, so the map is refused instead.
    if any(o.get('type') == 'cutscene_trigger' for o in root.findall('objectgroup/object')) and not (ROOT / '.retrostudio/cutscene-adapter-export.json').is_file():
        raise ValueError('Cenas precisam do runtime de cutscenes; o gatilho não será ignorado. Exporte em Runtime → Cutscenes: gatilhos e flags.')
    previous_manifest = ROOT / 'res/generated/map-manifest.json'
    if prior_manifest is None:
        prior_manifest = json.loads(previous_manifest.read_text()) if previous_manifest.exists() else {}
    prior_object_resources = prior_manifest.get('objectResources', [])
    object_output = object_visuals(ROOT, source, root, config.get('mapExport', {}).get('videoRate', 60))
    size = width * height
    layers = {layer.get('name'): csv_values(layer, size) for layer in root.findall('layer')}
    used_gids = {(v & 0x1fffffff)+1 for name in ('Tile Layer 1','Tile Layer 2') for v in layers.get(name,[]) if v >= 0}
    tilesets = []
    for node in root.findall('tileset'):
        base = source.parent
        gid = int(node.get('firstgid'))
        if node.get('source'):
            tsx = base / node.get('source')
            node, base = ET.parse(tsx).getroot(), tsx.parent
        columns = int(node.get('columns'))
        count = int(node.get('tilecount'))
        if not any(gid <= value < gid+count for value in used_gids):
            continue
        image = Image.open(base / node.find('image').get('source')).convert('RGBA')
        tilesets.append((gid, count, columns, image))
    tilesets.sort(reverse=True, key=lambda item: item[0])
    outputs = []
    for layer_name, suffix in [('Tile Layer 1', 'bg'), ('Tile Layer 2', 'fg')]:
        # ResComp MAP uses 16 × 16 metatiles; padding is outside the logical map.
        canvas = Image.new('RGBA', (((width + 1) // 2) * 16, ((height + 1) // 2) * 16))
        if suffix == 'bg':
            logical = Image.new('RGBA', (width*8, height*8))
            draw_background(logical, source, props)
            canvas.paste(logical, (0,0))
        for i, value in enumerate(layers.get(layer_name, [-1] * size)):
            if value < 0:
                continue
            # Retro Studio's TMX serializer stores editor GIDs minus one
            # (and -1 for an empty cell); match decodeTmxCell exactly.
            gid = (value & 0x1fffffff) + 1
            if value & 0x20000000:
                raise ValueError('Flip diagonal não é suportado neste jogo.')
            ts = next((ts for ts in tilesets if ts[0] <= gid < ts[0] + ts[1]), None)
            if ts is None:
                raise ValueError(f'Tile {gid} não possui imagem no TMX.')
            first, count, columns, image = ts
            local = gid - first
            x, y = local % columns * 8, local // columns * 8
            tile = image.crop((x, y, x + 8, y + 8))
            if value & 0x80000000:
                tile = tile.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            if value & 0x40000000:
                tile = tile.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
            canvas.alpha_composite(tile, (i % width * 8, i // width * 8))
        # The editor uses a dark preview canvas; hardware has no fractional alpha.
        # Keep fully transparent pixels, and reject partial alpha instead of changing art.
        if any(pixel[3] not in (0,255) for pixel in canvas.getdata()):
            raise ValueError('O cenário resultante tem transparência parcial. Use fundo opaco ou opacidade 100%.')
        outputs.append((suffix, canvas))
    scenery_record = None
    if scenery:
        settings = scenery_settings(config)
        if any(pixel[3] for pixel in outputs[1][1].getdata()):
            raise ValueError('Esta sala usa cenário e frente (os dois planos do console) e também panoramas. Não sobra plano: mova os tiles da frente para a camada de cenário (a prioridade por tile continua valendo) ou remova os panoramas.')
        bands, factor_y = [], 0
        if parallax:
            panorama, bands, factor_y = compose_panorama(source, parallax, settings['viewWidth'], settings['viewHeight'], width*8, height*8)
            outputs.append(('pan', panorama))
    encoded = encode_planes(outputs, width, height, layers)
    if scenery:
        # Over the stored size: the image is padded to 16-pixel blocks and the runtime window reaches the padding.
        stored_width, stored_height = ((width + 1) // 2) * 2, ((height + 1) // 2) * 2
        patterns, worst, _ = stream_requirement(encoded['bg'], stored_width, stored_height, settings['viewWidth'], settings['viewHeight'])
        if patterns > 2048:
            raise ValueError(f'O cenário desta sala tem {patterns} tiles diferentes; uma célula do console só endereça 2048. Reduza a variedade (imagens importadas inteiras costumam passar disso) ou divida a sala.')
        panorama_patterns = stream_requirement(encoded['pan'], PLANE_WIDTH//8, PLANE_HEIGHT//8, settings['viewWidth'], settings['viewHeight'])[0] if parallax else 0
        if settings['tiles'] and panorama_patterns + worst > settings['tiles']:
            raise ValueError(f'Esta sala precisa de {panorama_patterns + worst} tiles de VRAM ao mesmo tempo ({panorama_patterns} dos panoramas e até {worst} do trecho de mapa em volta da tela) e a reserva de cenário é de {settings["tiles"]}. Aumente scenery.tiles, simplifique os panoramas ou reduza a variedade de tiles próximos.')
        scenery_record = {'bands': [list(band) for band in bands], 'factorY': factor_y, 'panorama': bool(parallax), 'patterns': patterns,
                          'panoramaPatterns': panorama_patterns, 'windowPatterns': worst, **settings}
    collision = [31 if v == 1 else max(0, v) & 255 for v in layers.get('collision', [0] * size)]
    spawn = next((o for o in root.findall('objectgroup/object') if o.get('type') == 'player_spawn'), None)
    sx, sy = 0, 0
    frame = config['mapExport'].get('playerFrame', {})
    if spawn is not None:
        sx = round(float(spawn.get('x', 0)))
        sy = round(float(spawn.get('y', 0)))
        if frame:
            sx += round(float(spawn.get('width', 0))/2 - float(frame['width'])/2)
            sy += round(float(spawn.get('height', 0)) - float(frame['height']))
    def integer(value, name, minimum=0, maximum=32767):
        number = float(value)
        if not number.is_integer() or not minimum <= number <= maximum:
            raise ValueError(f'{name}: use um inteiro entre {minimum} e {maximum}.')
        return int(number)
    rectangles, rectangle_groups, slopes = [], [], []
    geometry_enabled = config['mapExport'].get('runtimeGeometry', False) is True
    for obj in root.findall('objectgroup/object'):
        kind = obj.get('type')
        if kind not in ('collision_solid', 'collision_clear', 'collision_platform', 'collision_slope'):
            continue
        if kind in ('collision_platform', 'collision_slope') and not geometry_enabled:
            raise ValueError('Plataformas/rampas exigem mapExport.runtimeGeometry=true e o exportador atual.')
        rect = [integer(obj.get(k, 0), k, 1 if k in ('width','height') else 0)
                for k in ('x','y','width','height')]
        if rect[0]+rect[2] > width*8 or rect[1]+rect[3] > height*8:
            raise ValueError('Retângulo de colisão ultrapassa os limites do mapa.')
        properties = {p.get('name'): p.get('value', p.text or '') for p in obj.findall('properties/property')}
        group = integer(properties.get('collisionGroup', 1), 'collisionGroup', 1, 65535) if geometry_enabled else 1
        if kind == 'collision_slope':
            left = integer(properties.get('leftHeight', 0), 'leftHeight', 0, rect[3])
            right = integer(properties.get('rightHeight', 0), 'rightHeight', 0, rect[3])
            slopes.append(rect + [group, left, right])
        else:
            rectangles.append(rect + [31 if kind == 'collision_solid' else 17 if kind == 'collision_platform' else 0])
            rectangle_groups.append(group)
    for sx0,sy0,sw,sh,group,left,right in slopes:
        for x,y,w,h,value in rectangles:
            if value == 0 and x < sx0+sw and x+w > sx0 and y < sy0+sh and y+h > sy0:
                raise ValueError('Recorte sem colisão sobreposto a uma rampa. Remova ou ajuste a própria rampa; recortes parciais de rampas ainda não são suportados.')
    if geometry_enabled and (len(slopes) > 4096 or len(rectangles) > 4096):
        raise ValueError('Geometria do runtime aceita até 4096 rampas e 4096 retângulos de autoria.')
    spawn_props = {} if spawn is None else {p.get('name'): p.get('value', p.text or '') for p in spawn.findall('properties/property')}
    defaults = config['mapExport'].get('playerHitbox', {})
    hitbox = [integer(spawn_props.get('hitbox'+k.upper(), defaults.get(k, fallback)), 'hitbox'+k.upper(), 1 if k in ('w','h') else 0)
              for k, fallback in [('x',0),('y',0),('w',frame.get('width',8)),('h',frame.get('height',8))]]
    fw, fh = integer(frame.get('width',8), 'playerFrame.width', 8, 128), integer(frame.get('height',8), 'playerFrame.height', 8, 128)
    if fw % 8 or fh % 8:
        raise ValueError('O quadro do personagem deve ter dimensões múltiplas de 8 pixels.')
    if hitbox[0]+hitbox[2] > fw or hitbox[1]+hitbox[3] > fh:
        raise ValueError('A caixa de colisão do personagem precisa caber no quadro do sprite.')
    # Debug mode temporarily sets PAL0 color 15 to white (restored on exit).
    palette = Image.open(BytesIO(encoded['bg'])).getpalette()
    color = 15
    field = bytearray(width*8*height*8)
    stride = width*8
    groups = array('H', [1]) * len(field) if geometry_enabled else None
    for y in range(height*8):
        for x in range(stride):
            value = collision[(y//8)*width+x//8]
            field[y*stride+x] = value & 15 if value >> 4 == 1 else 0
    for index, (x,y,w,h,value) in enumerate(rectangles):
        for row in range(y,y+h):
            field[row*stride+x:row*stride+x+w] = bytes([value & 15])*w
            if groups is not None:
                groups[row*stride+x:row*stride+x+w] = array('H', [rectangle_groups[index]]) * w
    debug = Image.new('P', outputs[0][1].size, 128)
    debug.putpalette(palette)
    for y in range(height*8):
        for x in range(stride):
            v = field[y*stride+x]
            edge = ((v & 1 and (y == 0 or not field[(y-1)*stride+x] & 1)) or
                    (v & 2 and (y == height*8-1 or not field[(y+1)*stride+x] & 2)) or
                    (v & 4 and (x == 0 or not field[y*stride+x-1] & 4)) or
                    (v & 8 and (x == stride-1 or not field[y*stride+x+1] & 8)))
            if edge: debug.putpixel((x,y),128+color)
    from PIL import ImageDraw
    for x,y,w,h,group,left,right in slopes:
        ImageDraw.Draw(debug).line((x,y+left,x+w-1,y+right),fill=128+color)
    buffer = BytesIO(); debug.save(buffer, format='PNG'); encoded['collision'] = buffer.getvalue()
    from PIL import ImageDraw
    box = Image.new('P', (fw,fh), 0); box.putpalette(palette)
    x,y,w,h = hitbox
    ImageDraw.Draw(box).rectangle((x,y,x+w-1,y+h-1), outline=color)
    buffer = BytesIO(); box.save(buffer, format='PNG'); encoded['hitbox'] = buffer.getvalue()
    header = '#ifndef RETROSTUDIO_MAP_DATA_H\n#define RETROSTUDIO_MAP_DATA_H\n#include <genesis.h>\n#define GAME_MAP_ENABLED 1\n'
    for key, value in {'WIDTH': width, 'HEIGHT': height, 'WIDTH_PIXELS': width * 8, 'HEIGHT_PIXELS': height * 8, 'SPAWN_X': sx, 'SPAWN_Y': sy}.items():
        header += f'#define GAME_MAP_{key} {value}\n'
    header += 'static const u8 gameMapCollision[GAME_MAP_WIDTH * GAME_MAP_HEIGHT] = {\n'
    header += ',\n'.join('    ' + ','.join(map(str, collision[y * width:(y + 1) * width])) for y in range(height))
    header += '\n};\n'
    for k,v in zip(('X','Y','W','H'),hitbox): header += f'#define GAME_PLAYER_HITBOX_{k} {v}\n'
    header += f'#define GAME_MAP_COLLISION_RECT_COUNT {len(rectangles)}\n'
    header += 'static const s16 gameMapCollisionRects[][5] = {\n'
    header += ',\n'.join('{' + ','.join(map(str,r)) + '}' for r in (rectangles or [[0,0,0,0,0]]))
    header += '\n};\nstatic inline u8 gameMapCollisionAt(s16 x, s16 y) {\n'
    header += '    s16 i; u8 cell;\n    if (x < 0 || y < 0 || x >= GAME_MAP_WIDTH_PIXELS || y >= GAME_MAP_HEIGHT_PIXELS) return 31;\n'
    header += '    cell = gameMapCollision[(y/8)*GAME_MAP_WIDTH+x/8];\n'
    header += '    for (i=0; i<GAME_MAP_COLLISION_RECT_COUNT; i++) { const s16 *r=gameMapCollisionRects[i]; if (x>=r[0] && y>=r[1] && x<r[0]+r[2] && y<r[1]+r[3]) cell=r[4]; }\n    return cell;\n}\n'
    if geometry_enabled:
        header += runtime_geometry(field, groups, stride, height*8, slopes)
    header += '#endif\n'

    for filename, data in object_output['files'].items():
        emit(ROOT / filename, data)
    emit(ROOT / 'src/generated/map_objects.h', object_output['header'])
    for suffix, data in encoded.items():
        emit(ROOT / f'res/generated/map-{suffix}.png', data)
    emit(ROOT / 'src/generated/map_data.h', header)
    # Preserve every object/property for game-specific behavior, without Alice-specific names.
    manifest = {'version': 1, 'source': source_maps[0], 'width': width, 'height': height, **({'scenery': scenery_record} if scenery_record else {}),
                'properties': props, 'objectResources': object_output['resources'], 'objects': [{'attributes': dict(o.attrib), 'properties': {p.get('name'): p.get('value', p.text or '') for p in o.findall('properties/property')}} for o in root.findall('objectgroup/object')]}
    emit(ROOT / 'res/generated/map-manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
    resources = ROOT / 'res/resources.res'
    names = {'GAME_MAP', 'GAME_MAP_PALETTE', 'GAME_MAP_TILES', 'GAME_MAP_FG', 'GAME_MAP_FG_TILES', 'MAP_MAP', 'MAP_FG_MAP', 'GAME_MAP_COLLISION_TILES', 'GAME_MAP_COLLISION', 'GAME_MAP_HITBOX',
             'GAME_MAP_STREAM_TILES', 'GAME_MAP_STREAM', 'GAME_MAP_PAN_TILES', 'GAME_MAP_PAN'}
    names.update(r['symbol'] for r in prior_object_resources)
    names.update(r['symbol'] for r in object_output['resources'])
    if writer is None:
        # The skeleton Makefile still builds its legacy map. Keep old shared
        # sprites declared when world headers/callers continue to own them.
        world_record = ROOT / '.retrostudio/world-map-export.json'
        cursor = ROOT
        for part in ('.retrostudio', 'world-map-export.json'):
            cursor = cursor / part
            if cursor.is_symlink():
                raise ValueError('World ownership must not contain links.')
        if world_record.exists():
            if not world_record.is_file() or world_record.stat().st_size > 1024*1024:
                raise ValueError('Invalid world resource ownership.')
            ownership = json.loads(world_record.read_text())
            records = ownership.get('resources')
            if ownership.get('version') not in (1, 2) or not isinstance(records, list) or len(records) > 1024:
                raise ValueError('Invalid world resource ownership.')
            next_symbols = {r['symbol'] for r in object_output['resources']}
            names.difference_update(r['symbol'] for r in records
                                    if isinstance(r, dict) and re.fullmatch(r'GAME_MAP_OBJECT_[A-F0-9]{16}', str(r.get('symbol', '')))
                                    and r['symbol'] not in next_symbols)
    if resource_text is None:
        resource_text = resources.read_text()
    lines = [line for line in resource_text.splitlines() if not (len(line.split()) > 1 and line.split()[1] in names)]
    lines += ['PALETTE GAME_MAP_PALETTE "generated/map-bg.png"',
              'TILESET GAME_MAP_TILES "generated/map-bg.png" NONE ALL',
              'MAP GAME_MAP "generated/map-bg.png" GAME_MAP_TILES NONE',
              'TILESET GAME_MAP_FG_TILES "generated/map-fg.png" NONE ALL',
              'MAP GAME_MAP_FG "generated/map-fg.png" GAME_MAP_FG_TILES NONE',
              'TILESET GAME_MAP_COLLISION_TILES "generated/map-collision.png" NONE ALL',
              'MAP GAME_MAP_COLLISION "generated/map-collision.png" GAME_MAP_COLLISION_TILES NONE',
              f'SPRITE GAME_MAP_HITBOX "generated/map-hitbox.png" {fw//8} {fh//8} NONE 0']
    if scenery:
        # Uncompressed: streamed patterns go from ROM to VRAM by DMA, one tile at a time.
        lines += ['TILESET GAME_MAP_STREAM_TILES "generated/map-bg.png" NONE ALL',
                  'TILEMAP GAME_MAP_STREAM "generated/map-bg.png" GAME_MAP_STREAM_TILES NONE ALL']
        if scenery_record['panorama']:
            lines += ['TILESET GAME_MAP_PAN_TILES "generated/map-pan.png" NONE ALL',
                      'TILEMAP GAME_MAP_PAN "generated/map-pan.png" GAME_MAP_PAN_TILES NONE ALL']
    lines += object_output['lines']
    emit(resources, '\n'.join(lines) + '\n')
    print(f'Mapa exportado: {width} × {height} tiles; {sum(bool(v) for v in collision)} células de colisão; spawn ({sx}, {sy}).')


if __name__ == '__main__':
    export_map()
