import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { CreditBlock, PuzzleImage } from '../../schema/types';
import ImageStage from './ImageStage.svelte';

function testImage(): PuzzleImage {
  return {
    aspect: '4:3',
    focus: { x: 0.5, y: 0.5 },
    sourceCrop: null,
    cropFractions: [0.15, 0.25, 0.4, 0.62, 0.95],
    levels: [1, 2, 3, 4, 5].map((level) => ({
      level,
      src: `img/0001/l${level}.webp`,
      w: 100 * level,
      h: 75 * level,
      rect: { w: 100 * level, h: 75 * level },
      bytes: 1000,
    })),
    full: { src: 'img/0001/full.webp', w: 800, h: 600, bytes: 5000 },
  };
}

/** PD fixture — matches the shape of all three committed puzzle fixtures (§7.4a). */
function testCredit(overrides: Partial<CreditBlock> = {}): CreditBlock {
  return {
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
    ...overrides,
  };
}

/** Synthetic jurisdiction-suffixed licence — none of the committed fixtures carry one (they're
 *  all PD), so this is the only place §3.1's "never re-derive the label from license.id" rule can
 *  be proven (§7.3). */
function jurisdictionCredit(): CreditBlock {
  return testCredit({
    fileTitle: 'File:Some Bike.jpg',
    descriptionUrl: 'https://commons.wikimedia.org/wiki/File:Some_Bike.jpg',
    author: 'Some Author',
    license: {
      id: 'CC-BY-SA-2.0',
      name: 'CC BY-SA 2.0 de',
      url: 'https://creativecommons.org/licenses/by-sa/2.0/de/deed.en',
      jurisdiction: 'de',
    },
    creditNote: 'Please credit "Some Author" if reused.',
  });
}

describe('ImageStage', () => {
  it('shows level N during guess N (unlockedLevel/viewLevel = N)', () => {
    render(ImageStage, {
      props: { image: testImage(), unlockedLevel: 2, viewLevel: 2, onchangeLevel: vi.fn(), credit: testCredit() },
    });
    const img = screen.getByAltText(/progressively revealed/) as HTMLImageElement;
    expect(img.src).toContain('l2.webp');
  });

  it('allows scrubbing back but disables forward levels', () => {
    render(ImageStage, {
      props: { image: testImage(), unlockedLevel: 2, viewLevel: 2, onchangeLevel: vi.fn(), credit: testCredit() },
    });
    const seg1 = screen.getByRole('button', { name: 'Crop level 1 of 5' });
    const seg2 = screen.getByRole('button', { name: 'Crop level 2 of 5' });
    const seg3 = screen.getByRole('button', { name: 'Crop level 3 of 5' });
    expect(seg1).not.toBeDisabled();
    expect(seg2).not.toBeDisabled();
    expect(seg3).toBeDisabled();
    expect(seg3).toHaveAttribute('aria-disabled', 'true');
  });

  it('calls onchangeLevel when an unlocked segment is clicked', async () => {
    const onchangeLevel = vi.fn();
    render(ImageStage, {
      props: { image: testImage(), unlockedLevel: 3, viewLevel: 3, onchangeLevel, credit: testCredit() },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Crop level 1 of 5' }));
    expect(onchangeLevel).toHaveBeenCalledWith(1);
  });

  it('unlocks all 5 levels once the game is over (unlockedLevel=5 regardless of guess count)', () => {
    render(ImageStage, {
      props: { image: testImage(), unlockedLevel: 5, viewLevel: 2, onchangeLevel: vi.fn(), credit: testCredit() },
    });
    const seg5 = screen.getByRole('button', { name: 'Crop level 5 of 5' });
    expect(seg5).not.toBeDisabled();
  });

  it('viewLevel prop drives which segment is marked current', () => {
    render(ImageStage, {
      props: { image: testImage(), unlockedLevel: 4, viewLevel: 3, onchangeLevel: vi.fn(), credit: testCredit() },
    });
    expect(screen.getByRole('button', { name: 'Crop level 3 of 5' })).toHaveAttribute('aria-current', 'true');
  });

  it('never references image.full — the full reveal is not requested before game end', () => {
    const image = testImage();
    const { container } = render(ImageStage, {
      props: { image, unlockedLevel: 1, viewLevel: 1, onchangeLevel: vi.fn(), credit: testCredit() },
    });
    const srcs = Array.from(container.querySelectorAll('img')).map((img) => img.getAttribute('src'));
    for (const src of srcs) {
      expect(src).not.toContain('full.webp');
    }
  });

  describe('the in-play licence line (§5.10.1)', () => {
    it('renders exactly "Photo: " + credit.license.name, linked to credit.license.url — a PD fixture', () => {
      render(ImageStage, {
        props: { image: testImage(), unlockedLevel: 1, viewLevel: 1, onchangeLevel: vi.fn(), credit: testCredit() },
      });
      const link = screen.getByRole('link', { name: /Photo license/ }) as HTMLAnchorElement;
      expect(link).toHaveTextContent('Photo: Public domain');
      expect(link).toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/Template:PD-user');
      expect(link).toHaveAttribute('id', 'mtd-photo-licence');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('never re-derives the label from license.id — a jurisdiction-suffixed fixture proves it', () => {
      render(ImageStage, {
        props: {
          image: testImage(),
          unlockedLevel: 1,
          viewLevel: 1,
          onchangeLevel: vi.fn(),
          credit: jurisdictionCredit(),
        },
      });
      const link = screen.getByRole('link', { name: /Photo license/ });
      // license.id is "CC-BY-SA-2.0" (no jurisdiction token) — only license.name carries "de".
      expect(link).toHaveTextContent('Photo: CC BY-SA 2.0 de');
      expect(link).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/2.0/de/deed.en');
    });

    it('leaks none of author/fileTitle/descriptionUrl/creditNote anywhere in the subtree, attributes included', () => {
      const credit = jurisdictionCredit(); // has a non-null creditNote — the strictest fixture
      const { container } = render(ImageStage, {
        props: { image: testImage(), unlockedLevel: 1, viewLevel: 1, onchangeLevel: vi.fn(), credit },
      });
      const html = container.innerHTML;
      expect(html).not.toContain(credit.author);
      expect(html).not.toContain(credit.fileTitle);
      expect(html).not.toContain(credit.descriptionUrl);
      expect(html).not.toContain(credit.creditNote as string);
    });

    it('is present in every in-play state, including once every level has unlocked (game over)', () => {
      render(ImageStage, {
        props: { image: testImage(), unlockedLevel: 5, viewLevel: 5, onchangeLevel: vi.fn(), credit: testCredit() },
      });
      expect(screen.getByRole('link', { name: /Photo license/ })).toBeInTheDocument();
    });
  });
});
