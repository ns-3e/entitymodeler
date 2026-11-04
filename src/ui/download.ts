export function downloadBlob(data: Blob | Uint8Array | string, filename: string, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copyRich(html: string, text: string) {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    return;
  }
  // Fallback: copy a selected DOM fragment
  const div = document.createElement('div');
  div.innerHTML = html;
  div.style.position = 'fixed';
  div.style.left = '-9999px';
  document.body.appendChild(div);
  const range = document.createRange();
  range.selectNodeContents(div);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand('copy');
  sel.removeAllRanges();
  div.remove();
}
