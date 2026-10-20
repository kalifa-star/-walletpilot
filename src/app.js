import { initialState, allocate, advance, propose, withdraw, equity, pnl, price, unrealised, replay } from './engine.js';

let state = initialState();
let timer;
let finalReturn = null;
const $ = (id) => document.getElementById(id);
const usd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const ngn = (n) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(n);
const set = (id, value) => { $(id).textContent = value; };
function toast(message) { set('toast', message); $('toast').classList.add('visible'); clearTimeout(timer); timer = setTimeout(() => $('toast').classList.remove('visible'), 5000); }
function openAllocation() {
  if (state.funded || state.stopped) { toast('Reset the demo to start a new allocation.'); return; }
  $('allocation-dialog').showModal();
}
function render() {
  const net = finalReturn ?? (state.funded ? pnl(state) : 0);
  set('wallet', ngn(state.wallet));
  set('equity', usd(equity(state)));
  set('allocated', state.invested ? `${usd(state.invested)} starting capital after conversion` : 'No funds allocated yet');
  set('pnl', `${net > 0 ? '+' : ''}${usd(net)}`);
  $('pnl').classList.toggle('negative', net < 0);
  $('pnl').classList.toggle('positive', net > 0);
  set('return-label', finalReturn !== null ? 'Final trading result · funds withdrawn' : 'After trading fees and spread');
  set('cash', usd(state.cash));
  set('position', `€${state.units.toFixed(4)}`);
  set('realised', usd(state.realised));
  set('unrealised', usd(unrealised(state)));
  set('fees', usd(state.fees));
  set('conversion', ngn(state.conversionCosts));
  set('quote', price(state).toFixed(5));
  set('replay-time', state.step >= 0 ? `${replay[state.step].time} · fictional observation` : 'Replay hasn’t started');
  set('status', finalReturn !== null ? '◉ Funds returned' : state.stopped ? '◉ Stop triggered' : state.paused ? '◉ Paused' : state.funded ? '◉ Strategy active' : '◉ Ready to explore');
  set('allocation-limit', state.invested ? ngn(state.invested * 1600 / 0.995) : 'Not set');
  set('position-limit', usd(state.positionLimit));
  set('loss-limit', `${(state.lossLimit * 100).toFixed(1)}%`);
  set('step-label', state.step >= 0 ? `Observation ${state.step + 1} of ${replay.length}` : 'You control the pace.');
  if (state.step >= 0) set('reason', replay[state.step].reason);
  else set('reason', 'Start with an allocation, then step through the market replay to see each decision and its explanation.');
  $('next').disabled = !state.funded || state.step >= replay.length - 1;
  $('pause').disabled = !state.funded || state.stopped;
  set('pause', state.paused ? '▶  Resume' : 'Ⅱ  Pause');
  $('reject-test').disabled = !state.funded;
  $('withdraw').disabled = !state.funded;
  set('activity-count', `${state.trades.length} executed ${state.trades.length === 1 ? 'order' : 'orders'}`);
  if (state.events.length) {
    $('events').replaceChildren(...state.events.map(event => {
      const row = document.createElement('div'); row.className = `event ${event.kind}`;
      const icon = document.createElement('span'); icon.className = 'event-icon'; icon.textContent = event.kind === 'rejected' ? '⊘' : event.kind === 'success' ? '✓' : '↗';
      const text = document.createElement('p'); text.textContent = event.message;
      const time = document.createElement('time'); time.textContent = event.time;
      row.append(icon, text, time); return row;
    }));
  } else {
    $('events').innerHTML = '<div class="empty"><span>↗</span><div><strong>A fresh start for your next move</strong><p>Allocate virtual funds to see decisions, trades, and rule checks here.</p></div><button class="text-button" id="empty-start">Get started →</button></div>';
    $('empty-start').onclick = openAllocation;
  }
  const visible = replay.slice(0, Math.max(1, state.step + 1));
  const points = visible.map((tick, index) => [index * 136, 22 + (1.0830 - tick.price) / 0.024 * 165]);
  const path = points.map(([x,y], index) => `${index ? 'L' : 'M'}${x},${y}`).join(' ');
  $('chart-line').setAttribute('d', path);
  const last = points.at(-1);
  $('chart-fill').setAttribute('d', `${path} L${last[0]},205 L0,205 Z`);
  $('chart-dot').setAttribute('cx', last[0] || 5);
  $('chart-dot').setAttribute('cy', last[1]);
  $('chart').setAttribute('aria-label', `Fictional EUR/USD replay, ${visible.length} observations visible. Current price ${price(state).toFixed(5)}.`);
}
$('allocate-open').onclick = openAllocation;
$('allocation-form').onsubmit = (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    allocate(state, Number(data.get('amount')), Number(data.get('position')), Number(data.get('loss')) / 100, data.has('suitable') && data.has('adult'));
    $('allocation-dialog').close(); set('form-error', ''); render(); toast('Allocation ready. Advance the replay to see your first decision.');
  } catch (error) { set('form-error', error.message); }
};
$('next').onclick = () => { advance(state); render(); };
$('pause').onclick = () => { state.paused = !state.paused; render(); toast(state.paused ? 'New orders paused. Existing positions remain exposed to price changes.' : 'Strategy resumed.'); };
$('reject-test').onclick = () => { propose(state, 'buy', state.positionLimit + 1); render(); toast('Proposal rejected. See the rules-engine explanation in Activity.'); };
$('withdraw').onclick = () => {
  try {
    const before = state.invested;
    // closePosition during withdrawal accounts for the final execution fee.
    const returned = withdraw(state);
    finalReturn = returned / 0.995 / 1600 - before;
    render(); toast(`${ngn(returned)} returned to your virtual wallet.`);
  } catch (error) { toast(error.message); }
};
$('reset').onclick = () => { state = initialState(); finalReturn = null; $('allocation-form').reset(); set('form-error', ''); render(); toast('Demo reset. Your virtual wallet is back to ₦100,000.'); };
$('how').onclick = () => $('info-dialog').showModal();
document.querySelectorAll('.close-dialog').forEach(button => button.onclick = () => button.closest('dialog').close());
document.querySelector('.close-info').onclick = () => $('info-dialog').close();
document.querySelectorAll('nav a').forEach(link => link.onclick = () => { document.querySelector('nav .active')?.classList.remove('active'); link.classList.add('active'); });
render();
