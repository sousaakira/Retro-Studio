#!/usr/bin/env python3
"""Quais classes do Godot compiladas no Retro Studio são usadas, e por quem.

Uso: classes_uso.py <repo> <doctool> <saida.json> <pasta de projeto>...
"""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

repo, doctool, out = sys.argv[1], sys.argv[2], sys.argv[3]
projects = sys.argv[4:]

# 1. Classes do executável (doctool gerado por ele) e a herança.
classes = {}
for root, _, files in os.walk(doctool):
    for f in files:
        if f.endswith(".xml"):
            try:
                el = ET.parse(os.path.join(root, f)).getroot()
            except ET.ParseError:
                continue
            if el.tag == "class" and el.get("name"):
                classes[el.get("name")] = el.get("inherits") or ""

def chain(c):
    seen = []
    while c and c not in seen:
        seen.append(c)
        c = classes.get(c, "")
    return seen

# 2. Fontes que entram no build.
enabled = set(open(os.path.join(repo, "modules/modules_enabled.gen.h")).read().lower().replace("#define module_", " ").replace("_enabled", " ").split())
src_dirs = ["core", "scene", "servers", "editor", "main", "drivers", "platform/linuxbsd"]
src_dirs += ["modules/" + m for m in sorted(enabled) if os.path.isdir(os.path.join(repo, "modules", m))]
skip_parts = ("/tests/", "/thirdparty/", "/doc_classes/", ".gen.", "/icons/")

# Editores tirados com #ifndef RETRO_STUDIO no register_editor_types.cpp: o código deles compila, mas não roda.
removed_plugins = []
depth = 0
for line in open(os.path.join(repo, "editor/register_editor_types.cpp")):
    s = line.strip()
    if s.startswith("#ifndef RETRO_STUDIO"):
        depth += 1
    elif s.startswith("#if"):
        depth += 1 if depth else 0
    elif s.startswith("#endif") and depth:
        depth -= 1
    elif depth:
        m = re.search(r"add_by_type<(\w+)>", s)
        if m:
            removed_plugins.append(m.group(1))

files = []
for d in src_dirs:
    for root, _, fs in os.walk(os.path.join(repo, d)):
        for f in fs:
            if f.endswith((".h", ".cpp", ".inc")):
                p = os.path.join(root, f)
                if not any(x in p for x in skip_parts):
                    files.append(p)

text = {}
for p in files:
    try:
        t = open(p, encoding="utf-8", errors="ignore").read()
    except OSError:
        continue
    t = re.sub(r"//[^\n]*", "", t)  # Comentários não contam.
    t = re.sub(r"/\*.*?\*/", "", t, flags=re.S)
    text[p] = t

# Arquivos dos editores tirados (o .h que declara o plugin e o .cpp de mesmo nome).
removed_files = set()
for plugin in removed_plugins:
    for p, t in text.items():
        if p.endswith(".h") and re.search(r"\bclass\s+" + plugin + r"\b", t):
            removed_files.add(p)
            removed_files.add(p[:-2] + ".cpp")

def rel(p):
    return os.path.relpath(p, repo)

# Arquivos que definem cada classe (GDCLASS(X, ...)): o próprio código da classe não conta como uso.
own = {}
for p, t in text.items():
    for m in re.finditer(r"GDCLASS\(\s*(\w+)\s*,", t):
        base = os.path.splitext(p)[0]
        own.setdefault(m.group(1), set()).update({base + ".h", base + ".cpp"})

register_re = re.compile(r"register_\w*types\.cpp$|register_scene_types|register_server_types|register_core_types|register_editor_types|register_types\.cpp$")

result = {}
for c in sorted(classes):
    pat = re.compile(r"\b" + re.escape(c) + r"\b")
    users_active, users_removed = [], []
    for p, t in text.items():
        if p in own.get(c, ()) or register_re.search(p) or not pat.search(t):
            continue
        (users_removed if p in removed_files else users_active).append(rel(p))
    result[c] = {"herda": chain(c)[1:], "codigo": sorted(users_active), "so_editores_tirados": sorted(users_removed)}

# 3. Uso nos projetos (cenas e recursos em texto).
type_re = re.compile(r'type="(\w+)"')
for proj in projects:
    for root, dirs, fs in os.walk(proj):
        dirs[:] = [d for d in dirs if d not in (".godot", "out", ".git")]
        for f in fs:
            if f.endswith((".tscn", ".tres")):
                p = os.path.join(root, f)
                for m in type_re.finditer(open(p, encoding="utf-8", errors="ignore").read()):
                    if m.group(1) in result:
                        result[m.group(1)].setdefault("projetos", set()).add(os.path.relpath(p, os.path.dirname(proj)))
for c in result:
    result[c]["projetos"] = sorted(result[c].get("projetos", ()))

json.dump({"removidos": removed_plugins, "classes": result}, open(out, "w"), ensure_ascii=False, indent=1)
print(len(classes), "classes;", len(files), "fontes;", len(removed_files), "arquivos de editores tirados")
