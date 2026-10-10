#!/usr/bin/env python3
"""Developer tool (#65): builds shared/retro/hudSampleFont.js, the 8x8 sample font with
Portuguese accents offered by the HUD editor. Glyphs come from the SGDK default font
(res/image/font_default.png, MIT license, same as SGDK); accented letters are composed here.
  python3 scripts/build-hud-sample-font.py <sgdk>/res/image/font_default.png
"""
import sys
from pathlib import Path
from PIL import Image
source = Image.open(sys.argv[1]).convert('RGBA')
assert source.size == (128, 48), 'expected the 16 x 6 grid of the SGDK font'
def ascii_glyph(character):
    index = ord(character) - 32
    cell = source.crop((index % 16 * 8, index // 16 * 8, index % 16 * 8 + 8, index // 16 * 8 + 8))
    # Opaque and not black = ink (the font image uses palette index 0 as background).
    return [[1 if pixel[3] and sum(pixel[:3]) else 0 for pixel in [cell.getpixel((x, y)) for x in range(8)]] for y in range(8)]
ACCENTS = {'acute': ['....#...', '...#....'], 'circumflex': ['...#....', '..#.#...'], 'tilde': ['.##..#..', '#..##...']}
def marked(base, accent):
    glyph = ascii_glyph(base)
    if base.isupper():
        # No room above a capital: drop one row of its body and move it down.
        glyph = [[0] * 8, [0] * 8] + glyph[0:2] + glyph[3:7]
    else:
        glyph[0], glyph[1] = [0] * 8, [0] * 8  # also removes the dot of the i
    for row, line in enumerate(ACCENTS[accent]):
        glyph[row] = [1 if character == '#' else 0 for character in line]
    return glyph
def cedilla(base):
    glyph = ascii_glyph(base)
    glyph[7] = [0, 0, 0, 1, 1, 0, 0, 0]
    return glyph
COMPOSED = {'á': ('a', 'acute'), 'é': ('e', 'acute'), 'í': ('i', 'acute'), 'ó': ('o', 'acute'), 'ú': ('u', 'acute'), 'â': ('a', 'circumflex'), 'ê': ('e', 'circumflex'),
            'ô': ('o', 'circumflex'), 'ã': ('a', 'tilde'), 'õ': ('o', 'tilde'), 'Á': ('A', 'acute'), 'É': ('E', 'acute'), 'Ó': ('O', 'acute'), 'Ã': ('A', 'tilde'), 'Õ': ('O', 'tilde')}
MAP = " !?.,:;-'()/>*#%+0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzáéíóúâêôãõçÁÉÓÃÕÇ"
assert len(MAP) == 96 and len(set(MAP)) == 96
glyphs = []
for character in MAP:
    glyph = cedilla('c' if character == 'ç' else 'C') if character in 'çÇ' else marked(*COMPOSED[character]) if character in COMPOSED else ascii_glyph(character)
    glyphs.append(''.join(str(pixel) for row in glyph for pixel in row))
output = Path(__file__).resolve().parents[1] / 'shared/retro/hudSampleFont.js'
output.write_text('// Gerado por scripts/build-hud-sample-font.py a partir da fonte padrão do SGDK (licença MIT).\n'
                  '// Fonte de exemplo 8 × 8 com os acentos do português, para o editor de HUD.\n'
                  'export const HUD_SAMPLE_FONT=Object.freeze({name:\'exemplo-acentos\',map:' + repr(MAP).replace("\\'", "'") .replace('"', '"') + ',\n glyphs:Object.freeze([\n' +
                  ',\n'.join(" '" + glyph + "'" for glyph in glyphs) + '\n ]),\n colors:Object.freeze([0,0x0EEE,0,0,0,0,0,0,0,0,0,0,0,0,0,0])})\n', encoding='utf8')
print('wrote', output, len(glyphs), 'glyphs')
