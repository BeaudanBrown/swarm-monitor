import { Account } from './account';
import { Network } from './network';
import { NodeStats, PeerStats, NodePerformance, printLifetimeStats } from './stats'
import { sleep } from './utils';
import chalk from 'chalk'

const COMMANDS = {
  update: 'update_stats',
  accStats: 'acc_stats',
  snodeStats: 'snode_stats',
  addAccs: 'add_accounts',
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

  const ip_count = nodes.filter((snode: { ip: string; }) => snode.ip !== '0.0.0.0');

  let results = await Promise.all(nodes.map(async a => await network.getStats(a)));

  const online_count = results.reduce((acc, x) => acc += (x.reset_time !== 0 ? 1 : 0), 0);
  
  console.log(`Nodes with ip: ${ip_count.length}/${nodes.length}`);
  const online_ratio = Math.round(100 * online_count / nodes.length);
  console.log(`Storage server online: ${online_count}/${nodes.length} (${online_ratio}%)`);
  
  let res2 = await Promise.all(nodes.map(async a => {
    const res = await network.tryPost(a);
    return { status: res, pubkey : a.pubkey};
  }));

  const na_count = res2.reduce((acc, x) => acc += (x.status === "N/A" ? 1 : 0), 0);
  const error_count = res2.reduce((acc, x) => acc += (x.status === "no post" ? 1 : 0), 0);

  let status_map : {[key:string]:string} = {};
  res2.forEach(x => {
    status_map[x.pubkey] = x.status;
  });

  console.log(`Storage not reachable: ${na_count}/${res2.length}`);
  console.log(`Storage error on post: ${error_count}/${res2.length}`);

  ["1.0.4", "1.0.5", "1.0.6"].forEach(tag => {

    const count = results.reduce((acc,x) => acc += (x.version === tag ? 1 : 0), 0);
    const ratio = Math.round(100 * count / nodes.length);
    console.log(`Version ${tag}: ${count}/${results.length} (${ratio}%)`);

    const na = results.reduce((acc,x) => acc += ((x.version === tag && status_map[x.pubkey] === "N/A") ? 1 : 0), 0);
    const nopost = results.reduce((acc,x) => acc += ((x.version === tag && status_map[x.pubkey] === "no post") ? 1 : 0), 0);

    console.log(`   N/A for ${tag}: ${na}/${count}`);
    console.log(`   Error on post for ${tag}: ${nopost}/${count}`);

  });

  let own_perf: Map<string, NodePerformance> = new Map();

  for (let pk in results) {
    let res = results[pk];

    for (let [key, value] of res.peer_stats) {

      if (!own_perf.has(key)) {
        own_perf.set(key, new NodePerformance(0, 0, 0));
      }

      let prev = own_perf.get(key);

      prev.req_failed += value.requests_failed;
      prev.bc_test_failed += value.bc_test_failed;
      prev.store_test_failed += value.store_test_failed;

      own_perf.set(key, prev);
    }

  }

  
  printLifetimeStats(results, status_map, own_perf);
  // console.log(own_perf);

  // console.log("Pubkey".padStart(16) + "  " + "Failed requests".padStart(15))

  // for (let [key, value] of own_perf) {

  //   let line = key.substr(0, 16) + "  ";
  //   line += value.req_failed.toLocaleString().padStart(15);
  //   line += value.bc_test_failed.toLocaleString().padStart(15);

  //   // if (!prev_results.has(key)) {
  //   //   continue;
  //   // }

  //   if (value.req_failed !== 0) {
  //     console.log(chalk.red(line));
  //   } else {
  //     console.log(chalk.white(line));
  //   }
  // }
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
        console.log('Printing account stats...');
        await Promise.all(accounts.map(async a => {
          const swarm = await a.getSwarm();
          await a.updateStats(swarm);
          await a.printStats(swarm);
        }));
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
