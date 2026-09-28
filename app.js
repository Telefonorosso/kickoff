'use strict';

const PYODIDE_VERSION = '314.0.7';
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const AMITOOLS_VERSION = '0.8.1';
const AMITOOLS_SDIST_URL = 'https://files.pythonhosted.org/packages/de/01/b837b2fbb7e1dc2a5f5b94149ba59c71293578f2373ae4bb926db0e53c04/amitools-0.8.1.tar.gz';
const AMITOOLS_SDIST_SHA256 = 'f622c0725c15737e7d4820ed147f930f4cfb7b80b04c786c2bc3943b799faf7e';
const ROM_SIZE = 512 * 1024;
const FINAL_SIZE = 2 * 1024 * 1024;
const OUTPUT_NAME = 'L2BOOT_USB_v43r115_ROMSAFE_2MB.rom';

const $ = (id) => document.getElementById(id);
const kickInput = $('kickInput');
const extInput = $('extInput');
const ptableInput = $('ptableInput');
const devInput = $('devInput');
const bootInput = $('bootInput');
const buildButton = $('buildButton');
const downloadButton = $('downloadButton');

let pyodide = null;
let enginePromise = null;
let hostedExt = null;
let outputBlob = null;
let outputUrl = null;
let kickValid = false;

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = `status ${kind}`.trim();
}

function setFileLabel(input, labelId, fallback) {
  const f = input.files && input.files[0];
  $(labelId).textContent = f ? `${f.name} · ${f.size.toLocaleString()} bytes` : fallback;
  updateBuildEnabled();
}

kickInput.addEventListener('change', async () => {
  setFileLabel(kickInput, 'kickLabel', 'Choose Kickstart 40.68…');
  $('result').classList.add('hidden');
  kickValid = false;
  const f = kickInput.files[0];
  if (!f) {
    $('kickInfo').textContent = 'Expected size: 524,288 bytes.';
    updateBuildEnabled();
    return;
  }
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    validateKickstart(bytes);
    kickValid = true;
    const ver = readBE16(bytes, 12), rev = readBE16(bytes, 14);
    $('kickInfo').textContent = `Detected Kickstart ${ver}.${rev} · 512 KiB · local file only`;
    setStatus(extSourceReady() ? 'Ready to build.' : 'Kickstart accepted. Extended ROM source is still required.');
  } catch (e) {
    $('kickInfo').textContent = e.message;
    setStatus(e.message, 'error');
  }
  updateBuildEnabled();
});

extInput.addEventListener('change', () => {
  setFileLabel(extInput, 'extLabel', 'Choose l2boot-ext-full.rom…');
  const f = extInput.files[0];
  if (f && f.size !== ROM_SIZE) {
    setStatus(`Extended ROM must be exactly 524,288 bytes; selected file is ${f.size.toLocaleString()} bytes.`, 'error');
  } else if (f && kickValid) {
    setStatus('Ready to build.');
  }
});
ptableInput.addEventListener('change', () => setFileLabel(ptableInput, 'ptableLabel', 'ptable.library…'));
devInput.addEventListener('change', () => setFileLabel(devInput, 'devLabel', 'l2scsi.device…'));
bootInput.addEventListener('change', () => setFileLabel(bootInput, 'bootLabel', 'l2remote.boot…'));

function readBE16(bytes, off) { return (bytes[off] << 8) | bytes[off + 1]; }

function validateKickstart(bytes) {
  if (bytes.length !== ROM_SIZE) throw new Error(`Kickstart must be exactly 524,288 bytes; selected file is ${bytes.length.toLocaleString()} bytes.`);
  const ver = readBE16(bytes, 12), rev = readBE16(bytes, 14);
  if (ver !== 40 || rev !== 68) throw new Error(`This builder is pinned to A1200 Kickstart 40.68; detected ${ver}.${rev}.`);
  const bootPC = ((bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7]) >>> 0;
  if (bootPC < 0x00f80000 || bootPC > 0x00ffffff) throw new Error('The selected file does not look like a plain A1200 Kickstart mapped at $F80000.');
}

function localModulesReady() {
  return !!(ptableInput.files[0] && devInput.files[0] && bootInput.files[0]);
}

function extSourceReady() {
  return !!hostedExt || !!extInput.files[0] || localModulesReady();
}

function kickLooksReady() {
  return kickValid;
}

function updateBuildEnabled() {
  buildButton.disabled = !(kickLooksReady() && extSourceReady());
}

