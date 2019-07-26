import { Account } from './account';
import { Network } from './network';
import { Snode } from './snode';
import { NodeStats, PeerStats, NodePerformance, printLifetimeStats, printDiff } from './stats'
import { sleep } from './utils';
import chalk from 'chalk'

const COMMANDS = {
  update: 'update_stats',
  accStats: 'acc_stats',
  snodeStats: 'snode_stats',
  addAccs: 'add_accs',
  send: 'send',
};
const START_MODES = {
  command: 'command',
  snodeStats: 'snode_stats',
};
const NUM_ACCOUNTS = 10;

const accounts: Account[] = [];
const network = new Network;

const defaultMode = async () => {
  Array(NUM_ACCOUNTS)
    .fill(NUM_ACCOUNTS)
    .map(_ => {
      accounts.push(new Account());
    });
  await Promise.all(accounts.map(async a => {
    const swarm = await a.getSwarm();
    await a.sendMessages(swarm)
    await sleep(5000);
    await a.updateStats(swarm);
    a.printStats(swarm);
  }));
}

const printCommands = () => {
  console.log(`Commands: [${Object.values(COMMANDS).join(', ')}]`);
}

const getSnodeStats = async () => {

  const nodes = await network.getAllNodes();

  let results = await Promise.all(nodes.map(async a => await network.getStats(a)));

  const online_count = results.reduce((acc, x) => acc += (x.reset_time !== 0 ? 1 : 0), 0);

  console.log(`Nodes online: ${online_count}/${nodes.length}`);

  printLifetimeStats(results);

  /// save to a map
  let prev_results = new Map<string, NodeStats>();

  results.forEach(x => {
    prev_results.set(x.pubkey, x);
  });
  // Gather stats from other nodes

  let own_perf: Map<string, NodePerformance> = new Map();

  for (let pk in results) {
    let res = results[pk];

    for (let [key, value] of res.peer_stats) {

      if (!own_perf.has(key)) {
        own_perf.set(key, new NodePerformance(0));
      }

      let prev = own_perf.get(key);

      prev.req_failed += value.requests_failed;

      own_perf.set(key, prev);
    }

  }

  console.log("Pubkey".padStart(16) + "  " + "Failed requests".padStart(15))

  for (let [key, value] of own_perf) {

    let line = key.substr(0, 16) + "  ";
    line += value.req_failed.toLocaleString().padStart(15);

    if (!prev_results.has(key)) {
      continue;
    }

    if (value.req_failed !== 0) {
      console.log(chalk.red(line));
    } else {
      console.log(chalk.white(line));
    }
  }

  // all nodes

  let swarm_ids2: Map<string, number> = new Map();
  nodes.forEach(sn => {

    if (!swarm_ids2.has(sn.swarm_id)) {
      swarm_ids2.set(sn.swarm_id, 0);
    }

    let val = swarm_ids2.get(sn.swarm_id);
    val += 1;
    swarm_ids2.set(sn.swarm_id, val);
  });

  console.log(swarm_ids2);

  return;

  await sleep(10000);
  let results_2 = await Promise.all(nodes.map(async a => await network.getStats(a)));

  let cur_results = new Map<string, NodeStats>();

  results_2.forEach(x => {
    cur_results.set(x.pubkey, x);
  });

  console.log("Difference:");

  printDiff(prev_results, cur_results);
}

const commandMode = () => {
  console.log(`Starting in command mode, possible commands:\n\n[${Object.values(COMMANDS).join(', ')}]`);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', async (data: string) => {
    process.stdin.pause();
    const input = data.trim().split(' ');
    const command = input[0];
    switch (command) {
      case COMMANDS.update:
        console.log('Updating stats...');
        await Promise.all(accounts.map(async a => {
          const swarm = await a.getSwarm();
          await a.updateStats(swarm);
        }));
        console.log('Stats updated');
        break;

      case COMMANDS.accStats:
        if (accounts.length === 0) {
          console.log('No accounts to show stats for!');
          break;
        }
        console.log('Printing account stats...');
        const nodeAccounts: {[snodeKey: string]: { accs: Account[], shouldHave: number }} = {};
        const relevantNodes = new Set<Snode>();
        await Promise.all(accounts.map(async a => {
          const swarm = await a.getSwarm();
          await a.updateStats(swarm);
          swarm.forEach(snode => {
            relevantNodes.add(snode);
            if (!nodeAccounts[snode.pubkey]) {
              nodeAccounts[snode.pubkey] = { accs: [], shouldHave: 0 };
            }
            nodeAccounts[snode.pubkey].accs.push(a);
            nodeAccounts[snode.pubkey].shouldHave += a.messages.size;
          })
        }));
        relevantNodes.forEach(snode => snode.printStats(nodeAccounts[snode.pubkey].accs, nodeAccounts[snode.pubkey].shouldHave))
        console.log('Printing complete');
        break;

      case COMMANDS.snodeStats:
        console.log('Printing snode stats...');
        await getSnodeStats();
        console.log('Printing complete');
        break;

      case COMMANDS.send:
        const n = input[1] && parseInt(input[1]) !== NaN ? parseInt(input[1]) : 1;
        console.log(`Accounts sending ${n} message${n === 1 ? '' : 's'}...`);
        try {
          await Promise.all(accounts.map(async a => {
            const swarm = await a.getSwarm();
            await a.sendMessages(swarm, n);
          }));
        } catch (e) {
          console.log(`Error sending messages: ${e}`);
          break;
        }
        console.log('Messages sent');
        break;

      case COMMANDS.addAccs:
        const num = input[1] && parseInt(input[1]) !== NaN ? parseInt(input[1]) : 1;
        console.log(`Creating ${num} account${num === 1 ? '' : 's'}`);
        Array(num)
          .fill(num)
          .map(_ => {
            accounts.push(new Account());
          });
        console.log(`Account${num === 1 ? '' : 's'} created`);
        break;

      default:
        console.log(`${command} is not a valid command, please use one of [${Object.values(COMMANDS).join(', ')}]`);
        process.stdin.resume();
        return;
    }
    printCommands();
    process.stdin.resume();
  });
}

const args = process.argv.slice(2);
const mode = args[0] ? args[0] : 'default';

switch (mode) {
  case 'default':
    console.log(`Starting default tests, creating ${NUM_ACCOUNTS} accounts and collecting stats...`);
    defaultMode();
    break;

  case START_MODES.command:
    commandMode();
    break;

  case START_MODES.snodeStats:
    getSnodeStats();
    break;

  default:
    console.log(`${mode} is not a valid start mode, please use 'node index.js [${Object.values(START_MODES).slice(1).join(', ')}]'`);
    process.exit(1);
    break;
}
