<!-- First-visit how-to-play (§5.6). Explains all three yellow bands in a player's words, using
     COUNTRY_NAMES so a raw country code never appears. Laid out as a 3×3 grid (category × colour)
     rather than prose, so each rule is one short cell. -->
<script lang="ts">
  import { COUNTRY_NAMES } from '../../schema/constants';
  import Modal from './Modal.svelte';

  interface Props {
    open: boolean;
    onclose: () => void;
  }
  let { open, onclose }: Props = $props();

  const exampleCountry = COUNTRY_NAMES.JP;
</script>

<Modal {open} titleId="help-title" onclose={() => onclose()}>
  <h2 id="help-title">How to play</h2>
  <p>Guess the motorbike in 5 tries. A new motorbike is available each day.</p>

  <h3>Tile colors</h3>
  <table class="help-grid">
    <colgroup>
      <col style="width: 19%" />
      <col style="width: 24%" />
      <col style="width: 35%" />
      <col style="width: 22%" />
    </colgroup>
    <thead>
      <tr>
        <th scope="col"><span class="visually-hidden">Category</span></th>
        <th scope="col"><span class="swatch" data-color="green">✓</span> Right</th>
        <th scope="col"><span class="swatch" data-color="yellow">~</span> Close</th>
        <th scope="col"><span class="swatch" data-color="red">✗</span> Wrong</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <th scope="row">Make</th>
        <td>right make</td>
        <td>same country</td>
        <td>other country</td>
      </tr>
      <tr>
        <th scope="row">Model</th>
        <td>that's the bike</td>
        <td>on sale the year the answer was built</td>
        <td>different era</td>
      </tr>
      <tr>
        <th scope="row">Year</th>
        <td>within 2 years</td>
        <td>within 10 years</td>
        <td>further off</td>
      </tr>
    </tbody>
  </table>
  <p class="help-note">
    Only a green tile scores a point and locks that field in. Yellow is just a hint. Example: you
    guess Honda and the answer is a Kawasaki, so the make tile turns yellow because both are from
    <strong>{exampleCountry}</strong>.
  </p>

  <h3>Scoring</h3>
  <p>Green tiles at the end (0–3) times a multiplier for how fast you finished. Best possible: 15.</p>
  <table class="help-table">
    <thead>
      <tr><th scope="col">Finished on</th><th scope="col">Multiplier</th></tr>
    </thead>
    <tbody>
      <tr><td>Guess 1</td><td>×5</td></tr>
      <tr><td>Guess 2</td><td>×4</td></tr>
      <tr><td>Guess 3</td><td>×3</td></tr>
      <tr><td>Guess 4</td><td>×2</td></tr>
      <tr><td>Guess 5</td><td>×1</td></tr>
      <tr><td>Loss or give-up</td><td>×1</td></tr>
    </tbody>
  </table>

  <p>A new Motodle every day at midnight, your time.</p>

  <button type="button" class="button button--primary help-cta" onclick={() => onclose()}>Got it</button>
</Modal>

<style>
  .help-grid,
  .help-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    margin-bottom: var(--space-3);
    font-size: 0.875rem;
  }

  .help-grid th,
  .help-grid td,
  .help-table th,
  .help-table td {
    text-align: left;
    vertical-align: top;
    padding: var(--space-2) var(--space-2);
  }

  .help-grid thead th,
  .help-table thead th {
    font-weight: 700;
    border-bottom: 1px solid var(--color-border);
  }

  .help-grid thead .swatch {
    display: flex;
    margin: 0 0 var(--space-1);
  }

  .help-grid tbody th {
    font-weight: 600;
    white-space: nowrap;
    padding-right: var(--space-2);
  }

  .help-grid {
    table-layout: fixed;
  }

  /* Multiplier numbers are data (§5.14.3 Instrument Rule): the guess column stays plain sans. */
  .help-table tbody td:nth-child(2) {
    font-family: var(--font-numeric);
    font-variant-numeric: tabular-nums;
  }

  .help-note {
    margin-top: 0;
  }

  /* Full 24x24 tiles drawn from the same CSS as a real scoreboard tile — fill + glyph — so the
     legend and the actual board are visibly the same object (§5.14.7 item 9). */
  .swatch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
    font-weight: 600;
    vertical-align: -0.35em;
    margin-right: var(--space-1);
  }

  .swatch[data-color='green'] {
    background: var(--tile-green-bg);
    color: var(--tile-green-fg);
  }
  .swatch[data-color='yellow'] {
    background: var(--tile-yellow-bg);
    color: var(--tile-yellow-fg);
  }
  .swatch[data-color='red'] {
    background: var(--tile-red-bg);
    color: var(--tile-red-fg);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  h3 {
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted);
    margin: var(--space-5) 0 var(--space-2);
  }

  .help-cta {
    margin-top: var(--space-2);
  }
</style>