async function probeHostedExt() {
  const assetUrl = new URL('./assets/l2boot-ext-full.rom', document.baseURI);
  const panel = $('extStatePanel');
  const icon = $('extStateIcon');
  const title = $('extStateTitle');

  // The repository stores the asset at /assets, while the Pages workflow stages
  // it beside index.html in _site/assets. A raw file:// preview has no staging
  // step and browsers do not reliably allow fetch() of neighbouring local files.
  if (window.location.protocol === 'file:') {
    hostedExt = null;
    $('extBadge').textContent = 'manual fallback';
    $('extBadge').className = 'badge warn';
    panel.className = 'subpanel state-panel warn-panel';
    icon.textContent = '!';
    icon.className = 'state-icon warn';
    title.textContent = 'Local file preview: automatic asset loading is unavailable';
    $('hostedExtInfo').textContent = 'Open the deployed GitHub Page (or run tools/preview-page.py), or choose l2boot-ext-full.rom manually below.';
    $('localExtPanel').classList.remove('hidden');
    updateBuildEnabled();
    return;
  }

  title.textContent = 'Checking bundled Extended ROM…';
  $('hostedExtInfo').textContent = assetUrl.pathname;
  try {
    const r = await fetch(assetUrl.href, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const b = new Uint8Array(await r.arrayBuffer());
    if (b.length !== ROM_SIZE) throw new Error(`wrong size: ${b.length.toLocaleString()} bytes`);

    hostedExt = b;
    $('extBadge').textContent = 'ready';
    $('extBadge').className = 'badge good';
    panel.className = 'subpanel state-panel good-panel';
    icon.textContent = '✓';
    icon.className = 'state-icon good';
    title.textContent = 'Extended ROM ready · 512 KiB';
    $('hostedExtInfo').textContent = `${assetUrl.pathname} · loaded automatically`;
    $('localExtPanel').classList.add('hidden');
    if (kickValid) setStatus('Ready to build.');
  } catch (e) {
    hostedExt = null;
    $('extBadge').textContent = 'manual fallback';
    $('extBadge').className = 'badge warn';
    panel.className = 'subpanel state-panel warn-panel';
    icon.textContent = '!';
    icon.className = 'state-icon warn';
    title.textContent = 'Bundled Extended ROM unavailable';
    $('hostedExtInfo').textContent = `${assetUrl.pathname} · ${e.message}`;
    $('localExtPanel').classList.remove('hidden');
  }
  updateBuildEnabled();
}

async function ensureEngine() {
  if (pyodide) return pyodide;
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    $('engineState').textContent = 'loading Pyodide…';
    setStatus('Loading the local Python engine…');
    pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX });
    $('engineState').textContent = 'loading amitools source…';
    await pyodide.runPythonAsync(`
import hashlib
import os
import shutil
import sys
from pyodide.http import pyfetch

AMITOOLS_URL = ${JSON.stringify(AMITOOLS_SDIST_URL)}
AMITOOLS_SHA256 = ${JSON.stringify(AMITOOLS_SDIST_SHA256)}
AMITOOLS_ROOT = "/tmp/amitools-src"
AMITOOLS_ARCHIVE = "/tmp/amitools-0.8.1.tar.gz"

# PyPI ships amitools 0.8.1 as an sdist, not a wheel.  Do not use
# micropip here: fetch the official source archive, authenticate it,
# unpack it into Pyodide's temporary filesystem, and import it directly.
response = await pyfetch(AMITOOLS_URL)
response.raise_for_status()
payload = await response.bytes()
actual = hashlib.sha256(payload).hexdigest()
if actual != AMITOOLS_SHA256:
    raise RuntimeError(
        f"amitools source checksum mismatch: expected {AMITOOLS_SHA256}, got {actual}"
    )

if os.path.isdir(AMITOOLS_ROOT):
    shutil.rmtree(AMITOOLS_ROOT)
os.makedirs(AMITOOLS_ROOT, exist_ok=True)
with open(AMITOOLS_ARCHIVE, "wb") as f:
    f.write(payload)
shutil.unpack_archive(AMITOOLS_ARCHIVE, AMITOOLS_ROOT, "gztar")
source_root = os.path.join(AMITOOLS_ROOT, "amitools-0.8.1")
if not os.path.isdir(os.path.join(source_root, "amitools")):
    raise RuntimeError("unexpected amitools source archive layout")
sys.path.insert(0, source_root)

# Import now so an incompatible source tree fails before the user build starts.
from amitools.tools import romtool
`);
    $('engineState').textContent = `Pyodide ${PYODIDE_VERSION} · amitools ${AMITOOLS_VERSION} source`;
    return pyodide;
  })();
  try { return await enginePromise; }
  catch (e) { enginePromise = null; pyodide = null; $('engineState').textContent = 'engine failed'; throw e; }
}

function clearTempFiles() {
  if (!pyodide) return;
  const names = ['/tmp/kick.rom','/tmp/kick-patched.rom','/tmp/ptable.library','/tmp/l2scsi.device','/tmp/l2remote.boot','/tmp/l2boot-ext-full.rom','/tmp/final-sha256.bin'];
  for (const name of names) {
    try { pyodide.FS.unlink(name); } catch (_) {}
  }
}

