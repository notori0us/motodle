import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { CreditRow } from '../lib/credits';
import CreditsModal from './CreditsModal.svelte';

function row(overrides: Partial<CreditRow> = {}): CreditRow {
  return {
    number: 1,
    date: '2026-09-02',
    id: 'mtd-0001',
    year: 2004,
    make: 'Suzuki',
    model: 'GSX-R750',
    credit: {
      fileTitle: 'File:2004 Suzuki GSXR-750 Left SIde.jpg',
      descriptionUrl: 'https://commons.wikimedia.org/wiki/File:2004_Suzuki_GSXR-750_Left_SIde.jpg',
      author: 'Pawlex',
      license: {
        id: 'PD',
        name: 'Public domain',
        url: 'https://commons.wikimedia.org/wiki/Template:PD-user',
        jurisdiction: null,
      },
      attributionRequired: false,
      modified: 'cropped, resized, re-encoded to WebP',
      creditNote: null,
    },
    ...overrides,
  };
}

function baseProps() {
  return {
    open: true,
    rows: [] as CreditRow[],
    status: 'ready' as const,
    hasMore: false,
    remaining: 0,
    loadingMore: false,
    onmore: vi.fn(),
    onretry: vi.fn(),
    onclose: vi.fn(),
  };
}

describe('CreditsModal', () => {
  it('renders the intro sentence verbatim', () => {
    render(CreditsModal, { props: baseProps() });
    expect(
      screen.getByText(
        'Photos come from Wikimedia Commons under Creative Commons or public-domain licences and are cropped, resized and re-encoded.',
      ),
    ).toBeInTheDocument();
  });

  it('with three rows, renders them newest first, each carrying number/date/answer/author/licence/source/modified', () => {
    const rows = [
      row({ id: 'mtd-0003', number: 3, date: '2026-09-04', year: 1995, make: 'Ducati', model: '916' }),
      row({ id: 'mtd-0002', number: 2, date: '2026-09-03', year: 2002, make: 'Kawasaki', model: 'Ninja ZX-6R' }),
      row({ id: 'mtd-0001', number: 1, date: '2026-09-02', year: 2004, make: 'Suzuki', model: 'GSX-R750' }),
    ];
    const { container } = render(CreditsModal, { props: { ...baseProps(), rows } });

    const list = container.querySelector('#mtd-credits') as HTMLElement;
    expect(list).toBeInTheDocument();
    const items = container.querySelectorAll('[data-mtd-credit-row]');
    expect(items).toHaveLength(3);
    // Newest first: #3 (2026-09-04), then #2, then #1.
    expect(items[0]).toHaveAttribute('data-date', '2026-09-04');
    expect(items[1]).toHaveAttribute('data-date', '2026-09-03');
    expect(items[2]).toHaveAttribute('data-date', '2026-09-02');

    const first = within(items[0] as HTMLElement);
    expect(first.getByText(/Motodle #3/)).toBeInTheDocument();
    expect(first.getByText(/2026-09-04/)).toBeInTheDocument();
    expect(first.getByText(/1995 Ducati 916/)).toBeInTheDocument();
    expect(first.getByText(/photo by Pawlex/)).toBeInTheDocument();
    expect(first.getByRole('link', { name: 'Public domain' })).toHaveAttribute(
      'href',
      'https://commons.wikimedia.org/wiki/Template:PD-user',
    );
    expect(first.getByRole('link', { name: 'Source on Commons' })).toHaveAttribute(
      'href',
      'https://commons.wikimedia.org/wiki/File:2004_Suzuki_GSXR-750_Left_SIde.jpg',
    );
    expect(first.getByText(/cropped, resized, re-encoded to WebP/)).toBeInTheDocument();
  });

  it('renders a non-null creditNote verbatim under its row', () => {
    const rows = [row({ credit: { ...row().credit, creditNote: 'Przemysław Jahr / Wikimedia Commons' } })];
    render(CreditsModal, { props: { ...baseProps(), rows } });
    expect(screen.getByText('Przemysław Jahr / Wikimedia Commons')).toBeInTheDocument();
  });

  it('rows: [] with status ready renders #mtd-credits-empty and no #mtd-credits', () => {
    const { container } = render(CreditsModal, { props: { ...baseProps(), rows: [], status: 'ready' } });
    expect(container.querySelector('#mtd-credits-empty')).toBeInTheDocument();
    expect(container.querySelector('#mtd-credits-empty')).toHaveTextContent(
      'No photo credits yet — they appear here once a puzzle is finished.',
    );
    expect(container.querySelector('#mtd-credits')).not.toBeInTheDocument();
  });

  it('hasMore=false renders no #mtd-credits-more', () => {
    const { container } = render(CreditsModal, { props: { ...baseProps(), rows: [row()], hasMore: false } });
    expect(container.querySelector('#mtd-credits-more')).not.toBeInTheDocument();
  });

  it('hasMore=true renders "Show more (N remaining)" and calls onmore once per click', async () => {
    const onmore = vi.fn();
    const { container } = render(CreditsModal, {
      props: { ...baseProps(), rows: [row()], hasMore: true, remaining: 12, onmore },
    });
    const button = container.querySelector('#mtd-credits-more') as HTMLButtonElement;
    expect(button).toHaveTextContent('Show more (12 remaining)');
    expect(button).not.toBeDisabled();

    await fireEvent.click(button);
    await fireEvent.click(button);
    expect(onmore).toHaveBeenCalledTimes(2);
  });

  it('loadingMore=true renders #mtd-credits-more disabled and labelled "Loading…"', () => {
    const { container } = render(CreditsModal, {
      props: { ...baseProps(), rows: [row()], hasMore: true, remaining: 5, loadingMore: true },
    });
    const button = container.querySelector('#mtd-credits-more') as HTMLButtonElement;
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Loading…');
  });

  it('status="failed" renders the failure copy and a Retry that calls onretry', async () => {
    const onretry = vi.fn();
    render(CreditsModal, { props: { ...baseProps(), status: 'failed', onretry } });
    expect(screen.getByText("Couldn't load the photo credits.")).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry' });
    await fireEvent.click(retry);
    expect(onretry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/No photo credits yet/)).not.toBeInTheDocument();
  });

  it('status="loading" renders a loading indicator, not the empty state', () => {
    render(CreditsModal, { props: { ...baseProps(), status: 'loading', rows: [] } });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText(/No photo credits yet/)).not.toBeInTheDocument();
  });
});
