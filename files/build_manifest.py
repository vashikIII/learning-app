#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Vygeneruje files/manifest.json ze slozky data/.

Spusteni (ze slozky Learning_app nebo odkudkoli):
    python3 files/build_manifest.py
"""
import json
import os

IMG_EXT = ('.png', '.jpg', '.jpeg', '.gif', '.webp')


def main():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # Learning_app
    data = os.path.join(base, 'data')
    topics = []
    if not os.path.isdir(data):
        raise SystemExit('Slozka data/ neexistuje: ' + data)
    for name in sorted(os.listdir(data)):
        p = os.path.join(data, name)
        if not os.path.isdir(p) or name.startswith('.'):
            continue
        files = sorted(f for f in os.listdir(p) if f.lower().endswith('.csv'))
        pics = []
        picdir = os.path.join(p, 'Pic')
        if os.path.isdir(picdir):
            pics = ['Pic/' + f for f in sorted(os.listdir(picdir))
                    if f.lower().endswith(IMG_EXT)]
        topics.append({'folder': name, 'files': files, 'pics': pics})
    out = os.path.join(base, 'files', 'manifest.json')
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump({'topics': topics}, fh, ensure_ascii=False, indent=1)
    print('OK: %d temat -> %s' % (len(topics), out))


if __name__ == '__main__':
    main()
