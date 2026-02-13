#!/usr/bin/env python3
import os
import subprocess
from pathlib import Path

# Diretórios
base_dir = Path(__file__).parent
icon_svg = base_dir / 'assets' / 'icons' / 'icon.svg'
icon_png = base_dir / 'assets' / 'icons' / 'icon.png'

# Criar diretório se não existir
icon_svg.parent.mkdir(parents=True, exist_ok=True)

# Converter SVG para PNG com ImageMagick
if icon_svg.exists():
    try:
        cmd = [
            'convert',
            '-background', 'none',
            str(icon_svg),
            '-gravity', 'center',
            '-extent', '512x512',
            str(icon_png)
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        print(f"✅ Ícone convertido com sucesso: {icon_png}")
        print(f"   Tamanho: {icon_png.stat().st_size} bytes")
    except subprocess.CalledProcessError as e:
        print(f"❌ Erro ao converter: {e.stderr.decode()}")
        exit(1)
else:
    print(f"❌ Arquivo SVG não encontrado: {icon_svg}")
    exit(1)
