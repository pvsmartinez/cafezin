import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WritingReviewPanel from '../components/WritingReviewPanel';
import type { AIEditMark } from '../types';

const mark: AIEditMark = {
  id: 'edit-1', fileRelPath: 'capitulo-01.md', model: 'Modelo de teste',
  insertedAt: '2026-10-23T12:00:00Z', reviewed: false,
  text: 'A escrita começa com uma pergunta.',
  revert: { beforeText: 'Tudo começa aqui.', afterText: 'A escrita começa com uma pergunta.' },
};

const setup = (marks: AIEditMark[] = [mark]) => {
  const callbacks = {
    onAccept: vi.fn(), onReject: vi.fn(), onOpenFile: vi.fn(), onClose: vi.fn(),
  };
  render(<WritingReviewPanel marks={marks} {...callbacks} />);
  return callbacks;
};

describe('WritingReviewPanel', () => {
  it('shows the previous and revised text without accepting anything automatically', () => {
    const callbacks = setup();
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Revisão da IA 1');
    expect(screen.getByText(mark.revert!.beforeText)).toBeInTheDocument();
    expect(screen.getByText(mark.text)).toBeInTheDocument();
    expect(callbacks.onAccept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Aceitar alteração'));
    expect(callbacks.onAccept).toHaveBeenCalledWith(mark.id);
  });

  it('rejects a change through the existing revert callback', () => {
    const callbacks = setup();
    fireEvent.click(screen.getByText('Rejeitar alteração'));
    expect(callbacks.onReject).toHaveBeenCalledWith(mark.id);
  });

  it('does not pretend an old mark without revert data can be undone', () => {
    setup([{ ...mark, revert: undefined }]);
    expect(screen.getByText('Rejeitar alteração')).toBeDisabled();
    expect(screen.getByText('Versão anterior indisponível para esta alteração.'))
      .toBeInTheDocument();
  });

  it('shows an empty state after all changes are reviewed', () => {
    setup([{ ...mark, reviewed: true }]);
    expect(screen.getByText('Tudo revisado. Seu texto está pronto para continuar.'))
      .toBeInTheDocument();
    expect(screen.queryByText('Aceitar alteração')).not.toBeInTheDocument();
  });

  it('opens the edited document and closes the comparison', () => {
    const callbacks = setup();
    fireEvent.click(screen.getByText(mark.fileRelPath));
    expect(callbacks.onOpenFile).toHaveBeenCalledWith(mark.fileRelPath);
    expect(callbacks.onClose).toHaveBeenCalledOnce();
  });

  it('closes on Escape and restores focus', () => {
    const callbacks = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(callbacks.onClose).toHaveBeenCalledOnce();
  });

  it('represents deletions rather than repeating the old mark label', () => {
    setup([{ ...mark, revert: { beforeText: 'Remover este trecho.', afterText: '' } }]);
    expect(screen.getByText('Trecho removido')).toBeInTheDocument();
    expect(screen.queryByText(mark.text)).not.toBeInTheDocument();
  });
});
