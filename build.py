import pathlib, sys
DEV = '--dev' in sys.argv
B = pathlib.Path(__file__).parent
s = B/'src'
h = (s/'index.html').read_text()
files = ['vendor/nacl-fast.min.js', 'license.js', 'proto.js', 'ecu.js'] + (['sim.js'] if DEV else []) + ['tune.js', 'transports.js', 'app.js', 'i18n.js', 'ui-extra.js', 'update.js']
VER = (B/'VERSION').read_text().strip()
js = '\n'.join((s/f).read_text() for f in files)
if DEV: js = 'window.JET_DEV=1;\n' + js   # test build only: no licence, DEMO available — never shipped
h = h.replace('/*@@CSS@@*/', (s/'style.css').read_text()).replace('/*@@JS@@*/', js.replace('</script', '<\\/script'))
h = h.replace('@@VERSION@@', VER).replace('/*@@JS@@*/', '/*@@JS@@*/')
h = h.replace('<!--DEVBTN-->', '<button class="mini" id="bDemo">DEMO</button>' if DEV else '')
h = h.replace('<!--DEVOPT-->', '<div class="opt" data-c="demo"><div class="ic">🎮</div><div><b>DEMO</b></div></div>' if DEV else '')
R = B/'assets'
h = h.replace('@@LOGO_S@@', 'data:image/webp;base64,' + (R/'logo_small.b64').read_text()).replace('@@LOGO_B@@', 'data:image/webp;base64,' + (R/'logo_big.b64').read_text())
o = B/'dist'; o.mkdir(exist_ok=True)
if DEV:
    (o/'dev_test.html').write_text(h); print('dev ok', len(h)); sys.exit()
(o/'Jet_Smart_Gauge.html').write_text(h); print('ok', len(h))
a = B/'android'/'app'/'src'/'main'/'assets'
if a.parent.exists(): a.mkdir(exist_ok=True); (a/'index.html').write_text(h); print('-> android assets')
