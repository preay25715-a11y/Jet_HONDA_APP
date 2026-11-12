import pathlib
s=pathlib.Path(__file__).parent/'src'
h=(s/'index.html').read_text()
js='\n'.join((s/f).read_text() for f in ['proto.js','ecu.js','sim.js','tune.js','transports.js','app.js','ui-extra.js'])
h=h.replace('/*@@CSS@@*/',(s/'style.css').read_text()).replace('/*@@JS@@*/',js.replace('</script','<\\/script'))
R=pathlib.Path(__file__).parent/'assets'
h=h.replace('@@LOGO_S@@','data:image/webp;base64,'+(R/'logo_small.b64').read_text()).replace('@@LOGO_B@@','data:image/webp;base64,'+(R/'logo_big.b64').read_text())
o=pathlib.Path(__file__).parent/'dist'; o.mkdir(exist_ok=True)
(o/'Jet_HONDA_Tune.html').write_text(h); print('ok',len(h))
a=pathlib.Path(__file__).parent/'android'/'app'/'src'/'main'/'assets'
if a.parent.exists(): a.mkdir(exist_ok=True); (a/'index.html').write_text(h); print('-> android assets')
