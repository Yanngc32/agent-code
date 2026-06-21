// Injected into every page of the browser context: a hover-highlight +
// click-capture element picker, gated by window.__agentSelectMode and reporting
// the picked element via the window.__agentPick binding (exposed per context).
export const PICKER_SCRIPT = String.raw`(() => {
  if (window.__agentPickerInstalled) return;
  window.__agentPickerInstalled = true;
  const HL = '__agent_highlight__';
  function box() {
    let b = document.getElementById(HL);
    if (!b) {
      b = document.createElement('div'); b.id = HL;
      Object.assign(b.style, { position:'fixed', zIndex:2147483647, pointerEvents:'none',
        border:'2px solid #d97757', background:'rgba(217,119,87,0.14)', borderRadius:'3px', display:'none' });
      (document.documentElement || document.body).appendChild(b);
    }
    return b;
  }
  function sel(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = []; let e = el;
    while (e && e.nodeType === 1 && parts.length < 5) {
      let s = e.tagName.toLowerCase();
      if (e.classList && e.classList.length) s += '.' + [...e.classList].slice(0,2).map(c => CSS.escape(c)).join('.');
      const sib = e.parentElement ? [...e.parentElement.children].filter(x => x.tagName === e.tagName) : [];
      if (sib.length > 1) s += ':nth-of-type(' + (sib.indexOf(e) + 1) + ')';
      parts.unshift(s); e = e.parentElement;
    }
    return parts.join(' > ');
  }
  function cls(el) { const c = el.className; return (c && c.baseVal !== undefined ? c.baseVal : c) || ''; }
  function onMove(ev) {
    if (!window.__agentSelectMode) return;
    const el = ev.target; if (!el || el.id === HL) return;
    const r = el.getBoundingClientRect(); const b = box();
    b.style.display='block'; b.style.left=r.left+'px'; b.style.top=r.top+'px';
    b.style.width=r.width+'px'; b.style.height=r.height+'px';
  }
  function onClick(ev) {
    if (!window.__agentSelectMode) return;
    ev.preventDefault(); ev.stopPropagation();
    const el = ev.target;
    const data = { selector: sel(el), tagName: el.tagName.toLowerCase(), id: el.id || '',
      classes: cls(el), text: (el.innerText || el.textContent || '').trim().slice(0,2000),
      html: el.outerHTML.slice(0,4000), url: location.href };
    if (window.__agentPick) window.__agentPick(data);
  }
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('mousedown', e => { if (window.__agentSelectMode) { e.preventDefault(); e.stopPropagation(); } }, true);
})();`
