#!/usr/bin/env python3
import json, sys, re, os, subprocess, collections
"""Classifica as classes a partir do JSON do classes_uso.py.

Uso: classes_resumo.py <classes_uso.json> <repo> <saida.json>
"""
ENTRADA, R, SAIDA = sys.argv[1], sys.argv[2], sys.argv[3]
C = json.load(open(ENTRADA))["classes"]
IGNORE = re.compile(r"^editor/project_upgrade/|gdextension_special_compat_hashes|\.compat\.inc$")
out = subprocess.run(["grep", "-rlE", r"GDCLASS\(", "--include=*.h", "--include=*.cpp", "core", "scene", "servers", "editor", "modules", "main", "drivers", "platform/linuxbsd"], cwd=R, capture_output=True, text=True).stdout.split()
decl = {}
for f in out:
    for m in re.finditer(r"GDCLASS\(\s*(\w+)\s*,", open(os.path.join(R, f), errors="ignore").read()):
        decl.setdefault(m.group(1), os.path.splitext(f)[0])
files_of = collections.defaultdict(set)  # base do arquivo -> classes declaradas nele
for c, b in decl.items():
    files_of[b].add(c)
def owners(path):
    return files_of.get(os.path.splitext(path)[0], set())
code = {c: [f for f in C[c]["codigo"] if not IGNORE.search(f)] for c in C}
used_proj = {c for c in C if C[c]["projetos"]}
unused = set(C) - used_proj
changed = True
while changed:
    changed = False
    for c in sorted(unused):
        # Citação que conta: de arquivo cujas classes não estão todas sem uso (ou de arquivo sem classe).
        live = [f for f in code[c] if not (owners(f) and owners(f) <= unused)]
        # Declarada no mesmo arquivo que uma classe usada: fica (o código é o mesmo).
        same = c in decl and (files_of[decl[c]] - unused)
        if live or same:
            unused.discard(c); changed = True
    for c in set(C) - unused:
        for p in C[c]["herda"]:
            if p in unused:
                unused.discard(p); changed = True
def kind(c):
    h = [c] + C[c]["herda"]
    for k in ("Node", "Resource", "RefCounted", "Object"):
        if k in h:
            return k
    return "Outro"
by = collections.defaultdict(list)
for c in sorted(unused):
    by[kind(c)].append(c)
print(f"Total {len(C)} | usadas pelos projetos {len(used_proj)} | usadas pelo código do editor/motor {len(C)-len(used_proj)-len(unused)} | sem uso {len(unused)}")
for k in ("Node", "Resource", "RefCounted", "Object", "Outro"):
    print(f"\n[{k}] {len(by[k])}:", " ".join(by[k]))
res = {"total": len(C), "usadas_projetos": sorted(used_proj), "sem_uso": by,
       "usadas_codigo": {c: code[c][:6] for c in sorted(set(C) - used_proj - unused)}}
json.dump(res, open(SAIDA, "w"), ensure_ascii=False, indent=1)
