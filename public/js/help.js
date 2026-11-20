// "How to play" modal, generated from the shared item catalog.
import { h, modal } from './ui.js';
import { ITEMS, CATEGORIES, ACTIONS } from '/shared/items.js';
import { ECONOMY, FLEETS } from '/shared/config.js';

export function itemTag(item) {
  return h('span', { class: `tag tag-${item.action}`, title: ACTIONS[item.action].hint }, ACTIONS[item.action].label);
}

function legendRow(cls, text, content = '') {
  return h('div', { class: 'legend-row' }, h('div', { class: `cell legend-cell ${cls}` }, content), h('span', {}, text));
}

export function openHelp() {
  const body = h('div', { class: 'help' },
    h('section', {},
      h('h3', {}, '🎯 Goal'),
      h('p', {}, 'Sink the whole enemy fleet to win a round. A match is best of 3, 5 or 7 rounds, and the first captain to win the majority takes the match.')),
    h('section', {},
      h('h3', {}, '🔁 Every round'),
      h('ol', {},
        h('li', {}, h('b', {}, 'Armory: '), 'spend coins on items. Unused items carry over to later rounds. You can sell back anything you bought this round.'),
        h('li', {}, h('b', {}, 'Deploy: '), 'place your ships (plus any Decoys and Sea Mines you own), then press Ready. Ships and Decoys cannot touch each other, not even corner to corner. Mines may sit right next to them.'),
        h('li', {}, h('b', {}, 'Battle: '), 'take turns. The loser of the previous round fires first.'))),
    h('section', {},
      h('h3', {}, '⚔️ Your turn'),
      h('p', {}, 'You may use ', h('b', {}, 'one Tactical item'), ' (intel or defense). It doesn\'t end your turn. Then make ', h('b', {}, 'one attack'), ': a free standard shot or an Attack item. ', h('b', {}, 'If your standard shot hits, you fire again'), ' (Attack items do not give a bonus shot). Passive defenses (Flak, Interceptor) trigger automatically.')),
    h('section', {},
      h('h3', {}, '💰 Coins'),
      h('ul', {},
        h('li', {}, `+${ECONOMY.hit} per ship part you hit, +${ECONOMY.sink} per ship you sink`),
        h('li', {}, `+${ECONOMY.winBonus} for winning a round`),
        h('li', {}, `+${ECONOMY.lossBonus} for losing a round, +${ECONOMY.lossStreakStep} more for each loss in a row (up to ${ECONOMY.lossBonusMax})`),
        h('li', {}, 'Coins earned in a battle are paid out when the round ends, so you spend them in the next Armory.'))),
    h('section', {},
      h('h3', {}, '🚢 Fleets'),
      h('ul', {}, Object.entries(FLEETS).map(([size, fleet]) => h('li', {}, `${size}×${size}: `, fleet.map((s) => `${s.name} (${s.size})`).join(', '))))),
    h('section', {},
      h('h3', {}, '🗺️ Map markers'),
      h('div', { class: 'legend' },
        legendRow('fog', 'Unknown'),
        legendRow('miss', 'Miss (water)'),
        legendRow('hit', 'Hit'),
        legendRow('sunk', 'Sunk ship'),
        legendRow('spotted', 'Ship spotted by intel'),
        legendRow('clear', 'Water seen by intel'),
        legendRow('decoy', 'Exposed decoy', '🎭'),
        legendRow('mine-spotted', 'Enemy mine spotted', '🧨'),
        legendRow('mine-hit', 'Exploded mine', '💥'))),
    CATEGORIES.map((cat) => h('section', {},
      h('h3', {}, `${cat.icon} ${cat.name}`),
      h('p', { class: 'muted small' }, cat.blurb),
      h('div', { class: 'help-items' }, ITEMS.filter((i) => i.category === cat.id).map((item) => h('div', { class: 'help-item' },
        h('div', { class: 'help-icon' }, item.icon),
        h('div', {},
          h('div', { class: 'help-name' }, item.name, ' ', itemTag(item), h('span', { class: 'price' }, `💰 ${item.price}`), h('span', { class: 'muted small' }, ` · max ${item.max}`)),
          h('div', { class: 'small' }, item.desc))))))),
  );
  modal({ title: 'How to play', body, className: 'modal-wide' });
}
