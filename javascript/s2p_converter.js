// s2p_converter.js
// Convertisseur S2P -> "freq(Hz) Sxx(dB)".
// François — code direct, sans chichi.

(function () {
  // DOM
  const ta = document.getElementById('s2pInput');
  const unitSel = document.getElementById('unitSelect');
  const paramSel = document.getElementById('paramSelect');
  const outFreqLabel = document.getElementById('outputFreqLabel');
  const outHeader = document.getElementById('outputHeader');
  const btnConvert = document.getElementById('btnConvert');
  const btnCopy = document.getElementById('btnCopy');
  const btnDownload = document.getElementById('btnDownload');
  const out = document.getElementById('outputArea');
  const status = document.getElementById('status');

  // Helpers
  const setStatus = (s, timeout = 2500) => {
    status.textContent = s || '';
    if (timeout && s) {
      clearTimeout(setStatus._t);
      setStatus._t = setTimeout(()=> status.textContent = '', timeout);
    }
  };

  function toHz(freq, unit) {
    if (!isFinite(Number(freq))) return NaN;
    const f = Number(freq);
    switch ((unit || 'MHz').toString().toLowerCase()) {
      case 'ghz': return f * 1e9;
      case 'mhz': return f * 1e6;
      case 'hz':  return f;
      default: return f * 1e6;
    }
  }

  function parseLines(txt) {
    // split preserving lines, remove \r
    return txt.replace(/\r/g, '').split('\n');
  }

  function isCommentLine(line) {
    const t = line.trim();
    return t.startsWith('!') || t.startsWith('//') || t.startsWith(';');
  }

  function findHeaderUnit(lines) {
    // look for a line starting with '#' that mentions MHz/GHz/Hz
    for (const raw of lines) {
      const l = raw.trim();
      if (!l) continue;
      if (l.startsWith('#')) {
        const s = l.toUpperCase();
        if (s.includes('GHZ')) return 'GHz';
        if (s.includes('MHZ')) return 'MHz';
        if (s.includes('HZ'))  return 'Hz';
      }
    }
    return null;
  }

  function findFirstDataLineIndex(lines) {
    for (let i=0;i<lines.length;i++){
      const l = lines[i].trim();
      if (!l) continue;
      if (isCommentLine(l)) continue;
      // check if starts with number (possible negative) or "."
      if (/^[\d\-\.+]/.test(l)) {
        // count numeric tokens
        const toks = l.trim().split(/\s+/);
        // must contain at least 2 numeric tokens
        const numericCount = toks.reduce((c,t)=> c + (isFinite(Number(t.replace(',', '.')))?1:0), 0);
        if (numericCount >= 2) return i;
      }
    }
    return -1;
  }

  function buildMapping(tokensLength) {
    // Standard S2P data format (mag/phase for each Sij) -> 9 columns:
    // freq, S11_dB, S11_deg, S21_dB, S21_deg, S12_dB, S12_deg, S22_dB, S22_deg
    // mapping for Sxx dB values:
    // indices: S11->1, S21->3, S12->5, S22->7
    // If there are fewer columns, we'll try reasonable fallbacks.
    const map = {};
    if (tokensLength >= 9) {
      map.freq = 0; map.S11 = 1; map.S21 = 3; map.S12 = 5; map.S22 = 7;
    } else if (tokensLength === 8) {
      // could be freq, S11(dB), S21(dB), S12(dB), S22(dB), plus phases compressed? unlikely
      map.freq = 0;
      // best effort: assume S-params at 1,2,3,4
      map.S11 = 1; map.S21 = 2; map.S12 = 3; map.S22 = 4;
    } else if (tokensLength === 5) {
      // some files use: freq, S11(dB), S21(dB), S12(dB), S22(dB)
      map.freq = 0; map.S11 = 1; map.S21 = 2; map.S12 = 3; map.S22 = 4;
    } else if (tokensLength === 3) {
      // freq, S21(dB), S21(phase) common for single-parameter export
      map.freq = 0; map.S21 = 1; map.S11 = 1; map.S12 = 1; map.S22 = 1;
    } else {
      // fallback: assume S21 at index 1 if exists
      map.freq = 0; map.S11 = 1; map.S21 = 1; map.S12 = 1; map.S22 = 1;
    }
    return map;
  }

  function buildOutputText(lines, chosenParam, unitChoice, freqLabel, headerLabel) {
    // find first data line
    const idx = findFirstDataLineIndex(lines);
    if (idx < 0) {
      throw new Error('Aucune ligne de données détectée dans le contenu S2P.');
    }

    // determine numeric tokens count from that line
    const sampleTokens = lines[idx].trim().split(/\s+/).map(s=> s.replace(',', '.'));
    const tokensLen = sampleTokens.length;
    const mapping = buildMapping(tokensLen);

    // verify chosenParam exists in mapping
    if (!(chosenParam in mapping)) throw new Error('Paramètre sélectionné non disponible dans le mapping.');

    const colIndex = mapping[chosenParam];
    // sanity check: column exists for sample line
    if (colIndex >= tokensLen) {
      // try to fallback to obvious mapping for standard 9-col file
      if (tokensLen >= 9 && colIndex >= tokensLen) {
        throw new Error(`Format inattendu : la ligne de données a ${tokensLen} colonnes; impossible de récupérer ${chosenParam}.`);
      }
    }

    const outLines = [];
    // header
    outLines.push(`${freqLabel} ${headerLabel}`);

    // process subsequent lines that look numeric
    for (let i = idx; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw) continue;
      if (isCommentLine(raw)) continue;
      // split tokens, allow tabs/spaces
      const toks = raw.split(/\s+/).map(s=> s.replace(',', '.'));
      // need at least freq and chosen value
      if (toks.length <= colIndex) {
        // skip lines with insufficient tokens
        continue;
      }
      const freqRaw = toks[0];
      const valRaw = toks[colIndex];

      const freqNum = Number(freqRaw);
      const valNum = Number(valRaw);
      if (!isFinite(freqNum) || !isFinite(valNum)) {
        // skip non-numeric rows
        continue;
      }

      const hz = toHz(freqNum, unitChoice);
      if (!isFinite(hz)) continue;
      // format frequency as integer Hz (rounded), value with 3 decimals (trim trailing zeros)
      const freqOut = Math.round(hz);
      let valOut = Number(valNum.toFixed(3));
      // remove trailing .000 for neatness when integer
      if (Number.isInteger(valOut)) valOut = valOut.toFixed(0);
      outLines.push(`${freqOut} ${valOut}`);
    }

    if (outLines.length === 1) {
      // only header present
      throw new Error('Aucune donnée valide extraite après parsing (vérifie le format / unités).');
    }

    return outLines.join('\n');
  }

  // Convert button
  btnConvert.addEventListener('click', (ev) => {
    setStatus('');
    const txt = (ta.value || '').trim();
    if (!txt) { setStatus('Colle le contenu du fichier .s2p d\'abord'); out.textContent = '— résultat ici —'; return; }

    const lines = parseLines(txt);
    const headerUnitDetected = findHeaderUnit(lines); // may be null

    const chosenUnit = unitSel.value || 'MHz';
    if (headerUnitDetected && headerUnitDetected.toLowerCase() !== chosenUnit.toLowerCase()) {
      setStatus(`Remarque: entête du fichier indique "${headerUnitDetected}" — j'utilise "${chosenUnit}" (sélection manuelle).`, 6000);
    }

    const chosenParam = paramSel.value || 'S21';
    try {
      const result = buildOutputText(lines, chosenParam, chosenUnit, outFreqLabel.value || 'freq(Hz)', outHeader.value || `${chosenParam}(dB)`);
      out.textContent = result;
      setStatus('Conversion OK');
    } catch (err) {
      out.textContent = '— résultat ici —';
      setStatus('Erreur: ' + (err && err.message ? err.message : String(err)), 6000);
      console.error(err);
    }
  });

  // Copy button
  btnCopy.addEventListener('click', async () => {
    const text = out.textContent || '';
    if (!text || text.trim() === '' || text.includes('— résultat ici —')) { setStatus('Rien à copier'); return; }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        setStatus('Copié dans le presse-papier');
      } else {
        // fallback
        const taFake = document.createElement('textarea');
        taFake.value = text;
        document.body.appendChild(taFake);
        taFake.select();
        document.execCommand('copy');
        taFake.remove();
        setStatus('Copié (fallback)');
      }
    } catch (e) {
      console.error(e);
      setStatus('Échec du copier', 3000);
    }
  });

  // Download button
  btnDownload.addEventListener('click', () => {
    const text = out.textContent || '';
    if (!text || text.trim() === '' || text.includes('— résultat ici —')) { setStatus('Rien à télécharger'); return; }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // filename: param + .txt
    const fn = `${(paramSel.value || 'S21')}_export.txt`;
    a.download = fn;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus(`Téléchargé ${fn}`);
  });

  // small UX: Ctrl+Enter in textarea -> convert
  ta.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && ev.key === 'Enter') {
      ev.preventDefault();
      btnConvert.click();
    }
  });

  // Put an example hint on first load if empty
  (function initHint(){
    if (!ta.value.trim()) {
      ta.placeholder = `
# MHz S DB R 50
!Frequency S11 dB S11 DEG S21 dB S21 DEG S12 dB S12 DEG S22 dB S22 DEG
10 -0.08 178.842 -97.777 -63.708 -79.667 -24.617 -0.099 178.634
...`;
    }
  })();

})();
