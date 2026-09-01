const ta = document.getElementById('in');
const btn = document.getElementById('render');
const again = document.getElementById('again');

function render() {
  const text = ta.value.trim();
  if (!text) return;
  let segs;
  try { segs = window.LogLens.extractSegments(text); } catch (e) { segs = []; }
  if (!segs.some((s) => s.type === 'json')) {
    alert('No valid JSON found in the pasted text.');
    return;
  }
  document.getElementById('input-wrap').hidden = true;
  const out = document.getElementById('out');
  out.hidden = false;
  out.textContent = '';
  window.LogLens.mount(out, { segments: segs, rawText: text });
  again.hidden = false;
}

btn.addEventListener('click', render);
ta.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') render();
});
again.addEventListener('click', () => location.reload());
