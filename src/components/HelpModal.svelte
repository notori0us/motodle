<!-- First-visit how-to-play (§5.6). Must explain all three yellow bands in the exact wording
     given there, using COUNTRY_NAMES so a raw country code never appears. -->
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
  <p>
    A new motorbike photo, revealed a little more with every wrong guess. Guess its <strong>make</strong>,
    <strong>model</strong> and <strong>year</strong> in up to 5 tries.
  </p>

  <h3>Tile colours</h3>
  <dl class="help-rules">
    <dt><span class="swatch" data-color="green">✓</span> Make</dt>
    <dd>
      🟩 you named the right make. 🟨 wrong make, but <strong>from the same country</strong> (you
      guessed Honda, the answer is a different make from <strong>{exampleCountry}</strong>). 🟥 wrong country.
    </dd>
    <dt><span class="swatch" data-color="yellow">~</span> Model</dt>
    <dd>
      🟩 that's the bike. 🟨 wrong bike, but <strong>one that was on sale the year the answer was built</strong>.
      🟥 not on sale that year (or we don't know when it was built).
    </dd>
    <dt><span class="swatch" data-color="red">✗</span> Year</dt>
    <dd>🟩 within 2 years. 🟨 within 10. 🟥 further off.</dd>
  </dl>
  <p><strong>Only 🟩 counts towards your score, and only 🟩 locks a field in.</strong></p>

  <h3>Scoring</h3>
  <p>Each green category is worth 1 point (0–3), multiplied by how quickly you finished:</p>
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

  <button type="button" class="button button--primary" onclick={() => onclose()}>Got it</button>
</Modal>

<style>
  .help-rules {
    margin: 0 0 var(--space-3);
  }

  .help-rules dt {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: 600;
    margin-top: var(--space-3);
  }

  .help-rules dd {
    margin: var(--space-1) 0 0;
  }

  .swatch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
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

  .help-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: var(--space-3);
  }

  .help-table th,
  .help-table td {
    text-align: left;
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--color-border);
  }
</style>