async function buildExtendedRom() {
  if (hostedExt) return hostedExt.slice();
  if (extInput.files[0]) {
    const b = new Uint8Array(await extInput.files[0].arrayBuffer());
    if (b.length !== ROM_SIZE) throw new Error('The selected Extended ROM must be exactly 512 KiB.');
    return b;
  }
  if (!localModulesReady()) throw new Error('Choose an Extended ROM or all three local modules.');

  const ptable = new Uint8Array(await ptableInput.files[0].arrayBuffer());
  const dev = new Uint8Array(await devInput.files[0].arrayBuffer());
  const boot = new Uint8Array(await bootInput.files[0].arrayBuffer());
  pyodide.FS.writeFile('/tmp/ptable.library', ptable);
  pyodide.FS.writeFile('/tmp/l2scsi.device', dev);
  pyodide.FS.writeFile('/tmp/l2remote.boot', boot);

  setStatus('Building the 512 KiB Extended ROM locally with romtool…');
  const rc = pyodide.runPython(`
from amitools.tools import romtool
romtool.main([
  "build", "-t", "ext", "-s", "512", "-e", "e00000", "-a", "f80000", "-r", "40.68",
  "-o", "/tmp/l2boot-ext-full.rom",
  "/tmp/ptable.library", "/tmp/l2scsi.device", "/tmp/l2remote.boot"
])
`);
  if (rc !== 0) throw new Error(`romtool build failed with exit code ${rc}.`);
  const ext = pyodide.FS.readFile('/tmp/l2boot-ext-full.rom');
  if (ext.length !== ROM_SIZE) throw new Error(`romtool produced an unexpected Extended ROM size: ${ext.length}.`);
  return new Uint8Array(ext);
}

async function patchKickstart(kickBytes) {
  pyodide.FS.writeFile('/tmp/kick.rom', kickBytes);
  setStatus('Applying amitools 1mb_rom patch locally…');
  const rc = pyodide.runPython(`
from amitools.tools import romtool
romtool.main(["patch", "/tmp/kick.rom", "1mb_rom", "-o", "/tmp/kick-patched.rom"])
`);
  if (rc !== 0) throw new Error(`romtool patch failed with exit code ${rc}.`);
  const patched = pyodide.FS.readFile('/tmp/kick-patched.rom');
  if (patched.length !== ROM_SIZE) throw new Error(`Patched Kickstart has unexpected size: ${patched.length}.`);
  return new Uint8Array(patched);
}

function compose2MiB(ext, kick) {
  if (ext.length !== ROM_SIZE || kick.length !== ROM_SIZE) throw new Error('Internal size check failed.');
  const out = new Uint8Array(FINAL_SIZE);
  out.fill(0xff);
  out.set(ext, 0x000000);
  out.set(kick, 0x180000);
  return out;
}

async function sha256(bytes) {
  // crypto.subtle is intentionally unavailable on ordinary HTTP origins
  // other than localhost.  That includes the LAN preview served as
  // http://192.168.x.x:8000/.  Prefer Web Crypto on HTTPS/localhost, but
  // fall back to Python hashlib in the already-loaded Pyodide engine.
  if (globalThis.crypto && globalThis.crypto.subtle) {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2,'0')).join('');
  }

  if (!pyodide) throw new Error('SHA-256 engine is unavailable.');
  const path = '/tmp/final-sha256.bin';
  pyodide.FS.writeFile(path, bytes);
  try {
    return pyodide.runPython(`
import hashlib
with open(${JSON.stringify(path)}, "rb") as _f:
    _sha256_result = hashlib.sha256(_f.read()).hexdigest()
_sha256_result
`);
  } finally {
    try { pyodide.FS.unlink(path); } catch (_) {}
  }
}

buildButton.addEventListener('click', async () => {
  buildButton.disabled = true;
  $('result').classList.add('hidden');
  try {
    const kick = new Uint8Array(await kickInput.files[0].arrayBuffer());
    validateKickstart(kick);
    await ensureEngine();
    clearTempFiles();
    const ext = await buildExtendedRom();
    const patchedKick = await patchKickstart(kick);
    setStatus('Assembling the final 2 MiB Emu68 image…');
    const out = compose2MiB(ext, patchedKick);
    const hash = await sha256(out);

    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputBlob = new Blob([out], { type: 'application/octet-stream' });
    outputUrl = URL.createObjectURL(outputBlob);
    $('outputName').textContent = OUTPUT_NAME;
    $('outputHash').textContent = hash;
    $('result').classList.remove('hidden');
    setStatus('ROM built successfully. Nothing from your Kickstart left this browser tab.', 'ok');
  } catch (e) {
    console.error(e);
    setStatus(`Build failed: ${e.message || e}`, 'error');
  } finally {
    clearTempFiles();
    updateBuildEnabled();
  }
});

downloadButton.addEventListener('click', () => {
  if (!outputUrl) return;
  const a = document.createElement('a');
  a.href = outputUrl;
  a.download = OUTPUT_NAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

probeHostedExt();
