import pathlib
s=pathlib.Path(__file__).parent/'src'
h=(s/'index.html').read_text()
js='\n'.join((s/f).read_text() for f in ['proto.js','ecu.js','sim.js','transports.js','app.js'])
h=h.replace('/*@@CSS@@*/',(s/'style.css').read_text()).replace('/*@@JS@@*/',js.replace('</script','<\\/script'))
o=pathlib.Path(__file__).parent/'dist'; o.mkdir(exist_ok=True)
(o/'Jet_HONDA_Tune.html').write_text(h); print('ok',len(h))
a=pathlib.Path(__file__).parent/'android'/'app'/'src'/'main'/'assets'
if a.parent.exists(): a.mkdir(exist_ok=True); (a/'index.html').write_text(h); print('-> android assets')
