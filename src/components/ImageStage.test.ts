import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { PuzzleImage } from '../../schema/types';
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

describe('ImageStage', () => {
  it('shows level N during guess N (unlockedLevel/viewLevel = N)', () => {
    render(ImageStage, {
      props: { image: testImage(), unlockedLevel: 2, viewLevel: 2, onchangeLevel: vi.fn() },
    });
    const img = screen.getByAltText(/progressively revealed/) as HTMLImageElement;
    expect(img.src).toContain('l2.webp');
  });

  it('allows scrubbing back but disables forward levels', () => {
    render(ImageStage, {
      props: { image: testImage(), unlockedLevel: 2, viewLevel: 2, onchangeLevel: vi.fn() },
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
      props: { image: testImage(), unlockedLevel: 3, viewLevel: 3, onchangeLevel },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Crop level 1 of 5' }));
    expect(onchangeLevel).toHaveBeenCalledWith(1);
  });

  it('unlocks all 5 levels once the game is over (unlockedLevel=5 regardless of guess count)', () => {
    render(ImageStage, {
      props: { image: testImage(), unlockedLevel: 5, viewLevel: 2, onchangeLevel: vi.fn() },
    });
    const seg5 = screen.getByRole('button', { name: 'Crop level 5 of 5' });
    expect(seg5).not.toBeDisabled();
  });

  it('viewLevel prop drives which segment is marked current', () => {
    render(ImageStage, {
      props: { image: testImage(), unlockedLevel: 4, viewLevel: 3, onchangeLevel: vi.fn() },
    });
    expect(screen.getByRole('button', { name: 'Crop level 3 of 5' })).toHaveAttribute('aria-current', 'true');
  });

  it('never references image.full — the full reveal is not requested before game end', () => {
    const image = testImage();
    const { container } = render(ImageStage, {
      props: { image, unlockedLevel: 1, viewLevel: 1, onchangeLevel: vi.fn() },
    });
    const srcs = Array.from(container.querySelectorAll('img')).map((img) => img.getAttribute('src'));
    for (const src of srcs) {
      expect(src).not.toContain('full.webp');
    }
  });
});
