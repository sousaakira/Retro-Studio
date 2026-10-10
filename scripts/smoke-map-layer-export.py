"""Roundtrip static planes through the actual generic exporter's PNG outputs."""
from pathlib import Path
import importlib.util
import tempfile
import sys
sys.dont_write_bytecode = True
import json
from unittest.mock import patch
from PIL import Image

adapter = Path(__file__).resolve().parents[1] / 'assets/toolkit/examples/sgdk-skeleton/tools/export-map.py'
spec=importlib.util.spec_from_file_location('map_export',adapter)
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='retro-map-layers-') as directory:
    root=Path(directory); module.ROOT=root
    (root/'maps').mkdir(); (root/'res').mkdir()
    (root/'retro-studio.json').write_text(json.dumps({'mapExport':{'sourceMaps':['maps/map.tmx']}}))
    (root/'res/resources.res').write_text('IMAGE existing "existing.png" 0\n')
    Image.new('RGBA',(16,16),(32,64,128,255)).save(root/'maps/back.png')
    front=Image.new('RGBA',(8,8)); front.putpixel((0,0),(224,64,32,255)); front.save(root/'maps/front.png')
    def save(background, fg):
        props='<properties><property name="retroStudio.backgroundImage" value="back.png"/></properties>' if background else ''
        (root/'maps/map.tmx').write_text(f'''<map width="2" height="2" tilewidth="8" tileheight="8">{props}
<tileset firstgid="1" columns="1" tilecount="1"><image source="front.png"/></tileset>
<layer name="Tile Layer 1"><data encoding="csv">-1,-1,-1,-1</data></layer>
<layer name="Tile Layer 2"><data encoding="csv">-1,-1,-1,{0 if fg else -1}</data></layer>
<layer name="collision"><data encoding="csv">0,31,0,0</data></layer>
<objectgroup><object type="player_spawn" x="8" y="8" width="8" height="8"/></objectgroup></map>''')
        module.export_map()
    save(True, True)
    bg=Image.open(root/'res/generated/map-bg.png').convert('RGBA'); fg=Image.open(root/'res/generated/map-fg.png').convert('RGBA')
    assert bg.getpixel((8,8))==(32,64,128,255)
    assert fg.getpixel((8,8))==(224,64,32,255)
    assert fg.getpixel((0,0))[3]==0
    assert 'GAME_MAP_SPAWN_X 8' in (root/'src/generated/map_data.h').read_text()
    save(False, False)
    assert all(p[3]==0 for p in Image.open(root/'res/generated/map-bg.png').convert('RGBA').getdata())
    assert all(p[3]==0 for p in Image.open(root/'res/generated/map-fg.png').convert('RGBA').getdata())
    assert '0,31' in (root/'src/generated/map_data.h').read_text()
    assert 'IMAGE existing' in (root/'res/resources.res').read_text()
    # Actual exporter staging preserves the live generation until IDE publication.
    stage = root / '.retrostudio/export-staging/test'
    before_header = (root/'src/generated/map_data.h').read_bytes()
    before_resources = (root/'res/resources.res').read_bytes()
    with patch.dict('os.environ', {'RETROSTUDIO_EXPORT_STAGE': str(stage)}):
        save(True, True)
    assert (root/'src/generated/map_data.h').read_bytes() == before_header
    assert (root/'res/resources.res').read_bytes() == before_resources
    assert all(p[3] == 0 for p in Image.open(root/'res/generated/map-bg.png').convert('RGBA').getdata())
    assert Image.open(stage/'res/generated/map-bg.png').convert('RGBA').getpixel((8,8)) == (32,64,128,255)
    assert Image.open(stage/'res/generated/map-fg.png').convert('RGBA').getpixel((8,8)) == (224,64,32,255)
    assert (stage/'res/resources.res').exists()
    # More than 15 total colors, but <=15 in each hardware tile.
    art=Image.new('RGBA',(16,8))
    for y in range(8):
        for x in range(16): art.putpixel((x,y),((x%8)*32,(x//8)*224,0,255))
    encoded=module.encode_planes([('bg',art),('fg',Image.new('RGBA',(16,8)))],2,1,{})
    from io import BytesIO
    recovered=Image.open(BytesIO(encoded['bg']))
    assert list(recovered.convert('RGBA').getdata())==list(art.getdata())
    assert all(((v>>4)&3)!=1 for v in recovered.getdata())
print('smoke-map-layer-export: PASS (background, FG positions, removal, collision, spawn, multiple palettes)')
