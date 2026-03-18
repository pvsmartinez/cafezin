import { useState, useEffect, useCallback, useRef } from 'react';
import { Table, Plus, Minus, ArrowDown, ArrowRight, FloppyDisk, Warning, Spinner } from '@phosphor-icons/react';
import { parseSpreadsheetFile, serializeSheetToCSV, serializeSheetToTSV } from '../services/spreadsheet';
import type { SheetTab } from '../services/spreadsheet';
import { writeTextFile } from '../services/fs';
import './SpreadsheetViewer.css';

interface SpreadsheetViewerProps {
  absPath: string;
  filename: string;
  onStat?: (stat: string) => void;
}

const LARGE_ROW_THRESHOLD = 1000;
const MAX_INITIAL_ROWS = 1000;

type CellPos = { row: number; col: number };

export default function SpreadsheetViewer({ absPath, filename, onStat }: SpreadsheetViewerProps) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? 'csv';
  const isText = ext === 'csv' || ext === 'tsv';

  const [sheets, setSheets] = useState<SheetTab[]>([]);
  const [activeSheetIdx, setActiveSheetIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);

  // Cell editing state
  const [editingCell, setEditingCell] = useState<CellPos | null>(null);
  const [editValue, setEditValue] = useState('');
  const [selectedCell, setSelectedCell] = useState<CellPos | null>(null);
  const [copiedCell, setCopiedCell] = useState<CellPos | null>(null);
  const cellInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-save debounce timer (CSV only)
  const saveDebouncerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeSheet = sheets[activeSheetIdx];

  // ── Load file ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDirty(false);
    setEditingCell(null);
    setSelectedCell(null);
    setActiveSheetIdx(0);
    setShowAllRows(false);

    parseSpreadsheetFile(absPath, ext)
      .then((data) => {
        if (cancelled) return;
        setSheets(data.sheets);
        if (onStat && data.sheets[0]) {
          const totalRows = data.sheets.reduce((s, sh) => s + sh.rows.length, 0);
          onStat(`${totalRows.toLocaleString()} linhas`);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String((err as Error)?.message ?? err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [absPath, ext]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist modified sheet ─────────────────────────────────────────────────
  const saveCurrentSheet = useCallback(async (sheet: SheetTab, immediate = false) => {
    if (!isText) return; // XLSX round-trip not supported — use "Save as CSV"

    const doSave = async () => {
      setSaving(true);
      try {
        const text = ext === 'tsv'
          ? await serializeSheetToTSV(sheet)
          : await serializeSheetToCSV(sheet);
        await writeTextFile(absPath, text);
        setDirty(false);
      } catch (err) {
        console.error('[SpreadsheetViewer] Save failed:', err);
      } finally {
        setSaving(false);
      }
    };

    if (immediate) {
      if (saveDebouncerRef.current) clearTimeout(saveDebouncerRef.current);
      await doSave();
    } else {
      if (saveDebouncerRef.current) clearTimeout(saveDebouncerRef.current);
      saveDebouncerRef.current = setTimeout(doSave, 500);
    }
  }, [absPath, ext, isText]);

  // ── Helper functions ─────────────────────────────────────────────────────
  function colLabel(i: number): string {
    let label = '';
    let n = i;
    do {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
  }

  function cellAddr(row: number, col: number): string {
    return row === -1 ? colLabel(col) : `${colLabel(col)}${row + 1}`;
  }

  function looksNumeric(val: string): boolean {
    if (!val || !val.trim()) return false;
    return /^-?[\d,._]+%?$/.test(val.trim());
  }

  // ── Grid keyboard handler ─────────────────────────────────────────────────
  function handleGridKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (editingCell) return;
    if (!activeSheet) return;
    const colCount = activeSheet.headers.length;
    const rowCount = activeSheet.rows.length;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (!selectedCell) { setSelectedCell({ row: 0, col: 0 }); return; }
      let { row, col } = selectedCell;
      if (e.key === 'ArrowDown')  row = Math.min(row + 1, rowCount - 1);
      else if (e.key === 'ArrowUp')    row = Math.max(row - 1, 0);
      else if (e.key === 'ArrowRight') col = Math.min(col + 1, colCount - 1);
      else if (e.key === 'ArrowLeft')  col = Math.max(col - 1, 0);
      setSelectedCell({ row, col });
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedCell) {
      const { row, col } = selectedCell;
      if (row < 0 || !isText) return;
      e.preventDefault();
      const updated = sheets.map((sh, i) => {
        if (i !== activeSheetIdx) return sh;
        return { ...sh, rows: sh.rows.map((r, ri) => {
          if (ri !== row) return r;
          const nr = [...r]; nr[col] = ''; return nr;
        }) };
      });
      setSheets(updated);
      setDirty(true);
      const upd = updated[activeSheetIdx];
      if (upd) saveCurrentSheet(upd);
      return;
    }

    if ((e.key === 'Enter' || e.key === 'F2') && selectedCell) {
      e.preventDefault();
      startEdit(selectedCell.row, selectedCell.col);
      return;
    }

    if (e.key === 'c' && (e.ctrlKey || e.metaKey) && selectedCell) {
      e.preventDefault();
      const { row, col } = selectedCell;
      const val = row === -1
        ? (activeSheet.headers[col] ?? '')
        : (activeSheet.rows[row]?.[col] ?? '');
      navigator.clipboard.writeText(val).catch(() => {});
      setCopiedCell({ row, col });
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedCell(null), 800);
      return;
    }

    // Ctrl+V — paste single value or tab-separated block
    if (e.key === 'v' && (e.ctrlKey || e.metaKey) && selectedCell) {
      e.preventDefault();
      const { row, col } = selectedCell;
      if (row < 0) return;
      navigator.clipboard.readText().then((text) => {
        if (!text || !activeSheet) return;
        const lines = text.split(/\r?\n/).filter((l) => l !== '');
        if (lines.length === 1 && !text.includes('\t')) {
          startEdit(row, col, text);
        } else {
          const pastedRows = lines.map((l) => l.split('\t'));
          const newSheets = sheets.map((sh, si) => {
            if (si !== activeSheetIdx) return sh;
            const newRows = sh.rows.map((r) => [...r]);
            for (let dr = 0; dr < pastedRows.length; dr++) {
              const ri = row + dr;
              if (ri >= newRows.length) break;
              const cells = pastedRows[dr] ?? [];
              for (let dc = 0; dc < cells.length; dc++) {
                const ci = col + dc;
                if (ci >= sh.headers.length) break;
                while (newRows[ri].length <= ci) newRows[ri].push('');
                newRows[ri][ci] = cells[dc] ?? '';
              }
            }
            return { ...sh, rows: newRows };
          });
          setSheets(newSheets);
          setDirty(true);
          const updated = newSheets[activeSheetIdx];
          if (updated) saveCurrentSheet(updated);
        }
      }).catch(() => {});
      return;
    }

    // Printable char → start editing
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && selectedCell) {
      startEdit(selectedCell.row, selectedCell.col, e.key);
    }
  }

  // ── Cell editing ──────────────────────────────────────────────────────────
  function startEdit(rowIdx: number, colIdx: number, initialChar?: string) {
    setSelectedCell({ row: rowIdx, col: colIdx });
    const current = rowIdx === -1
      ? (activeSheet?.headers[colIdx] ?? '')
      : (activeSheet?.rows[rowIdx]?.[colIdx] ?? '');
    const value = initialChar !== undefined ? initialChar : current;
    setEditingCell({ row: rowIdx, col: colIdx });
    setEditValue(value);
    setTimeout(() => {
      const el = cellInputRef.current;
      if (!el) return;
      el.focus();
      if (initialChar === undefined) el.select();
      else el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
  }

  function commitEdit() {
    if (!editingCell || !activeSheet) return;
    const { row, col } = editingCell;

    const newSheets = sheets.map((sh, i) => {
      if (i !== activeSheetIdx) return sh;
      if (row === -1) {
        const newHeaders = [...sh.headers];
        newHeaders[col] = editValue;
        return { ...sh, headers: newHeaders };
      } else {
        const newRows = sh.rows.map((r, ri) => {
          if (ri !== row) return r;
          const newRow = [...r];
          newRow[col] = editValue;
          return newRow;
        });
        return { ...sh, rows: newRows };
      }
    });

    setSheets(newSheets);
    setDirty(true);
    setEditingCell(null);

    const updated = newSheets[activeSheetIdx];
    if (updated) saveCurrentSheet(updated);
  }

  function cancelEdit() {
    setEditingCell(null);
  }

  function handleCellKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      commitEdit();
      // Navigate to next cell
      if (!editingCell || !activeSheet) return;
      const { row, col } = editingCell;
      const colCount = activeSheet.headers.length;
      const rowCount = activeSheet.rows.length;
      if (e.key === 'Tab') {
        const nextCol = col + 1 < colCount ? col + 1 : 0;
        const nextRow = col + 1 < colCount ? row : (row + 1 < rowCount ? row + 1 : row);
        setTimeout(() => startEdit(nextRow, nextCol), 0);
      } else {
        const nextRow = row + 1 < rowCount ? row + 1 : row;
        setTimeout(() => startEdit(nextRow, col), 0);
      }
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  }
  // ── Auto-scroll selected cell into view ────────────────────────────────────────
  useEffect(() => {
    if (!selectedCell) return;
    const { row, col } = selectedCell;
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${row},${col}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedCell]); // eslint-disable-line react-hooks/exhaustive-deps
  // ── Row / column operations ───────────────────────────────────────────────
  function addRow() {
    if (!activeSheet) return;
    const emptyRow = activeSheet.headers.map(() => '');
    const newSheets = sheets.map((sh, i) =>
      i !== activeSheetIdx ? sh : { ...sh, rows: [...sh.rows, emptyRow] },
    );
    setSheets(newSheets);
    setDirty(true);
    const updated = newSheets[activeSheetIdx];
    if (updated) saveCurrentSheet(updated);
  }

  function removeRow() {
    if (!activeSheet || activeSheet.rows.length === 0) return;
    // Delete the selected row if one is selected, otherwise the last row
    const rowIdx = (selectedCell !== null && selectedCell.row >= 0)
      ? selectedCell.row
      : activeSheet.rows.length - 1;
    const newSheets = sheets.map((sh, i) =>
      i !== activeSheetIdx ? sh : { ...sh, rows: sh.rows.filter((_, ri) => ri !== rowIdx) },
    );
    setSheets(newSheets);
    setDirty(true);
    if (selectedCell && selectedCell.row >= 0) {
      const newLen = newSheets[activeSheetIdx]?.rows.length ?? 0;
      setSelectedCell({ row: Math.min(selectedCell.row, Math.max(0, newLen - 1)), col: selectedCell.col });
    }
    const updated = newSheets[activeSheetIdx];
    if (updated) saveCurrentSheet(updated);
  }

  function addColumn() {
    if (!activeSheet) return;
    const newLetter = String.fromCharCode(65 + activeSheet.headers.length);
    const newSheets = sheets.map((sh, i) =>
      i !== activeSheetIdx ? sh : {
        ...sh,
        headers: [...sh.headers, `Col${newLetter}`],
        rows: sh.rows.map((r) => [...r, '']),
      },
    );
    setSheets(newSheets);
    setDirty(true);
    const updated = newSheets[activeSheetIdx];
    if (updated) saveCurrentSheet(updated);
  }

  function removeColumn() {
    if (!activeSheet || activeSheet.headers.length === 0) return;
    // Delete the selected column if one is selected, otherwise the last column
    const colIdx = selectedCell !== null ? selectedCell.col : activeSheet.headers.length - 1;
    const newSheets = sheets.map((sh, i) =>
      i !== activeSheetIdx ? sh : {
        ...sh,
        headers: sh.headers.filter((_, ci) => ci !== colIdx),
        rows: sh.rows.map((r) => r.filter((_, ci) => ci !== colIdx)),
      },
    );
    setSheets(newSheets);
    setDirty(true);
    if (selectedCell) {
      const maxCol = (newSheets[activeSheetIdx]?.headers.length ?? 1) - 1;
      setSelectedCell({ row: selectedCell.row, col: Math.min(selectedCell.col, Math.max(0, maxCol)) });
    }
    const updated = newSheets[activeSheetIdx];
    if (updated) saveCurrentSheet(updated);
  }

  // ── Save as CSV (for XLSX files) ──────────────────────────────────────────
  async function saveAsCSV() {
    if (!activeSheet) return;
    setSaving(true);
    try {
      const csvPath = absPath.replace(/\.[^.]+$/, `-${activeSheet.name}.csv`);
      const text = await serializeSheetToCSV(activeSheet);
      await writeTextFile(csvPath, text);
    } catch (err) {
      console.error('[SpreadsheetViewer] Save as CSV failed:', err);
    } finally {
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="ss-loading">
        <Spinner className="ss-spinner" size={20} />
        <span>Carregando planilha…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ss-error">
        <Warning size={20} />
        <span>Erro ao abrir planilha: {error}</span>
      </div>
    );
  }

  if (!activeSheet) {
    return (
      <div className="ss-error">
        <Warning size={20} />
        <span>Planilha vazia ou sem abas.</span>
      </div>
    );
  }

  const visibleRows = (!showAllRows && activeSheet.rows.length > MAX_INITIAL_ROWS)
    ? activeSheet.rows.slice(0, MAX_INITIAL_ROWS)
    : activeSheet.rows;
  const isLarge = activeSheet.rows.length > LARGE_ROW_THRESHOLD;

  return (
    <div className="ss-root">
      {/* ── Toolbar ── */}
      <div className="ss-toolbar">
        <span className="ss-toolbar-icon"><Table size={14} /></span>
        <span className="ss-toolbar-name">{filename}</span>

        <span className="ss-toolbar-sep" />

        <button className="ss-btn" title="Adicionar linha" onClick={addRow}>
          <Plus size={12} /><ArrowDown size={12} />
        </button>
        <button
          className="ss-btn"
          title={selectedCell && selectedCell.row >= 0 ? `Remover linha ${selectedCell.row + 1}` : 'Remover última linha'}
          onClick={removeRow}
          disabled={!activeSheet || activeSheet.rows.length === 0}
        >
          <Minus size={12} /><ArrowDown size={12} />
        </button>
        <button className="ss-btn" title="Adicionar coluna" onClick={addColumn}>
          <Plus size={12} /><ArrowRight size={12} />
        </button>
        <button
          className="ss-btn"
          title={selectedCell ? `Remover coluna ${colLabel(selectedCell.col)}` : 'Remover última coluna'}
          onClick={removeColumn}
          disabled={!activeSheet || activeSheet.headers.length === 0}
        >
          <Minus size={12} /><ArrowRight size={12} />
        </button>

        <span className="ss-toolbar-sep" />

        {!isText ? (
          <button className="ss-btn ss-btn--save" title="Salvar aba como CSV" onClick={saveAsCSV} disabled={saving}>
            <FloppyDisk size={13} />
            {saving ? 'Salvando…' : 'Salvar como CSV'}
          </button>
        ) : dirty ? (
          <button className="ss-btn ss-btn--save" title="Salvar" onClick={() => saveCurrentSheet(activeSheet, true)} disabled={saving}>
            <FloppyDisk size={13} />
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        ) : null}

        {isLarge && (
          <span className="ss-large-badge" title="Arquivo grande — primeiras 1000 linhas exibidas">
            {activeSheet.rows.length.toLocaleString()} linhas
          </span>
        )}
      </div>

      {/* ── Sheet tabs (only for multi-sheet XLSX) ── */}
      {sheets.length > 1 && (
        <div className="ss-sheet-tabs">
          {sheets.map((sh, i) => (
            <button
              key={sh.name}
              className={`ss-sheet-tab${i === activeSheetIdx ? ' active' : ''}`}
              onClick={() => { setActiveSheetIdx(i); setEditingCell(null); setSelectedCell(null); }}
            >
              {sh.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Formula bar (always visible) ── */}
      <div className="ss-formula-bar">
        {editingCell ? (
          <>
            <span className="ss-formula-addr">{cellAddr(editingCell.row, editingCell.col)}</span>
            <span className="ss-formula-divider" />
            <span className="ss-formula-value">
              {editValue || <span className="ss-formula-empty">digitando…</span>}
            </span>
          </>
        ) : selectedCell ? (() => {
          const { row, col } = selectedCell;
          const val = row === -1 ? (activeSheet.headers[col] ?? '') : (activeSheet.rows[row]?.[col] ?? '');
          const isFormula = val.startsWith('=');
          return (
            <>
              <span className="ss-formula-addr">{cellAddr(row, col)}</span>
              <span className="ss-formula-divider" />
              {val
                ? <span className={`ss-formula-value${isFormula ? ' is-formula' : ''}`}>{val}</span>
                : <span className="ss-formula-empty">vazio</span>}
            </>
          );
        })() : (
          <span className="ss-formula-empty">Clique em uma célula para selecionar</span>
        )}
      </div>

      {/* ── Grid ── */}
      <div
        ref={gridRef}
        className="ss-grid-wrapper"
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        style={{ outline: 'none' }}
      >
        <table className="ss-table">
          <thead>
            <tr>
              <th className="ss-row-num" />
              {activeSheet.headers.map((h, ci) => (
                <th
                  key={ci}
                  data-cell={`-1,${ci}`}
                  className={`ss-th${selectedCell?.row === -1 && selectedCell?.col === ci && !editingCell ? ' selected' : ''}`}
                  onClick={() => { if (!editingCell) { setSelectedCell({ row: -1, col: ci }); gridRef.current?.focus(); } }}
                  onDoubleClick={() => startEdit(-1, ci)}
                >
                  {editingCell?.row === -1 && editingCell?.col === ci ? (
                    <input
                      ref={cellInputRef}
                      className="ss-cell-input"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleCellKeyDown}
                    />
                  ) : (
                    h || <span className="ss-col-label">{String.fromCharCode(65 + ci)}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? 'ss-tr-even' : 'ss-tr-odd'}>
                <td className="ss-row-num">{ri + 1}</td>
                {activeSheet.headers.map((_h, ci) => (
                  <td
                    key={ci}
                    data-cell={`${ri},${ci}`}
                    className={[
                      'ss-td',
                      editingCell?.row === ri && editingCell?.col === ci ? 'editing' : '',
                      selectedCell?.row === ri && selectedCell?.col === ci && !editingCell ? 'selected' : '',
                      copiedCell?.row === ri && copiedCell?.col === ci ? 'copied' : '',
                      looksNumeric(row[ci] ?? '') ? 'num' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => { if (!editingCell) { setSelectedCell({ row: ri, col: ci }); gridRef.current?.focus(); } }}
                    onDoubleClick={() => startEdit(ri, ci)}
                  >
                    {editingCell?.row === ri && editingCell?.col === ci ? (
                      <input
                        ref={cellInputRef}
                        className="ss-cell-input"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={handleCellKeyDown}
                      />
                    ) : (
                      row[ci] ?? ''
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── Load more (large files) ── */}
        {!showAllRows && activeSheet.rows.length > MAX_INITIAL_ROWS && (
          <div className="ss-load-more">
            <span>Exibindo {MAX_INITIAL_ROWS.toLocaleString()} de {activeSheet.rows.length.toLocaleString()} linhas.</span>
            <button className="ss-btn" onClick={() => setShowAllRows(true)}>Carregar todas</button>
          </div>
        )}
      </div>

      {/* ── Status bar ── */}
      <div className="ss-status">
        <span>{activeSheet.rows.length.toLocaleString()} linhas · {activeSheet.headers.length} colunas</span>
        {dirty && <span className="ss-status-dirty">· alterado</span>}
        {selectedCell && !editingCell && (
          <span className="ss-status-hint">↑↓←→ navegar · Enter editar · Del limpar · ⌘C copiar · ⌘V colar</span>
        )}
      </div>
    </div>
  );
}
