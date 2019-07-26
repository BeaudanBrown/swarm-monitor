import { Message } from './message';
import { Network } from './network';
import { Snode } from './snode';
import { sleep, firstTrue, getRandom } from './utils';

// Pubkey constants
const PUB_KEY_CHARS = '0123456789abcdef';
const PUB_KEY_CHARS_LEN = PUB_KEY_CHARS.length;
const PUB_KEY_LEN = 64;
const MIN_MSG_SIZE = 20;
const MAX_MSG_SIZE = 3000;
const MIN_MSG_INTERVAL = 1;
const MAX_MSG_INTERVAL = 500;
const SUBSWARM_SIZE = 2;

const randomIntFromInterval = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

export class Account {
  network: Network;
  pubKey: string;
  messages: Set<Message>;
  messageSize: number;
  sendInterval: number;

  constructor({ messageSize, sendInterval }: { messageSize?: number; sendInterval?: number; } = {}) {
    this.network = new Network();
    this.pubKey = Account._generatePubKey();
    this.messages = new Set();
    this.messageSize = messageSize || randomIntFromInterval(MIN_MSG_SIZE, MAX_MSG_SIZE);
    this.sendInterval = sendInterval || randomIntFromInterval(MIN_MSG_INTERVAL, MAX_MSG_INTERVAL);
  }

  private static _generatePubKey() {
    let pubKey = '05';
    for (let i = 0; i < PUB_KEY_LEN; i++) {
      pubKey += PUB_KEY_CHARS.charAt(Math.floor(Math.random() * PUB_KEY_CHARS_LEN));
    }
    return pubKey;
  }

  async getSwarm(attempts?: number): Promise<Array<Snode>>
  async getSwarm(attempts = 0) {
    if (attempts >= 10) {
      throw new Error(`Couldn't update swarm for ${this.pubKey}`);
    }
    const swarm = await this.network.getAccountSwarm(this.pubKey);
    if (swarm.length === 0) {
      return this.getSwarm(attempts + 1);
    }
    return swarm;
  }

  async sendMessages(swarm: Array<Snode>, num = 1) {
    const subSwarm: Array<Snode> = getRandom(swarm, SUBSWARM_SIZE);
    for (let i = 0; i < num; i += 1) {
      const message = new Message(this.pubKey);
      const success = await firstTrue(subSwarm.map(snode => snode.sendMessage(message)));
      if (success) {
        this.messages.add(message);
      } else {
        console.log(`Failed to send message to whole swarm at ${message.timestamp}`);
      };
      await sleep(this.sendInterval);
    }
  }

  async updateStats(swarm: Array<Snode>) {
    await Promise.all(swarm.map(async snode => {
      try {
        await snode.retrieveAllMessages(this.pubKey);
      } catch (e) {
        console.log(e);
      }
    }));
  }

  printStats(swarm: Array<Snode>) {
    let inconsistent = false;
    const shouldHave = this.messages.size;
    swarm.forEach(snode => {
      if (snode.messagesHolding[this.pubKey] !== shouldHave) {
        if (!inconsistent) {
          inconsistent = true;
          console.log(`Inconsistent messages for account ${this.pubKey}`);
        }
        console.log(`Snode ${snode.ip}:${snode.port} should have ${shouldHave} but has ${snode.messagesHolding[this.pubKey]}`);
      }
    });
    if (!inconsistent) {
      console.log(`Account ${this.pubKey} has all ${shouldHave} messages in swarm`);
    }
  }
}
